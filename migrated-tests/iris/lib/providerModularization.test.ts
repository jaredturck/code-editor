/** Verifies extracted provider helpers preserve request, streaming, and response normalization. */

import { describe, expect, it, vi } from 'vitest';
import {
  applyAnthropicStreamPayload,
  buildAnthropicHeaders,
  buildAnthropicRequestBody,
  normalizeAnthropicMessages,
  parseAnthropicResponse,
  type AnthropicStreamState,
} from '../../src/lib/providers/anthropicProvider';
import {
  buildGeminiRequestBody,
  normalizeGeminiContents,
  parseGeminiResponse,
} from '../../src/lib/providers/geminiProvider';
import {
  applyOpenAIStreamPayload,
  buildOpenAIRequestBody,
  normalizeOpenAIMessages,
  parseOpenAIChatResponse,
  type OpenAIStreamState,
} from '../../src/lib/providers/openaiProvider';

const messages = [
  { role: 'system', content: 'system guidance' },
  { role: 'user', content: 'hello' },
  {
    role: 'assistant',
    content: 'checking',
    toolCalls: [{ id: 'call-1', name: 'files.read', args: { path: '/tmp/a' } }],
  },
  {
    role: 'tool',
    toolResults: [{ id: 'call-1', name: 'files.read', content: 'done' }],
  },
] as any;

describe('OpenAI provider modular helpers', () => {
  it('normalizes persistent tool turns and builds the same request controls', () => {
    const normalized = normalizeOpenAIMessages(messages);
    expect(normalized[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-1', function: { arguments: '{"path":"/tmp/a"}' } }],
    });
    expect(normalized[3]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'done' });

    expect(
      buildOpenAIRequestBody(normalized, {
        model: 'gpt-4o',
        providerId: 'openai',
        tools: [
          { name: 'files.read', description: 'Read', inputSchema: { type: 'object' } },
        ] as any,
      }),
    ).toMatchObject({ model: 'gpt-4o', messages: normalized, tool_choice: 'auto' });
  });

  it('applies streamed deltas and parses non-streaming metadata', () => {
    const state: OpenAIStreamState = {
      text: '',
      thinking: '',
      finishReason: '',
      usage: null,
      toolAccumulators: new Map(),
    };
    const onToken = vi.fn();
    applyOpenAIStreamPayload(
      JSON.stringify({ choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }] }),
      state,
      onToken,
      vi.fn(),
      vi.fn(),
    );
    expect(state).toMatchObject({ text: 'hello', finishReason: 'stop' });
    expect(onToken).toHaveBeenCalledWith('hello');

    expect(
      parseOpenAIChatResponse(
        {
          choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        } as any,
        'OpenAI',
        'gpt-4o',
      ),
    ).toMatchObject({ provider: 'OpenAI', model: 'gpt-4o', text: 'answer', stopReason: 'stop' });
  });
});

describe('Anthropic provider modular helpers', () => {
  it('normalizes tool turns and preserves legacy thinking request controls', () => {
    const normalized = normalizeAnthropicMessages(messages);
    expect(normalized[1]).toMatchObject({ role: 'assistant' });
    expect(normalized[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'done' }],
    });

    const settings = { extended_thinking: true, thinking_budget_tokens: 2000 } as any;
    expect(buildAnthropicRequestBody(messages, 'claude-sonnet-4-5', settings, {})).toMatchObject({
      model: 'claude-sonnet-4-5',
      thinking: { type: 'enabled', budget_tokens: 2000 },
    });
    expect(buildAnthropicHeaders('key', 'claude-sonnet-4-5', settings)).toMatchObject({
      'x-api-key': 'key',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    });
  });

  it('applies streamed text and parses content blocks', () => {
    const state: AnthropicStreamState = {
      text: '',
      thinking: '',
      stopReason: '',
      inputTokens: 0,
      outputTokens: 0,
      blocks: new Map(),
    };
    const onToken = vi.fn();
    applyAnthropicStreamPayload(
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' },
      }),
      state,
      onToken,
      vi.fn(),
      vi.fn(),
    );
    expect(state.text).toBe('hi');
    expect(onToken).toHaveBeenCalledWith('hi');

    expect(
      parseAnthropicResponse(
        {
          content: [{ type: 'text', text: 'answer' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 2, output_tokens: 3 },
        } as any,
        'claude-sonnet-4-6',
      ),
    ).toMatchObject({ text: 'answer', stopReason: 'end_turn' });
  });
});

describe('Gemini provider modular helpers', () => {
  it('normalizes messages, builds system instructions, and parses candidates', () => {
    const normalized = normalizeGeminiContents(messages);
    expect(normalized[1]).toMatchObject({ role: 'model' });
    expect(normalized[2]).toMatchObject({
      role: 'user',
      parts: [{ functionResponse: { response: { result: 'done' } } }],
    });

    expect(buildGeminiRequestBody(messages, 'gemini-2.0-flash', {})).toMatchObject({
      contents: normalized,
      system_instruction: { parts: [{ text: 'system guidance' }] },
    });

    expect(
      parseGeminiResponse(
        {
          candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
        } as any,
        'gemini-2.0-flash',
      ),
    ).toMatchObject({ provider: 'Gemini', text: 'answer', stopReason: 'STOP' });
  });
});
