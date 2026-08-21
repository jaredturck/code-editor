/**
 * anthropicProvider.ts
 * Anthropic Messages API adapter.
 * Converts OpenAI-style content arrays to Anthropic's block format.
 * image_url data-URLs become {type:'image', source:{type:'base64',...}}.
 */

import {
  normalizeApiKey,
  normalizeContentToArray,
  normalizeUsage,
  safeNumber,
  toMetaResponse,
  contentToText,
  createSSELineReader,
  parseBase64DataUrl,
  parseToolArguments,
} from '@/platform/providers/providerUtils';
import { resolveMaxOutputTokens, resolveOutputCeiling } from '@/platform/modelProfiles';
import { toAnthropicTools, encodeToolName, decodeToolName } from '@/platform/agent/toolSchema';
import type { ProviderMeta, ToolCall } from '@/platform/agent/types';
import type {
  AIMessage,
  AISettings,
  ProviderCallOptions,
  ProviderFetch,
  ProviderStreamFn,
  ToolCallStreamEvent,
} from '@/platform/providers/types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export interface AnthropicStreamBlock {
  type: string;
  id: string;
  name: string;
  json: string;
}

export interface AnthropicStreamState {
  text: string;
  thinking: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  blocks: Map<number, AnthropicStreamBlock>;
}

interface AnthropicThinkingConfig {
  extendedThinking: boolean;
  thinkingBudget: number;
  adaptiveThinking: boolean;
  legacyThinking: boolean;
  effort: string;
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
}

interface AnthropicResponseBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content?: AnthropicResponseBlock[];
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
  stop_reason?: string;
}

interface AnthropicErrorResponse {
  error?: { message?: string };
}

interface AnthropicModelListResponse {
  data?: Array<{ id?: string }>;
}

interface StreamAnthropicOptions {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  model: string;
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onToolCall?: (event: ToolCallStreamEvent) => void;
  streamFn: ProviderStreamFn;
}

/** Converts canonical IRIS turns into Anthropic message content blocks. */
export function normalizeAnthropicMessages(
  messages: readonly AIMessage[],
): Array<Record<string, unknown>> {
  const chatMessages = messages.filter((message) => message.role !== 'system');
  return chatMessages.map((message): Record<string, unknown> => {
    if (message.role === 'tool' && Array.isArray(message.toolResults)) {
      return {
        role: 'user',
        content: message.toolResults.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: String(result.content ?? ''),
        })),
      };
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    if (role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const blocks: Array<Record<string, unknown>> = [];
      const text =
        typeof message.content === 'string' ? message.content : contentToText(message.content);
      if (text) blocks.push({ type: 'text', text });
      for (const toolCall of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: encodeToolName(toolCall.name),
          input: toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {},
        });
      }
      return { role: 'assistant', content: blocks };
    }

    const blocks = normalizeContentToArray(message.content).map((part): Record<string, unknown> => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      const imageUrl =
        part.type === 'image_url' &&
        part.image_url &&
        typeof part.image_url === 'object' &&
        typeof part.image_url.url === 'string'
          ? part.image_url.url
          : '';
      if (imageUrl) {
        const parsed = parseBase64DataUrl(imageUrl);
        if (parsed) {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsed.mimeType,
              data: parsed.data,
            },
          };
        }
        return { type: 'text', text: `[Image: ${imageUrl}]` };
      }
      if (part.type === 'document' && part.source) {
        return { type: 'document', source: part.source };
      }
      return { type: 'text', text: String(part.text || '') };
    });
    return { role, content: blocks };
  });
}

/** Resolves the model-specific Anthropic thinking mode without changing request semantics. */
export function resolveAnthropicThinkingConfig(
  model: string,
  settings: AISettings,
): AnthropicThinkingConfig {
  const extendedThinking = settings?.extended_thinking === true;
  const thinkingBudget = Math.max(
    1000,
    Math.min(16000, Number(settings?.thinking_budget_tokens || 8000)),
  );
  // New adaptive-thinking models reject the legacy fixed-budget shape; older Claude models retain it.
  const adaptiveThinking =
    /claude-(?:opus-4-[6-9]|sonnet-4-[6-9])/.test(model) || /fable/.test(model);
  const legacyThinkingOk = /claude-(?:3-[5-9]|opus-4-[0-5]|sonnet-4-5|haiku-4-[5-9])/.test(model);
  return {
    extendedThinking,
    thinkingBudget,
    adaptiveThinking,
    legacyThinking: !adaptiveThinking && legacyThinkingOk,
    effort: String(settings?.reasoning_effort || 'high').toLowerCase(),
  };
}

/** Builds the Anthropic request body, including prompt caching, tools, and thinking controls. */
export function buildAnthropicRequestBody(
  messages: readonly AIMessage[],
  model: string,
  settings: AISettings,
  options: ProviderCallOptions,
): Record<string, unknown> {
  const systemMessage = messages.find((message) => message.role === 'system');
  const thinking = resolveAnthropicThinkingConfig(model, settings);
  const maxOutput = resolveMaxOutputTokens(model, 'anthropic', settings);
  const outputCeiling = resolveOutputCeiling(model, 'anthropic');
  const systemText = systemMessage
    ? contentToText(systemMessage.content)
    : 'You are a helpful AI assistant.';
  const requestBody: Record<string, unknown> = {
    model,
    // Legacy thinking reserves answer room after its budget; adaptive thinking does not.
    max_tokens: Math.min(
      outputCeiling,
      thinking.extendedThinking && thinking.legacyThinking
        ? thinking.thinkingBudget + maxOutput
        : maxOutput,
    ),
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: normalizeAnthropicMessages(messages),
  };

  const tools =
    Array.isArray(options.tools) && options.tools.length ? toAnthropicTools(options.tools) : null;
  if (tools) {
    // The final tool carries the prompt-cache breakpoint for the stable tool-list prefix.
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: 'ephemeral' },
    } as (typeof tools)[number];
    requestBody.tools = tools;
    if (options.toolChoice) {
      requestBody.tool_choice =
        typeof options.toolChoice === 'string' ? { type: options.toolChoice } : options.toolChoice;
    }
  }

  if (thinking.adaptiveThinking) {
    // Adaptive effort controls total reasoning spend even when visible thinking is disabled.
    if (new Set(['low', 'medium', 'high', 'xhigh', 'max']).has(thinking.effort)) {
      const outputConfig =
        requestBody.output_config && typeof requestBody.output_config === 'object'
          ? (requestBody.output_config as Record<string, unknown>)
          : {};
      requestBody.output_config = { ...outputConfig, effort: thinking.effort };
    }
    if (thinking.extendedThinking) {
      requestBody.thinking = { type: 'adaptive', display: 'summarized' };
    }
  } else if (thinking.extendedThinking && thinking.legacyThinking) {
    requestBody.thinking = {
      type: 'enabled',
      budget_tokens: thinking.thinkingBudget,
    };
  }

  return requestBody;
}

/** Builds Anthropic request headers, including the legacy thinking beta when required. */
export function buildAnthropicHeaders(
  apiKey: string,
  model: string,
  settings: AISettings,
): Record<string, string> {
  const thinking = resolveAnthropicThinkingConfig(model, settings);
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    ...(thinking.extendedThinking && thinking.legacyThinking
      ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' }
      : {}),
  };
}

/** Applies one decoded Anthropic SSE event to the retained stream state. */
export function applyAnthropicStreamPayload(
  payload: string,
  state: AnthropicStreamState,
  emitToken: (token: string) => void,
  emitThinking: (token: string) => void,
  emitToolCall: (event: ToolCallStreamEvent) => void,
): void {
  let event: AnthropicStreamEvent;
  try {
    event = JSON.parse(payload) as AnthropicStreamEvent;
  } catch {
    return;
  }
  switch (event.type) {
    case 'message_start':
      state.inputTokens = Number(event.message?.usage?.input_tokens || 0);
      break;
    case 'content_block_start': {
      const index = Number(event.index || 0);
      state.blocks.set(index, {
        type: String(event.content_block?.type || ''),
        id: String(event.content_block?.id || ''),
        name: String(event.content_block?.name || ''),
        json: '',
      });
      if (event.content_block?.type === 'tool_use') {
        emitToolCall({
          phase: 'start',
          index,
          id: String(event.content_block?.id || ''),
          name: decodeToolName(event.content_block?.name || ''),
        });
      }
      break;
    }
    case 'content_block_delta': {
      const delta = event.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        state.text += delta.text;
        emitToken(delta.text);
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        state.thinking += delta.thinking;
        emitThinking(delta.thinking);
      } else if (delta.type === 'input_json_delta') {
        const index = Number(event.index || 0);
        const block = state.blocks.get(index);
        if (block) block.json += delta.partial_json || '';
        emitToolCall({
          phase: 'args',
          index,
          partial: delta.partial_json || '',
          json: block ? block.json : '',
        });
      }
      break;
    }
    case 'message_delta':
      if (event.delta?.stop_reason) state.stopReason = event.delta.stop_reason;
      if (event.usage?.output_tokens) state.outputTokens = event.usage.output_tokens;
      break;
    default:
      break;
  }
}

/** Converts streamed tool-use blocks into canonical IRIS tool calls. */
export function finalizeAnthropicStreamToolCalls(
  blocks: Map<number, AnthropicStreamBlock>,
): ToolCall[] {
  return [...blocks.values()]
    .filter((block) => block.type === 'tool_use' && block.name)
    .map((block) => {
      const parsed = parseToolArguments(block.json);
      return {
        id: block.id,
        name: decodeToolName(block.name),
        args: parsed.args,
        argsError: parsed.argsError,
        rawArgs: parsed.rawArgs,
      };
    });
}

/** Converts a non-streaming Anthropic response into IRIS's provider-neutral metadata. */
export function parseAnthropicResponse(data: AnthropicResponse, model: string): ProviderMeta {
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('');
  const thinkingText = content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking || '')
    .join('');
  const toolCalls = content
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: String(block.id || ''),
      name: decodeToolName(block.name),
      args: block.input && typeof block.input === 'object' ? block.input : {},
      argsError:
        data?.stop_reason === 'max_tokens' &&
        (!block.input || Object.keys(block.input).length === 0),
    }));
  const usage = normalizeUsage(data?.usage, {
    promptTokens: safeNumber(data?.usage?.input_tokens),
    completionTokens: safeNumber(data?.usage?.output_tokens),
  });

  return toMetaResponse({
    provider: 'Anthropic',
    model,
    text,
    usage,
    toolCalls,
    stopReason: data?.stop_reason || '',
    thinkingText,
  });
}

/**
 * Stream an Anthropic Messages response, invoking onToken(delta) as text arrives.
 * Accumulates text + thinking + tool_use blocks (via input_json_delta) + usage,
 * returning the same meta shape as the non-streaming path.
 */
async function streamAnthropic({
  headers,
  body,
  model,
  onToken,
  onThinkingToken,
  onToolCall,
  streamFn,
}: StreamAnthropicOptions): Promise<ProviderMeta> {
  const _body = { ...body, stream: true };
  const _emitToken = typeof onToken === 'function' ? onToken : () => {};
  const _emitThinking = typeof onThinkingToken === 'function' ? onThinkingToken : () => {};
  const _emitToolCall = typeof onToolCall === 'function' ? onToolCall : () => {};
  const _state: AnthropicStreamState = {
    text: '',
    thinking: '',
    stopReason: '',
    inputTokens: 0,
    outputTokens: 0,
    blocks: new Map<number, AnthropicStreamBlock>(),
  };
  const _sse = createSSELineReader();

  await streamFn(
    ANTHROPIC_API_URL,
    { method: 'POST', headers, body: JSON.stringify(_body) },
    (chunk) => {
      for (const payload of _sse.push(chunk)) {
        applyAnthropicStreamPayload(payload, _state, _emitToken, _emitThinking, _emitToolCall);
      }
    },
    { provider: 'anthropic' },
  );

  const _toolCalls = finalizeAnthropicStreamToolCalls(_state.blocks);

  return toMetaResponse({
    provider: 'Anthropic',
    model,
    text: _state.text,
    usage: normalizeUsage({
      input_tokens: _state.inputTokens,
      output_tokens: _state.outputTokens,
    }),
    toolCalls: _toolCalls,
    stopReason: _state.stopReason,
    thinkingText: _state.thinking,
  });
}

/**
 * Sends one normalized IRIS request to Anthropic and converts Claude content blocks,
 * tool calls, reasoning, stop reasons, and usage into the provider-neutral result used by
 * the agent runtime. Streaming and non-streaming responses share the same normalized
 * contract.
 */

export async function callAnthropic(
  messages: readonly AIMessage[],
  apiKey: unknown,
  model: string,
  settings: AISettings,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  const _apiKey = normalizeApiKey(apiKey);
  if (!_apiKey) throw new Error('Anthropic API key not configured.');

  const _requestBody = buildAnthropicRequestBody(messages, model, settings, options);
  const _headers = buildAnthropicHeaders(_apiKey, model, settings);

  // Token-streaming path (when the runtime requests it).
  if (
    typeof options.streamFn === 'function' &&
    (typeof options.onToken === 'function' ||
      typeof options.onThinkingToken === 'function' ||
      typeof options.onToolCall === 'function')
  ) {
    return streamAnthropic({
      headers: _headers,
      body: _requestBody,
      model,
      onToken: options.onToken,
      onThinkingToken: options.onThinkingToken,
      onToolCall: options.onToolCall,
      streamFn: options.streamFn,
    });
  }

  const _res = await fetchFn(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: _headers,
    body: JSON.stringify(_requestBody),
  });

  if (!_res.ok) {
    const _err = (await _res.json().catch(() => ({}))) as AnthropicErrorResponse;
    throw new Error(_err?.error?.message || `Anthropic error: ${_res.status}`);
  }

  const _data = (await _res.json()) as AnthropicResponse;
  return parseAnthropicResponse(_data, model);
}

/**
 * List models the given Anthropic key can access (GET /v1/models).
 * Returns [] on missing key or failure (callers treat empty as "not discovered").
 */
export async function listAnthropicModels(
  apiKey: unknown,
  fetchFn: ProviderFetch,
): Promise<string[]> {
  const _apiKey = normalizeApiKey(apiKey);
  if (!_apiKey) return [];

  const _res = await fetchFn('https://api.anthropic.com/v1/models?limit=1000', {
    method: 'GET',
    headers: {
      'x-api-key': _apiKey,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!_res.ok) return [];

  const _data = (await _res.json().catch(() => ({}))) as AnthropicModelListResponse;
  const _raw = Array.isArray(_data?.data) ? _data.data : [];
  return _raw
    .map((entry) => String(entry?.id || ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
