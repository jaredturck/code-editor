/**
 * Exercises the observable workload limits contract, with regression cases for “allows work
 * below a limit and rejects work at the limit” and “keeps only the newest bounded history
 * entries”. The suite documents caller-visible behavior so implementation refactors cannot
 * silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest'
import {
  WorkloadLimitError,
  assertBelowLimit,
  boundedHistoryPush,
  hasQueuedTask,
  pruneOldestMapEntries,
  totalQueuedTasks,
} from '../../server/desktopBridge/shared/workloadLimits'

describe('workload limit helpers', () => {
  it('allows work below a limit and rejects work at the limit', () => {
    expect(() => assertBelowLimit(2, 3, 'queue')).not.toThrow()
    expect(() => assertBelowLimit(3, 3, 'queue')).toThrow(WorkloadLimitError)
  })

  it('keeps only the newest bounded history entries', () => {
    const history = [1, 2]
    boundedHistoryPush(history, 3, 2)
    expect(history).toEqual([2, 3])
  })

  it('counts queues, detects duplicates, and prunes oldest map entries', () => {
    const queues = new Map([
      ['executor', [{ taskId: 'a' }, { taskId: 'b' }]],
      ['scout', [{ taskId: 'c' }]],
    ])
    expect(totalQueuedTasks(queues)).toBe(3)
    expect(hasQueuedTask(queues, 'b')).toBe(true)
    expect(hasQueuedTask(queues, 'missing')).toBe(false)

    const items = new Map([
      ['oldest', 1],
      ['middle', 2],
      ['newest', 3],
    ])
    expect(pruneOldestMapEntries(items, 2)).toBe(1)
    expect([...items.keys()]).toEqual(['middle', 'newest'])
  })
})
