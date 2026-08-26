/** Protects local multimodal request formatting for Ollama and LM Studio. */

import { describe, expect, it, vi } from 'vitest'
import { callLocalLLM } from '@/platform/providers/localProvider'
import { jsonResponse, parseFetchCall } from '../helpers/http'

const MESSAGES = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this screen' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,QUJDRA==' },
      },
    ],
  },
]

describe('localProvider multimodal requests', () => {
  it('sends base64 image payloads through Ollama /api/chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: 'visible screen' },
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    )

    const result = await callLocalLLM(MESSAGES, 'http://localhost:11434', 'qwen2.5vl:7b', fetchMock)

    expect(result.text).toBe('visible screen')
    const request = parseFetchCall(fetchMock)
    expect(request.url).toBe('http://127.0.0.1:11434/api/chat')
    expect(request.body.messages[0]).toEqual({
      role: 'user',
      content: 'Describe this screen',
      images: ['QUJDRA=='],
    })
  })

  it('preserves image_url content when Ollama falls back to an OpenAI-compatible local server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'not ollama' }, { ok: false, status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'lm studio result' } }],
          usage: {},
        }),
      )

    const result = await callLocalLLM(MESSAGES, 'http://localhost:1234', 'local-vlm', fetchMock)

    expect(result.text).toBe('lm studio result')
    const request = parseFetchCall(fetchMock, 1)
    expect(request.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(request.body.messages[0].content).toEqual([
      { type: 'text', text: 'Describe this screen' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,QUJDRA==' },
      },
    ])
  })
})

describe('localProvider streamed completions', () => {
  it('streams every Ollama token delta over one request and returns the complete text', async () => {
    const onToken = vi.fn()
    const streamFn = vi.fn(async (url, init, onChunk) => {
      onChunk('{"message":{"content":"A cat "},"done":false}\n')
      onChunk('{"message":{"content":"is a pet."},"done":false}\n')
      onChunk('{"done":true,"prompt_eval_count":8,"eval_count":4}\n')
      return { ok: true, status: 200 }
    })
    const fetchMock = vi.fn()

    const result = await callLocalLLM(
      [{ role: 'user', content: 'What is a cat?' }],
      'http://localhost:11434',
      'qwen3:4b',
      fetchMock,
      { onToken, streamFn },
    )

    expect(result.text).toBe('A cat is a pet.')
    expect(onToken.mock.calls.flat()).toEqual(['A cat ', 'is a pet.'])
    expect(streamFn).toHaveBeenCalledTimes(1)
    expect(streamFn.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat')
    expect(JSON.parse(String(streamFn.mock.calls[0][1].body))).toMatchObject({
      stream: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('streams Ollama thinking separately and retains provider timing metadata', async () => {
    const onToken = vi.fn()
    const onThinkingToken = vi.fn()
    const streamFn = vi.fn(async (_url, _init, onChunk) => {
      onChunk('{"message":{"thinking":"Inspecting the evidence. "},"done":false}\n')
      onChunk('{"message":{"thinking":"Planning the answer."},"done":false}\n')
      onChunk('{"message":{"content":"Final answer"},"done":false}\n')
      onChunk(
        '{"done":true,"total_duration":9000000000,"load_duration":100000000,"prompt_eval_duration":2500000000,"eval_duration":6000000000,"prompt_eval_count":40,"eval_count":20}\n',
      )
      return { ok: true, status: 200 }
    })

    const result = await callLocalLLM(
      [{ role: 'user', content: 'Question' }],
      'http://localhost:11434',
      'qwen3:4b',
      vi.fn(),
      { onToken, onThinkingToken, streamFn },
    )

    expect(onThinkingToken.mock.calls.flat()).toEqual(['Inspecting the evidence. ', 'Planning the answer.'])
    expect(onToken).toHaveBeenCalledWith('Final answer')
    expect(result.thinkingText).toBe('Inspecting the evidence. Planning the answer.')
    expect(result.timings).toMatchObject({
      totalMs: 9000,
      loadMs: 100,
      promptEvalMs: 2500,
      generationMs: 6000,
    })
  })

  it('falls back to an OpenAI-compatible local stream only before text has been emitted', async () => {
    const onToken = vi.fn()
    const streamFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Ollama unavailable'))
      .mockImplementationOnce(async (_url, _init, onChunk) => {
        onChunk('data: {"choices":[{"delta":{"content":"Fallback answer"}}]}\n\n')
        onChunk('data: [DONE]\n\n')
        return { ok: true, status: 200 }
      })

    const result = await callLocalLLM(
      [{ role: 'user', content: 'Question' }],
      'http://localhost:1234',
      'local-model',
      vi.fn(),
      { onToken, streamFn },
    )

    expect(result.text).toBe('Fallback answer')
    expect(onToken).toHaveBeenCalledWith('Fallback answer')
    expect(streamFn.mock.calls[1][0]).toBe('http://127.0.0.1:1234/v1/chat/completions')
  })
})
