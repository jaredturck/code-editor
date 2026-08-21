/**
 * Exercises the observable provider registry contract, with regression cases for “registers
 * one complete entry for every supported provider” and “keeps defaults and key requirements
 * aligned with registered definitions”. The suite documents caller-visible behavior so
 * implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_DEFINITIONS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER_ID,
  findAIProvider,
  getAIProvider,
  isAIProviderId,
  listAIProviders,
} from '@/platform/providers/providerRegistry';
import { parseBase64DataUrl, parseToolArguments } from '@/platform/providers/providerUtils';
import { callAnthropic } from '@/platform/providers/anthropicProvider';

describe('providerRegistry', () => {
  it('registers one complete entry for every supported provider', () => {
    const providers = listAIProviders();
    const ids = providers.map((provider) => provider.id);

    expect(ids).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'deepseek',
      'opencode',
      'openrouter',
      'local',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AI_PROVIDER_DEFINITIONS.map((provider) => provider.id)).toEqual(ids);

    for (const provider of providers) {
      expect(provider.label).toBeTruthy();
      expect(provider.defaultModel).toBeTruthy();
      expect(provider.models.length).toBeGreaterThan(0);
      expect(typeof provider.invoke).toBe('function');
      expect(typeof provider.discoverModels).toBe('function');
    }
  });

  it('keeps defaults and key requirements aligned with registered definitions', () => {
    expect(DEFAULT_AI_PROVIDER_ID).toBe('openai');
    expect(DEFAULT_AI_MODEL).toBe(getAIProvider(DEFAULT_AI_PROVIDER_ID).defaultModel);
    expect(getAIProvider('local').requiresApiKey).toBe(false);
    expect(
      listAIProviders()
        .filter((provider) => provider.id !== 'local')
        .every((provider) => provider.requiresApiKey),
    ).toBe(true);
  });

  it('provides official key-help pages for every cloud provider', () => {
    const providers = listAIProviders();

    expect(getAIProvider('local').keyHelpUrl).toBeNull();
    expect(
      providers
        .filter((provider) => provider.requiresApiKey)
        .every((provider) => provider.keyHelpUrl?.startsWith('https://')),
    ).toBe(true);
  });

  it('normalizes lookups and reports unknown providers from the live registry', () => {
    expect(isAIProviderId('OpenRouter')).toBe(true);
    expect(findAIProvider('OPENAI')?.id).toBe('openai');
    expect(findAIProvider('missing')).toBeNull();
    expect(() => getAIProvider('missing')).toThrow(
      'Valid providers: anthropic, openai, gemini, deepseek, opencode, openrouter, local.',
    );
  });
});

describe('provider utility cleanup', () => {
  it('parses tool argument JSON consistently and preserves malformed input', () => {
    expect(parseToolArguments('{"path":"a.txt"}')).toEqual({
      args: { path: 'a.txt' },
      argsError: false,
    });
    expect(parseToolArguments('{"path":')).toEqual({
      args: {},
      argsError: true,
      rawArgs: '{"path":',
    });
  });

  it('parses reusable base64 data URLs', () => {
    expect(parseBase64DataUrl('data:image/png;base64,AAAA')).toEqual({
      mimeType: 'image/png',
      data: 'AAAA',
    });
    expect(parseBase64DataUrl('https://example.test/image.png')).toBeNull();
  });

  it('streams Anthropic tool calls when onToolCall is the only callback', async () => {
    const events: Array<{ phase: string; [key: string]: unknown }> = [];
    const fetchFn = vi.fn();
    const streamFn = vi.fn(async (_url, _init, onChunk) => {
      onChunk(
        [
          'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"files__read"}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
          '',
        ].join('\n'),
      );
    });

    const result = await callAnthropic(
      [{ role: 'user', content: 'Read a file' }],
      'fake-key',
      'claude-sonnet-4-6',
      {},
      fetchFn,
      {
        onToolCall: (event: { phase: string; [key: string]: unknown }) => events.push(event),
        streamFn,
      },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledOnce();
    expect(events.map((event) => event.phase)).toEqual(['start', 'args']);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'tool-1',
      name: 'files.read',
      args: { path: 'a.txt' },
      argsError: false,
    });
  });
});
