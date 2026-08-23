/**
 * openaiProvider.ts
 * OpenAI and OpenAI-compatible endpoint adapters (OpenCode, self-hosted, etc.).
 * Also exports listOpenAICompatibleModels for test/discovery.
 */

import {
  normalizeApiKey,
  normalizeOpenAICompatibleBaseUrl,
  normalizeContentToArray,
  normalizeUsage,
  toMetaResponse,
  contentToText,
  createSSELineReader,
  parseToolArguments,
} from '@/platform/providers/providerUtils'
import { resolveMaxOutputTokens, isReasoningModel } from '@/platform/modelProfiles'
import { toOpenAITools, encodeToolName, decodeToolName } from '@/platform/agent/toolSchema'
import type { ProviderMeta, ToolCall } from '@/platform/agent/types'
import type {
  AIMessage,
  AISettings,
  OpenAICompatibleOptions,
  OpenAIModelDiscoveryOptions,
  ProviderCallOptions,
  ProviderFetch,
  ProviderStreamFn,
  ToolCallStreamEvent,
} from '@/platform/providers/types'

interface OpenAIStreamToolDelta {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface OpenAIStreamEvent {
  usage?: Parameters<typeof normalizeUsage>[0]
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      reasoning?: string
      tool_calls?: OpenAIStreamToolDelta[]
    }
    finish_reason?: string
  }>
}

interface OpenAIToolCallResponse {
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
      reasoning?: string
      tool_calls?: OpenAIToolCallResponse[]
    }
    finish_reason?: string
  }>
  usage?: Parameters<typeof normalizeUsage>[0]
}

interface OpenAIErrorResponse {
  error?: { message?: string }
}

interface OpenAIModelListResponse {
  data?: Array<{ id?: string; name?: string }>
}

export interface OpenAIToolAccumulator {
  id: string
  name: string
  args: string
}

export interface OpenAIStreamState {
  text: string
  thinking: string
  finishReason: string
  usage: Parameters<typeof normalizeUsage>[0]
  toolAccumulators: Map<number, OpenAIToolAccumulator>
}

interface OpenAIRequestBodyOptions {
  model: string
  providerId: string
  settings?: AISettings
  tools?: OpenAICompatibleOptions['tools']
  toolChoice?: OpenAICompatibleOptions['toolChoice']
}

interface StreamOpenAICompatibleOptions {
  baseUrl: string
  apiKey: string
  extraHeaders: Record<string, string>
  body: Record<string, unknown>
  model: string
  providerId: string
  providerLabel: string
  onToken?: (token: string) => void
  onThinkingToken?: (token: string) => void
  onToolCall?: (event: ToolCallStreamEvent) => void
  streamFn: ProviderStreamFn
}

/** Converts canonical assistant and tool turns into the OpenAI-compatible message shape. */
export function normalizeOpenAIMessages(messages: readonly AIMessage[]): Array<Record<string, unknown>> {
  const normalizedMessages: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.toolResults)) {
      for (const result of message.toolResults) {
        normalizedMessages.push({
          role: 'tool',
          tool_call_id: result.id,
          content: String(result.content ?? ''),
        })
      }
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const assistantMessage: Record<string, unknown> = {
        role: 'assistant',
        content: (typeof message.content === 'string' ? message.content : contentToText(message.content)) || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: encodeToolName(toolCall.name),
            arguments: JSON.stringify(toolCall.args || {}),
          },
        })),
      }
      const reasoningContent = String(message.reasoning_content || message.reasoningContent || '').trim()
      if (reasoningContent) assistantMessage.reasoning_content = reasoningContent
      normalizedMessages.push(assistantMessage)
      continue
    }
    normalizedMessages.push({
      role: message.role,
      content: normalizeContentToArray(message.content),
    })
  }
  return normalizedMessages
}

/** Builds the stable OpenAI-compatible request body from normalized conversation turns. */
export function buildOpenAIRequestBody(
  messages: Array<Record<string, unknown>>,
  options: OpenAIRequestBodyOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    max_tokens: resolveMaxOutputTokens(options.model, options.providerId, options.settings),
  }
  if (Array.isArray(options.tools) && options.tools.length) {
    body.tools = toOpenAITools(options.tools)
    body.tool_choice = options.toolChoice || 'auto'
  }
  if (isReasoningModel(options.providerId, options.model) && /openrouter/i.test(String(options.providerId))) {
    body.reasoning = { enabled: true }
  }
  return body
}

/** Applies one decoded SSE payload to the retained OpenAI streaming state. */
export function applyOpenAIStreamPayload(
  payload: string,
  state: OpenAIStreamState,
  emitToken: (token: string) => void,
  emitThinking: (token: string) => void,
  emitToolCall: (event: ToolCallStreamEvent) => void,
): void {
  if (payload === '[DONE]') return
  let event: OpenAIStreamEvent
  try {
    event = JSON.parse(payload) as OpenAIStreamEvent
  } catch {
    return
  }
  if (event.usage) state.usage = event.usage
  const choice = event.choices?.[0]
  if (!choice) return
  const delta = choice.delta || {}
  const reasoning =
    typeof delta.reasoning_content === 'string' && delta.reasoning_content
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string' && delta.reasoning
        ? delta.reasoning
        : ''
  if (reasoning) {
    state.thinking += reasoning
    emitThinking(reasoning)
  }
  if (typeof delta.content === 'string' && delta.content) {
    state.text += delta.content
    emitToken(delta.content)
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const toolCall of delta.tool_calls) {
      const index = Number.isInteger(toolCall.index) ? Number(toolCall.index) : 0
      const current = state.toolAccumulators.get(index) || {
        id: '',
        name: '',
        args: '',
      }
      if (toolCall.id) current.id = toolCall.id
      if (toolCall.function?.name && !current.name) {
        current.name = toolCall.function.name
        emitToolCall({
          phase: 'start',
          index,
          id: current.id,
          name: decodeToolName(current.name),
        })
      } else if (toolCall.function?.name) {
        current.name = toolCall.function.name
      }
      if (toolCall.function?.arguments) {
        current.args += toolCall.function.arguments
        emitToolCall({
          phase: 'args',
          index,
          partial: toolCall.function.arguments,
          json: current.args,
        })
      }
      state.toolAccumulators.set(index, current)
    }
  }
  if (choice.finish_reason) state.finishReason = choice.finish_reason
}

/** Converts accumulated streaming tool fragments into executable canonical tool calls. */
export function finalizeOpenAIStreamToolCalls(toolAccumulators: Map<number, OpenAIToolAccumulator>): ToolCall[] {
  return [...toolAccumulators.values()]
    .filter((tool) => tool.name)
    .map((tool) => {
      const parsed = parseToolArguments(tool.args)
      return {
        id: tool.id,
        name: decodeToolName(tool.name),
        args: parsed.args,
        argsError: parsed.argsError,
        rawArgs: parsed.rawArgs,
      }
    })
}

/** Converts a non-streaming OpenAI response into IRIS's shared provider metadata. */
export function parseOpenAIChatResponse(data: OpenAIChatResponse, providerLabel: string, model: string): ProviderMeta {
  const message = data?.choices?.[0]?.message || {}
  const text = message.content || ''
  const thinking =
    (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message.reasoning === 'string' && message.reasoning) ||
    ''
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((toolCall) => Boolean(toolCall?.function?.name))
        .map((toolCall) => {
          const parsed = parseToolArguments(toolCall.function?.arguments)
          return {
            id: String(toolCall.id || ''),
            name: decodeToolName(toolCall.function?.name),
            args: parsed.args,
            argsError: parsed.argsError,
            rawArgs: parsed.rawArgs,
          }
        })
    : []

  return toMetaResponse({
    provider: providerLabel,
    model,
    text,
    usage: normalizeUsage(data?.usage),
    toolCalls,
    stopReason: data?.choices?.[0]?.finish_reason || '',
    thinkingText: thinking,
  })
}

// ── Streaming (SSE) ───────────────────────────────────────────────────────────

/**
 * Stream an OpenAI-compatible chat completion, invoking onToken(delta) as text
 * arrives. Accumulates text + tool_calls (by index) + usage and returns the same
 * meta shape as the non-streaming path.
 */
async function streamOpenAICompatible({
  baseUrl,
  apiKey,
  extraHeaders,
  body,
  model,
  providerId,
  providerLabel,
  onToken,
  onThinkingToken,
  onToolCall,
  streamFn,
}: StreamOpenAICompatibleOptions): Promise<ProviderMeta> {
  const _body = {
    ...body,
    stream: true,
    stream_options: { include_usage: true },
  }
  const _emitToken = typeof onToken === 'function' ? onToken : () => {}
  const _emitThinking = typeof onThinkingToken === 'function' ? onThinkingToken : () => {}
  const _emitToolCall = typeof onToolCall === 'function' ? onToolCall : () => {}
  const _state: OpenAIStreamState = {
    text: '',
    thinking: '',
    finishReason: '',
    usage: null,
    toolAccumulators: new Map<number, OpenAIToolAccumulator>(),
  }
  const _sse = createSSELineReader()

  await streamFn(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(_body),
    },
    (chunk) => {
      for (const payload of _sse.push(chunk)) {
        applyOpenAIStreamPayload(payload, _state, _emitToken, _emitThinking, _emitToolCall)
      }
    },
    { provider: providerId },
  )

  const _toolCalls = finalizeOpenAIStreamToolCalls(_state.toolAccumulators)

  return toMetaResponse({
    provider: providerLabel,
    model,
    text: _state.text,
    usage: normalizeUsage(_state.usage),
    toolCalls: _toolCalls,
    stopReason: _state.finishReason,
    thinkingText: _state.thinking,
  })
}

export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1'
export const OPENCODE_DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1'
const OPENCODE_LEGACY_BASE_URL = 'https://api.opencode.ai/v1'

// ── Base URL helpers ──────────────────────────────────────────────────────────

export function getOpenCodeBaseUrl(settings?: AISettings): string {
  const _configured = settings?.ai_opencode_url || OPENCODE_DEFAULT_BASE_URL
  const _normalized = normalizeOpenAICompatibleBaseUrl(_configured)
  if (!_normalized) return OPENCODE_DEFAULT_BASE_URL

  try {
    const _parsed = new URL(_normalized)
    const _host = String(_parsed.hostname || '').toLowerCase()
    const _path = String(_parsed.pathname || '')
      .replace(/\/+$/, '')
      .toLowerCase()

    if (_host === 'api.opencode.ai') return OPENCODE_DEFAULT_BASE_URL

    if (_host === 'opencode.ai' && /^\/v\d+$/.test(_path)) {
      return `${_parsed.protocol}//${_parsed.host}/zen${_path}`
    }
  } catch {
    if (_normalized === OPENCODE_LEGACY_BASE_URL) return OPENCODE_DEFAULT_BASE_URL
  }

  return _normalized
}

// ── Shared OpenAI-compatible call ─────────────────────────────────────────────

export async function callOpenAICompatible(
  messages: readonly AIMessage[],
  options: OpenAICompatibleOptions,
  fetchFn: ProviderFetch,
): Promise<ProviderMeta> {
  const {
    apiKey,
    model,
    baseUrl,
    providerLabel,
    providerId = providerLabel,
    extraHeaders = {},
    tools,
    toolChoice,
    onToken,
    onThinkingToken,
    onToolCall,
    streamFn,
    settings,
  } = options
  const _apiKey = normalizeApiKey(apiKey)
  const _baseUrl = normalizeOpenAICompatibleBaseUrl(baseUrl)

  if (!_apiKey) {
    throw new Error(`${providerLabel} API key not configured. Please add it in Settings.`)
  }
  if (!model) {
    throw new Error(`${providerLabel} model is not configured. Please set a model in Settings.`)
  }
  if (!_baseUrl) throw new Error(`${providerLabel} base URL is not configured.`)

  const _normalizedMessages = normalizeOpenAIMessages(messages)
  const _body = buildOpenAIRequestBody(_normalizedMessages, {
    model,
    providerId,
    settings,
    tools,
    toolChoice,
  })

  // Token-streaming path (when the runtime requests it for answer, reasoning, or
  // live tool-call args).
  if (
    (typeof onToken === 'function' || typeof onThinkingToken === 'function' || typeof onToolCall === 'function') &&
    typeof streamFn === 'function'
  ) {
    return streamOpenAICompatible({
      baseUrl: _baseUrl,
      apiKey: _apiKey,
      extraHeaders,
      body: _body,
      model,
      providerId,
      providerLabel,
      onToken,
      onThinkingToken,
      onToolCall,
      streamFn,
    })
  }

  const _res = await fetchFn(`${_baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(_body),
  })

  if (!_res.ok) {
    const _err = (await _res.json().catch(() => ({}))) as OpenAIErrorResponse
    throw new Error(_err?.error?.message || `${providerLabel} error: ${_res.status}`)
  }

  const _data = (await _res.json()) as OpenAIChatResponse
  return parseOpenAIChatResponse(_data, providerLabel, model)
}

// ── Named provider wrappers ───────────────────────────────────────────────────

export async function callOpenAI(
  messages: readonly AIMessage[],
  apiKey: unknown,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  return callOpenAICompatible(
    messages,
    {
      apiKey,
      model,
      baseUrl: OPENAI_API_BASE_URL,
      providerId: 'openai',
      providerLabel: 'OpenAI',
      ...options,
    },
    fetchFn,
  )
}

// Invokes the configured OpenCode-compatible endpoint and returns the shared provider response
// shape.
export async function callOpenCode(
  messages: readonly AIMessage[],
  apiKey: unknown,
  model: string,
  settings: AISettings,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  return callOpenAICompatible(
    messages,
    {
      apiKey,
      model,
      baseUrl: getOpenCodeBaseUrl(settings),
      providerId: 'opencode',
      providerLabel: 'OpenCode',
      ...options,
    },
    fetchFn,
  )
}

// ── Model discovery ───────────────────────────────────────────────────────────

/**
 * Fetch the model list from any OpenAI-compatible /models endpoint.
 * Returns [] if the key or URL is missing or the request fails.
 */
export async function listOpenAICompatibleModels(
  options: OpenAIModelDiscoveryOptions,
  fetchFn: ProviderFetch,
): Promise<string[]> {
  const { apiKey, baseUrl, extraHeaders = {} } = options
  const _apiKey = normalizeApiKey(apiKey)
  const _baseUrl = normalizeOpenAICompatibleBaseUrl(baseUrl)
  if (!_apiKey || !_baseUrl) return []

  const _res = await fetchFn(`${_baseUrl}/models`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_apiKey}`,
      ...extraHeaders,
    },
  })

  if (!_res.ok) return []

  const _data = (await _res.json().catch(() => ({}))) as OpenAIModelListResponse | Array<{ id?: string; name?: string }>
  const _raw = Array.isArray(_data) ? _data : (_data?.data ?? [])

  return _raw
    .map((entry) => String(entry?.id || entry?.name || ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
