import { afterEach, describe, expect, it } from 'vitest'

import {
  acquireAgentWriteLease,
  clearAgentWriteLeases,
  listAgentWriteLeases,
  releaseTaskWriteLeases,
} from '../src/platform/agent/writeLease'

afterEach(() => clearAgentWriteLeases())

describe('agent write leases', () => {
  it('lets one task refresh its own lease without losing the original acquisition time', () => {
    const first = acquireAgentWriteLease('/workspace/a.ts', 'executor', 'task-a', { now: 1000, ttl_ms: 10_000 })
    const refreshed = acquireAgentWriteLease('/workspace/a.ts', 'executor', 'task-a', { now: 3000, ttl_ms: 10_000 })

    expect(refreshed.acquired_at).toBe(first.acquired_at)
    expect(refreshed.updated_at).toBe(3000)
    expect(refreshed.expires_at).toBe(13_000)
  })

  it('rejects a second task that tries to claim the same file', () => {
    acquireAgentWriteLease('/workspace/a.ts', 'executor', 'task-a', { now: 1000 })

    expect(() => acquireAgentWriteLease('/workspace/a.ts', 'scout', 'task-b', { now: 2000 })).toThrow(
      /Write lease conflict/,
    )
  })

  it('releases every file owned by a settled task', () => {
    acquireAgentWriteLease('/workspace/a.ts', 'executor', 'task-a', { now: 1000 })
    acquireAgentWriteLease('/workspace/b.ts', 'executor', 'task-a', { now: 1000 })
    acquireAgentWriteLease('/workspace/c.ts', 'executor', 'task-b', { now: 1000 })

    expect(releaseTaskWriteLeases('task-a')).toBe(2)
    expect(listAgentWriteLeases(2000).map((lease) => lease.task_id)).toEqual(['task-b'])
  })

  it('allows another task to claim a file after the old lease expires', () => {
    acquireAgentWriteLease('/workspace/a.ts', 'executor', 'task-a', { now: 1000, ttl_ms: 5000 })
    const next = acquireAgentWriteLease('/workspace/a.ts', 'scout', 'task-b', { now: 7000, ttl_ms: 5000 })

    expect(next.owner_id).toBe('scout')
    expect(next.task_id).toBe('task-b')
  })
})
