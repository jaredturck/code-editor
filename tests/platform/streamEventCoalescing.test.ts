import { afterEach, describe, expect, it, vi } from 'vitest'
import { withThrottledStreamEvents } from '@/platform/agentRuntime'

afterEach(() => {
  vi.useRealTimers()
})

describe('agent stream event coalescing', () => {
  it('coalesces same-step stream deltas before they reach the UI', () => {
    vi.useFakeTimers()
    const events: Array<Record<string, unknown>> = []
    const wrapped = withThrottledStreamEvents(
      {
        onEvent: (event: Record<string, unknown>) => events.push(event),
      } as never,
      80,
    )

    wrapped.input.onEvent?.({ type: 'stream', step: 1, delta: 'hello ' } as never)
    wrapped.input.onEvent?.({ type: 'stream', step: 1, delta: 'world' } as never)

    expect(events).toEqual([])
    vi.advanceTimersByTime(80)
    expect(events).toEqual([expect.objectContaining({ type: 'stream', step: 1, delta: 'hello world' })])
  })

  it('flushes pending text before a non-stream event or a new stream step', () => {
    vi.useFakeTimers()
    const events: Array<Record<string, unknown>> = []
    const wrapped = withThrottledStreamEvents(
      {
        onEvent: (event: Record<string, unknown>) => events.push(event),
      } as never,
      80,
    )

    wrapped.input.onEvent?.({ type: 'stream', step: 1, delta: 'first' } as never)
    wrapped.input.onEvent?.({ type: 'stream', step: 2, delta: 'second' } as never)
    expect(events).toEqual([expect.objectContaining({ type: 'stream', step: 1, delta: 'first' })])

    wrapped.input.onEvent?.({ type: 'notice', summary: 'done' } as never)
    expect(events).toEqual([
      expect.objectContaining({ type: 'stream', step: 1, delta: 'first' }),
      expect.objectContaining({ type: 'stream', step: 2, delta: 'second' }),
      expect.objectContaining({ type: 'notice', summary: 'done' }),
    ])
  })
})
