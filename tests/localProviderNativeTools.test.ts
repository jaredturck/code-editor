import { describe, expect, it, vi } from 'vitest'

import { callLocalLLM } from '../src/platform/providers/localProvider'
import { getModelCapabilities, supportsNativeTools } from '../src/platform/modelProfiles'
import { useStatefulLoop } from '../src/platform/agent/runtime/config'

function response_json(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

describe('local Qwen native tool calling', () => {
  it('routes qwen3.5 through the native stateful tool protocol', () => {
    const capabilities = getModelCapabilities('local', 'qwen3.5:9b')

    expect(capabilities.family).toBe('qwen35')
    expect(capabilities.toolProtocol).toBe('native')
    expect(supportsNativeTools('local', 'qwen3.5:9b')).toBe(true)
    expect(
      useStatefulLoop({
        ai_provider: 'local',
        ai_model: 'qwen3.5:9b',
        agent_stateful_loop: 'auto',
      }),
    ).toBe(true)
  })

  it('round-trips Ollama tool calls and persistent tool-result history', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetch_fn = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      requests.push(request)

      if (requests.length === 1) {
        return response_json({
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                function: {
                  name: 'files__read',
                  arguments: { path: '/workspace/app.py' },
                },
              },
            ],
          },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 20,
          eval_count: 8,
        })
      }

      return response_json({
        message: { content: 'I have the file contents and can continue.' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 42,
        eval_count: 10,
      })
    })

    const tools = [
      {
        name: 'files.read',
        description: 'Read a file.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]

    const first = await callLocalLLM(
      [{ role: 'user', content: 'Inspect app.py.' }],
      'http://localhost:11434',
      'qwen3.5:9b',
      fetch_fn as never,
      {
        tools,
        onToken: vi.fn(),
        streamFn: vi.fn() as never,
      },
    )

    expect(first.toolCalls).toEqual([
      expect.objectContaining({
        id: 'call-1',
        name: 'files.read',
        args: { path: '/workspace/app.py' },
      }),
    ])
    expect(requests[0].stream).toBe(false)
    expect((requests[0].tools as any[])[0].function.name).toBe('files__read')

    const full_tool_result = 'from flask import Flask, render_template\n' + 'x'.repeat(4000)
    const second = await callLocalLLM(
      [
        { role: 'user', content: 'Inspect app.py.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'files.read',
              args: { path: '/workspace/app.py' },
            },
          ],
        },
        {
          role: 'tool',
          toolResults: [
            {
              id: 'call-1',
              name: 'files.read',
              content: full_tool_result,
            },
          ],
        },
      ],
      'http://localhost:11434',
      'qwen3.5:9b',
      fetch_fn as never,
      { tools },
    )

    const second_messages = requests[1].messages as any[]
    expect(second_messages[1].tool_calls[0].function.name).toBe('files__read')
    expect(second_messages[1].tool_calls[0].function.arguments).toEqual({
      path: '/workspace/app.py',
    })
    expect(second_messages[2]).toEqual(
      expect.objectContaining({
        role: 'tool',
        tool_name: 'files__read',
        content: full_tool_result,
      }),
    )
    expect(second.text).toBe('I have the file contents and can continue.')
  })

  it('uses Ollama JSON schema constrained output when a response schema is supplied', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetch_fn = vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return response_json({
        message: { content: '{"answer":"ok"}' },
        done: true,
        done_reason: 'stop',
      })
    })
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }

    await callLocalLLM(
      [{ role: 'user', content: 'Return the result.' }],
      'http://localhost:11434',
      'qwen3.5:9b',
      fetch_fn as never,
      { responseSchema: { name: 'agent-response', schema } },
    )

    expect(requests[0].format).toEqual(schema)
  })

  it('maps constrained output to LM Studio response_format on fallback', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetch_fn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/chat')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'Ollama unavailable',
        }
      }
      return response_json({ choices: [{ message: { content: '{"answer":"ok"}' } }] })
    })
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }

    await callLocalLLM(
      [{ role: 'user', content: 'Return the result.' }],
      'http://localhost:1234',
      'local-model',
      fetch_fn as never,
      { responseSchema: { name: 'agent response', schema } },
    )

    expect(requests[1].body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'agent_response',
        strict: true,
        schema,
      },
    })
  })
})
