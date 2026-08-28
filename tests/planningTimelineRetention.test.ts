import { describe, expect, it } from 'vitest'
import { sanitize_agent_timeline } from '../src/chat/agentChat'

describe('planning timeline retention', () => {
  it('keeps planning reasoning when later activity exceeds the chat history limit', () => {
    const planning = Array.from({ length: 4 }, (_, index) => ({
      type: 'planning',
      label: `Planning stage ${index + 1}`,
      summary: `Planning output ${index + 1}`,
      at: index + 1,
    }))
    const activity = Array.from({ length: 240 }, (_, index) => ({
      type: 'notice',
      summary: `Later activity ${index + 1}`,
      at: index + 10,
    }))

    const sanitized = sanitize_agent_timeline([...planning, ...activity])

    expect(sanitized).toHaveLength(200)
    expect(sanitized.filter((event) => event.type === 'planning')).toHaveLength(4)
    expect(sanitized.some((event) => event.detail === 'Planning output 1')).toBe(true)
    expect(sanitized.at(-1)?.detail).toBe('Later activity 240')
  })
})
