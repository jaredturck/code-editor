/**
 * Exercises the observable ai service contract, with regression cases for “rejects cloud
 * calls without a configured key” and “builds and normalizes an OpenAI request”. The suite
 * documents caller-visible behavior so implementation refactors cannot silently weaken
 * those guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI, callAIWithMeta, testConnection } from '@/platform/aiService'
import type { AIMessage, AISettings } from '@/platform/providers/types'
import { clearKey, setKey } from '@/platform/keyStore'
import { normalizeOpenAIMessages } from '@/platform/providers/openaiProvider'
import { jsonResponse, parseFetchCall } from '../helpers/http'

const messages: AIMessage[] = [
  { role: 'system', content: 'System instruction' },
  { role: 'user', content: 'Hello' },
]

// Updates AI service with the supplied settings value.
function settings(provider: string, overrides: Partial<AISettings> = {}): AISettings {
  return {
    ai_provider: provider,
    ai_api_key: 'fake-legacy-key',
    ai_model: 'test-model',
    ai_local_url: 'http://127.0.0.1:11434',
    ...overrides,
  }
}

beforeEach(() => {
  setKey('openai', 'fake-legacy-key')
  setKey('opencode', 'fake-opencode-key')
  setKey('openrouter', 'fake-legacy-key')
  setKey('anthropic', 'fake-legacy-key')
  setKey('gemini', 'fake-legacy-key')
  setKey('deepseek', 'fake-deepseek-key')
})

describe('aiService', () => {
  it('rejects cloud calls without a configured key', async () => {
    clearKey('openai')
    await expect(callAIWithMeta(messages, settings('openai', { ai_api_key: '' }))).rejects.toThrow(
      'API key not configured',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds and normalizes an OpenAI request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'OpenAI reply' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(messages, settings('openai', { ai_model: 'gpt-test' }))
    const request = parseFetchCall(fetchMock)

    expect(request.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(request.options.headers?.Authorization).toBe('Bearer fake-legacy-key')
    expect(request.body).toMatchObject({
      model: 'gpt-test',
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: 'System instruction' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
    })
    expect(request.body.max_tokens).toBeGreaterThan(0)
    expect(result).toEqual({
      provider: 'OpenAI',
      model: 'gpt-test',
      text: 'OpenAI reply',
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 14,
        estimated: false,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      toolCalls: [],
      stopReason: '',
      thinkingText: '',
    })
  })

  it('uses the first-class DeepSeek endpoint and provider metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'DeepSeek reply' } }],
        usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(messages, settings('deepseek', { ai_model: 'deepseek-v4-pro' }))
    const request = parseFetchCall(fetchMock)

    expect(request.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(request.options.headers?.Authorization).toBe('Bearer fake-deepseek-key')
    expect(request.body.model).toBe('deepseek-v4-pro')
    expect(result).toMatchObject({
      provider: 'DeepSeek',
      model: 'deepseek-v4-pro',
      text: 'DeepSeek reply',
    })
  })

  it('replays DeepSeek reasoning content on assistant tool turns', () => {
    expect(
      normalizeOpenAIMessages([
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'Inspect the requested file first.',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'files.read',
              args: { path: 'README.md' },
            },
          ],
        },
      ])[0],
    ).toMatchObject({
      role: 'assistant',
      reasoning_content: 'Inspect the requested file first.',
    })
  })

  it('uses the per-provider key from Electron secure storage', async () => {
    setKey('openai', 'stored-fake-key')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await callAIWithMeta(messages, settings('openai'))
    expect(parseFetchCall(fetchMock).options.headers?.Authorization).toBe('Bearer stored-fake-key')
  })

  it('returns only response text through callAI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'text only' } }] })),
    )
    await expect(callAI(messages, settings('openai'))).resolves.toBe('text only')
  })

  it('surfaces provider error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: { message: 'invalid fake key' },
          },
          { ok: false, status: 401 },
        ),
      ),
    )
    await expect(callAIWithMeta(messages, settings('openai'))).rejects.toThrow('invalid fake key')
  })

  it('normalizes OpenCode base URLs and strips Bearer prefixes', async () => {
    setKey('opencode', 'Bearer fake-opencode-key')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await callAIWithMeta(
      messages,
      settings('opencode', {
        ai_api_key: 'Bearer fake-opencode-key',
        ai_opencode_url: 'api.opencode.ai/v1/chat/completions',
      }),
    )

    const request = parseFetchCall(fetchMock)
    expect(request.url).toBe('https://opencode.ai/zen/v1/chat/completions')
    expect(request.options.headers?.Authorization).toBe('Bearer fake-opencode-key')
  })

  it('identifies a custom OpenCode endpoint when proxy fallback is required', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('cors blocked'))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          status: 200,
          data: { choices: [{ message: { content: 'proxied custom reply' } }] },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(
      messages,
      settings('opencode', {
        ai_opencode_url: 'https://models.example.test/v1',
      }),
    )

    const proxyCall = parseFetchCall(fetchMock, 1)
    expect(proxyCall.url).toBe('/api/local/ai/proxy')
    expect(proxyCall.body).toMatchObject({
      provider: 'opencode',
      url: 'https://models.example.test/v1/chat/completions',
    })
    expect(result.text).toBe('proxied custom reply')
  })

  it('adds OpenRouter attribution headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await callAIWithMeta(messages, settings('openrouter', { ai_model: 'openai/gpt-4o' }))
    const headers = parseFetchCall(fetchMock).options.headers
    expect(headers).toMatchObject({
      Authorization: 'Bearer fake-legacy-key',
      'HTTP-Referer': 'iris-agentics',
      'X-Title': 'IRIS',
    })
  })

  it('converts Anthropic messages, images, thinking settings, and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'Anthropic reply' },
        ],
        usage: { input_tokens: 12, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(
      [
        { role: 'system', content: 'System' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
          ],
        },
      ],
      settings('anthropic', {
        ai_model: 'claude-sonnet-4-6',
        extended_thinking: true,
        thinking_budget_tokens: 2000,
        reasoning_effort: 'high',
      }),
    )

    const request = parseFetchCall(fetchMock)
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.options.headers?.['anthropic-beta']).toBeUndefined()
    expect(request.body.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
    expect(request.body.output_config).toEqual({ effort: 'high' })
    expect(request.body.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
    expect(result).toEqual({
      provider: 'Anthropic',
      model: 'claude-sonnet-4-6',
      text: 'Anthropic reply',
      usage: {
        promptTokens: 12,
        completionTokens: 6,
        totalTokens: 18,
        estimated: false,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      toolCalls: [],
      stopReason: '',
      thinkingText: 'hidden',
    })
  })

  it('converts Gemini roles and inline image data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 3,
          totalTokenCount: 11,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(
      [
        { role: 'system', content: 'Ignored by Gemini payload' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,BBBB' },
            },
          ],
        },
        { role: 'assistant', content: 'Previous answer' },
      ],
      settings('gemini', { ai_model: 'gemini-test' }),
    )

    const request = parseFetchCall(fetchMock)
    expect(request.url).toContain('/models/gemini-test:generateContent?key=fake-legacy-key')
    expect(request.body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Look' }, { inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }],
      },
      { role: 'model', parts: [{ text: 'Previous answer' }] },
    ])
    expect(result.usage?.totalTokens).toBe(11)
  })

  it('calls the local Ollama-style endpoint without a key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: 'Local reply' },
        prompt_eval_count: 9,
        eval_count: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe screen' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
          ],
        },
      ],
      settings('local', { ai_api_key: '', ai_model: 'llama3' }),
    )

    const request = parseFetchCall(fetchMock)
    expect(request.url).toBe('http://127.0.0.1:11434/api/chat')
    expect(request.body.messages[0]).toEqual({
      role: 'user',
      content: 'Describe screen',
      images: ['AAAA'],
    })
    expect(result).toMatchObject({
      provider: 'Local',
      model: 'llama3',
      text: 'Local reply',
    })
    expect(result.usage?.totalTokens).toBe(11)
  })

  it('hard-blocks cloud dispatch when a chat is running in enforced local-only mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: 'Local-only reply' },
        prompt_eval_count: 4,
        eval_count: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(
      messages,
      settings('openai', {
        ai_model: 'gpt-cloud',
        agent_local_only_enforced: true,
        agent_primary_assignment_id: 'orchestrator:local:qwen3.5:9b:1',
        agent_models: [
          {
            id: 'orchestrator:local:qwen3.5:9b:1',
            role: 'orchestrator',
            provider: 'local',
            model: 'qwen3.5:9b',
            keyId: '1',
            primary: true,
            tags: [],
            disabledTags: [],
          },
        ],
      }),
    )

    const request = parseFetchCall(fetchMock)
    expect(request.url).toBe('http://127.0.0.1:11434/api/chat')
    expect(request.body.model).toBe('qwen3.5:9b')
    expect(result).toMatchObject({
      provider: 'Local',
      model: 'qwen3.5:9b',
      text: 'Local-only reply',
    })
  })

  it('falls back from the Ollama endpoint to OpenAI-compatible local chat', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, options: RequestInit = {}) => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/api/chat')) {
        return jsonResponse({}, { ok: false, status: 404 })
      }
      if (requestUrl === '/api/local/ai/proxy') {
        const proxyRequest = JSON.parse(String(options.body || '')) as {
          url?: string
        }
        if (String(proxyRequest.url).endsWith('/api/chat')) {
          return jsonResponse({ ok: false, status: 404, data: {} })
        }
        throw new Error(`Unexpected proxied URL: ${proxyRequest.url}`)
      }
      if (requestUrl.endsWith('/v1/chat/completions')) {
        return jsonResponse({
          choices: [{ message: { content: 'Fallback reply' } }],
          usage: { total_tokens: 5 },
        })
      }
      throw new Error(`Unexpected mocked URL: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(messages, settings('local', { ai_api_key: '' }))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/v1/chat/completions'))).toBe(true)
    expect(result.text).toBe('Fallback reply')
  })

  it('uses the local bridge only after direct fetch fails', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          status: 200,
          data: { choices: [{ message: { content: 'Proxied reply' } }] },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIWithMeta(messages, settings('openai'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(parseFetchCall(fetchMock, 1).url).toBe('/api/local/ai/proxy')
    expect(result.text).toBe('Proxied reply')
  })

  it('handles unknown providers deterministically', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await callAIWithMeta(messages, settings('unknown'))
      expect(result.provider).toBe('OpenAI')
      expect(parseFetchCall(fetchMock).url).toBe('https://api.openai.com/v1/chat/completions')
    } catch (error) {
      expect(String(error instanceof Error ? error.message : error)).toContain('Unknown AI provider')
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('reports unavailable selected models without making a chat call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await testConnection(settings('openai', { ai_model: 'missing-model' }))
    expect(result.models).toEqual(['model-a', 'model-b'])
    expect(typeof result.ok).toBe('boolean')
    expect(result.message).toContain('missing-model')
    expect(result.message.toLowerCase()).toContain("isn't in the list")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tests a mocked provider connection and returns detected models', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-a' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await testConnection(settings('openai', { ai_model: 'model-a' }))
    expect(result.ok).toBe(true)
    expect(result.models.length).toBeGreaterThan(0)
    expect(result.models.every((model) => model === 'model-a')).toBe(true)
    expect(result.message).toBe('Connected. 2 models available for this key.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('converts connection failures to a stable result object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad key' } }, { ok: false, status: 401 })),
    )
    const result = await testConnection(settings('gemini'))
    expect(result).toEqual({ ok: false, models: [], message: 'bad key' })
  })
})
