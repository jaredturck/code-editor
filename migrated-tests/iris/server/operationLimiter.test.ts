/**
 * Exercises the observable operation limiter contract, with regression cases for “allows
 * bursts, limits overflow, and leaks capacity over time” and “limits active work
 * independently from the burst level”. The suite documents caller-visible behavior so
 * implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest'
import { LeakyBucketLimiter } from '../../server/desktopBridge/shared/operationLimiter'

describe('operation limiter', () => {
  it('allows bursts, limits overflow, and leaks capacity over time', () => {
    const limiter = new LeakyBucketLimiter({
      capacity: 2,
      leakPerSecond: 1,
      maxConcurrent: 3,
    })
    const first = limiter.acquire(1, 1000)
    const second = limiter.acquire(1, 1000)
    const blocked = limiter.acquire(1, 1000)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(blocked).toMatchObject({ allowed: false, code: 'rate_limited' })

    if (first.allowed) first.release()
    if (second.allowed) second.release()
    expect(limiter.acquire(1, 2000).allowed).toBe(true)
  })

  it('limits active work independently from the burst level', () => {
    const limiter = new LeakyBucketLimiter({
      capacity: 10,
      leakPerSecond: 10,
      maxConcurrent: 1,
    })
    const active = limiter.acquire(1, 1000)
    const blocked = limiter.acquire(1, 1000)

    expect(active.allowed).toBe(true)
    expect(blocked).toMatchObject({
      allowed: false,
      code: 'concurrency_limited',
    })

    if (active.allowed) active.release()
    expect(limiter.acquire(1, 1000).allowed).toBe(true)
  })
})
