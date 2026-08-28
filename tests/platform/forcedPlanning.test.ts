import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai_state = vi.hoisted(() => ({
  call: vi.fn(),
}))

vi.mock('@/platform/aiService', () => ({
  callAIWithMeta: ai_state.call,
}))

import { FORCED_PLANNING_STAGES, runForcedPlanning } from '@/platform/agent/forcedPlanning'

describe('forced project planning', () => {
  beforeEach(() => {
    ai_state.call.mockReset()
  })

  it('runs four domain-neutral planning turns without exposing tools', async () => {
    ai_state.call
      .mockResolvedValueOnce({ text: 'Many possible directions.' })
      .mockResolvedValueOnce({ text: 'The ideas developed further.' })
      .mockResolvedValueOnce({ text: 'A direction was selected.' })
      .mockResolvedValueOnce({ text: 'A detailed implementation plan.' })

    const events: Array<Record<string, unknown>> = []
    const result = await runForcedPlanning({
      request: 'Build the requested project',
      conversation: [],
      settings: { ai_provider: 'local', ai_model: 'qwen3.5:9b' },
      onEvent: (event) => events.push(event),
    })

    expect(ai_state.call).toHaveBeenCalledTimes(4)
    expect(result.artifacts).toHaveLength(4)
    expect(events.map((event) => event.type)).toEqual(['planning', 'planning', 'planning', 'planning'])
    expect(result.context).toContain('Many possible directions.')
    expect(result.context).toContain('A detailed implementation plan.')

    for (const call of ai_state.call.mock.calls) {
      const options = call[2] as Record<string, unknown>
      expect(options.tools).toBeUndefined()
      expect(options.toolChoice).toBeUndefined()
    }

    const prompts = FORCED_PLANNING_STAGES.map((stage) => stage.prompt).join(' ')
    expect(prompts).not.toMatch(/\b(?:website|html|css|react|gradient|typography|database|c\+\+)\b/i)
  })

  it('feeds each planning result into the next planning turn', async () => {
    ai_state.call
      .mockResolvedValueOnce({ text: 'first ideas' })
      .mockResolvedValueOnce({ text: 'expanded ideas' })
      .mockResolvedValueOnce({ text: 'chosen direction' })
      .mockResolvedValueOnce({ text: 'implementation plan' })

    await runForcedPlanning({
      request: 'Create something useful',
      conversation: [],
      settings: { ai_provider: 'local', ai_model: 'qwen3.5:9b' },
    })

    const second_messages = ai_state.call.mock.calls[1][0] as Array<Record<string, unknown>>
    const fourth_messages = ai_state.call.mock.calls[3][0] as Array<Record<string, unknown>>
    expect(second_messages.some((message) => message.role === 'assistant' && message.content === 'first ideas')).toBe(true)
    expect(fourth_messages.some((message) => message.role === 'assistant' && message.content === 'chosen direction')).toBe(true)
  })

  it('stops before execution when a planning stage returns no usable output', async () => {
    ai_state.call.mockResolvedValueOnce({ text: '' })

    await expect(
      runForcedPlanning({
        request: 'Build the project',
        conversation: [],
        settings: { ai_provider: 'local', ai_model: 'qwen3.5:9b' },
      }),
    ).rejects.toThrow('Planning stage')
  })
})
