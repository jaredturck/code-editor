import { describe, expect, it, vi } from 'vitest'
import { callLocalLLM } from '@/platform/providers/localProvider'
import { jsonResponse } from '../helpers/http'

describe('local Qwen tool-call recovery', () => {
  it('retries the known intermittent Qwen parser failure once', async () => {
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'expected element type <function> but have <parameter>' } },
          { ok: false, status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'Recovered response' } }],
          usage: { total_tokens: 5 },
        }),
      )

    const result = await callLocalLLM(
      [{ role: 'user', content: 'Read the project file.' }],
      'http://127.0.0.1:11434',
      'qwen3.5:9b',
      fetch_mock,
      {
        tools: [
          {
            name: 'files.read',
            description: 'Read a project file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      },
    )

    expect(fetch_mock).toHaveBeenCalledTimes(2)
    expect(result.text).toBe('Recovered response')
  })

  it('does not retry unrelated server failures', async () => {
    const fetch_mock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: 'model unavailable' } }, { ok: false, status: 500 }))

    await expect(
      callLocalLLM([{ role: 'user', content: 'Hello' }], 'http://127.0.0.1:11434', 'qwen3.5:9b', fetch_mock),
    ).rejects.toThrow('model unavailable')
    expect(fetch_mock).toHaveBeenCalledTimes(1)
  })
})
