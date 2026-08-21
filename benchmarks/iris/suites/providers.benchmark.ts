/** Benchmarks provider message conversion, request construction, stream parsing, and response normalization. */

import {
  applyAnthropicStreamPayload,
  buildAnthropicHeaders,
  buildAnthropicRequestBody,
  normalizeAnthropicMessages,
  parseAnthropicResponse,
  type AnthropicStreamState,
} from '../../../src/platform/providers/anthropicProvider.js';
import {
  buildGeminiRequestBody,
  normalizeGeminiContents,
  parseGeminiResponse,
} from '../../../src/platform/providers/geminiProvider.js';
import {
  applyOpenAIStreamPayload,
  buildOpenAIRequestBody,
  normalizeOpenAIMessages,
  parseOpenAIChatResponse,
  type OpenAIStreamState,
} from '../../../src/platform/providers/openaiProvider.js';
import type { BenchmarkDefinition } from '../core/types.js';

/** Creates a long provider-neutral conversation containing text, tool calls, and tool results. */
function providerMessages(turns = 100): any[] {
  const messages: any[] = [{ role: 'system', content: 'You are the IRIS benchmark agent.' }];
  for (let index = 0; index < turns; index += 1) {
    messages.push({
      role: 'user',
      content: `Inspect benchmark file ${index} and summarize the relevant state. ${'context '.repeat(20)}`,
    });
    messages.push({
      role: 'assistant',
      content: 'I will inspect the file.',
      toolCalls: [
        {
          id: `call-${index}`,
          name: 'files.read',
          args: { path: `/tmp/benchmark/file-${index}.txt`, maxChars: 16000 },
        },
      ],
    });
    messages.push({
      role: 'tool',
      toolResults: [
        {
          id: `call-${index}`,
          name: 'files.read',
          content: `Benchmark result ${index}: ${'data '.repeat(50)}`,
        },
      ],
    });
  }
  return messages;
}

/** Creates a representative canonical tool schema used by all provider adapters. */
function tools(): any[] {
  return [
    {
      name: 'files.read',
      description: 'Reads a text file inside the permitted workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxChars: { type: 'number' },
        },
        required: ['path'],
      },
    },
  ];
}

/** Creates fresh stream state so each measured parse starts from the same conditions. */
function openAIStreamState(): OpenAIStreamState {
  return {
    text: '',
    thinking: '',
    finishReason: '',
    usage: null,
    toolAccumulators: new Map(),
  };
}

/** Creates fresh Anthropic stream state so accumulator mutation remains representative. */
function anthropicStreamState(): AnthropicStreamState {
  return {
    text: '',
    thinking: '',
    stopReason: '',
    inputTokens: 0,
    outputTokens: 0,
    blocks: new Map(),
  };
}

/** Measures provider-specific conversion costs independently from network latency. */
export const providerBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'providers.openai.normalize.300-messages',
    suite: 'AI providers',
    name: 'OpenAI message normalization · 300 turns',
    description:
      'Converts persistent IRIS messages, tool calls, and tool results into OpenAI chat format.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 301,
    setup: () => ({ messages: providerMessages(100) }),
    run: (context) => normalizeOpenAIMessages(context.messages),
  },
  {
    id: 'providers.openai.request-build',
    suite: 'AI providers',
    name: 'OpenAI request construction',
    description:
      'Builds a native-tool request after provider message normalization and output-limit resolution.',
    iterations: 12,
    warmupIterations: 3,
    setup: () => ({ messages: providerMessages(100), tools: tools() }),
    run: (context) =>
      buildOpenAIRequestBody(normalizeOpenAIMessages(context.messages), {
        model: 'gpt-4o',
        providerId: 'openai',
        tools: context.tools,
      }),
  },
  {
    id: 'providers.openai.stream-deltas.1000',
    suite: 'AI providers',
    name: 'OpenAI stream delta parsing · 1,000 events',
    description: 'Parses and accumulates streamed text deltas without performing an HTTP request.',
    iterations: 10,
    warmupIterations: 3,
    operationsPerIteration: 1000,
    setup: () => ({
      payload: JSON.stringify({
        choices: [{ delta: { content: 'token' }, finish_reason: null }],
      }),
    }),
    run: (context) => {
      const state = openAIStreamState();
      for (let index = 0; index < 1000; index += 1) {
        applyOpenAIStreamPayload(
          context.payload,
          state,
          () => {},
          () => {},
          () => {},
        );
      }
      return state;
    },
  },
  {
    id: 'providers.openai.response-parse',
    suite: 'AI providers',
    name: 'OpenAI response normalization',
    description:
      'Normalizes text, tool calls, usage, and stop reasons into IRIS provider metadata.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 500,
    run: () => {
      let result: unknown;
      for (let index = 0; index < 500; index += 1) {
        result = parseOpenAIChatResponse(
          {
            choices: [
              {
                message: {
                  content: 'Completed benchmark response.',
                  tool_calls: [
                    {
                      id: `call-${index}`,
                      function: {
                        name: 'files__read',
                        arguments: '{"path":"/tmp/a"}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: {
              prompt_tokens: 2000,
              completion_tokens: 100,
              total_tokens: 2100,
            },
          } as any,
          'OpenAI',
          'gpt-4o',
        );
      }
      return result;
    },
  },
  {
    id: 'providers.anthropic.normalize.300-messages',
    suite: 'AI providers',
    name: 'Anthropic message normalization · 300 turns',
    description:
      'Converts the same persistent conversation into alternating Messages API content blocks.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 301,
    setup: () => ({ messages: providerMessages(100) }),
    run: (context) => normalizeAnthropicMessages(context.messages),
  },
  {
    id: 'providers.anthropic.request-build',
    suite: 'AI providers',
    name: 'Anthropic request construction',
    description:
      'Builds thinking, caching, tools, and token controls for a Claude native-tool request.',
    iterations: 12,
    warmupIterations: 3,
    setup: () => ({ messages: providerMessages(100), tools: tools() }),
    run: (context) => ({
      headers: buildAnthropicHeaders('benchmark-key', 'claude-sonnet-4-6', {
        extended_thinking: true,
        thinking_budget_tokens: 8000,
      } as any),
      body: buildAnthropicRequestBody(
        context.messages,
        'claude-sonnet-4-6',
        { extended_thinking: true, thinking_budget_tokens: 8000 } as any,
        { tools: context.tools } as any,
      ),
    }),
  },
  {
    id: 'providers.anthropic.stream-deltas.1000',
    suite: 'AI providers',
    name: 'Anthropic stream delta parsing · 1,000 events',
    description: 'Parses Messages API text deltas and updates the retained stream state.',
    iterations: 10,
    warmupIterations: 3,
    operationsPerIteration: 1000,
    setup: () => ({
      payload: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'token' },
      }),
    }),
    run: (context) => {
      const state = anthropicStreamState();
      for (let index = 0; index < 1000; index += 1) {
        applyAnthropicStreamPayload(
          context.payload,
          state,
          () => {},
          () => {},
          () => {},
        );
      }
      return state;
    },
  },
  {
    id: 'providers.anthropic.response-parse',
    suite: 'AI providers',
    name: 'Anthropic response normalization',
    description:
      'Normalizes text, tool-use blocks, usage, and stop reason into the shared provider result.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 500,
    run: () => {
      let result: unknown;
      for (let index = 0; index < 500; index += 1) {
        result = parseAnthropicResponse(
          {
            content: [
              { type: 'text', text: 'Completed benchmark response.' },
              {
                type: 'tool_use',
                id: `call-${index}`,
                name: 'files__read',
                input: { path: '/tmp/a' },
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 2000, output_tokens: 100 },
          } as any,
          'claude-sonnet-4-6',
        );
      }
      return result;
    },
  },
  {
    id: 'providers.gemini.normalize.300-messages',
    suite: 'AI providers',
    name: 'Gemini content normalization · 300 turns',
    description: 'Converts text, function calls, and function responses into Gemini content parts.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 301,
    setup: () => ({ messages: providerMessages(100) }),
    run: (context) => normalizeGeminiContents(context.messages),
  },
  {
    id: 'providers.gemini.request-build',
    suite: 'AI providers',
    name: 'Gemini request construction',
    description:
      'Builds contents, system instructions, tools, and generation configuration for Gemini.',
    iterations: 12,
    warmupIterations: 3,
    setup: () => ({ messages: providerMessages(100), tools: tools() }),
    run: (context) =>
      buildGeminiRequestBody(context.messages, 'gemini-2.0-flash', {
        tools: context.tools,
      } as any),
  },
  {
    id: 'providers.gemini.response-parse',
    suite: 'AI providers',
    name: 'Gemini response normalization',
    description: 'Normalizes candidate parts, function calls, token usage, and finish reasons.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 500,
    run: () => {
      let result: unknown;
      for (let index = 0; index < 500; index += 1) {
        result = parseGeminiResponse(
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'Completed benchmark response.' },
                    {
                      functionCall: {
                        name: 'files__read',
                        args: { path: `/tmp/${index}` },
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 2000,
              candidatesTokenCount: 100,
              totalTokenCount: 2100,
            },
          } as any,
          'gemini-2.0-flash',
        );
      }
      return result;
    },
  },
];
