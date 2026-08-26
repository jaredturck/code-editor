/**
 * Exercises the model-health registry + best-fit failover picker (§F3): suspension after repeated
 * failures, per-(provider,model,key) isolation, success-clears, and the healthy replacement choice.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { clearKey, setKey } from '@/platform/keyStore'
import {
  recordModelFailure,
  recordModelSuccess,
  isModelHealthy,
  pickFailoverModel,
  resetModelHealth,
  resolveFailoverPolicy,
  modelHealthSnapshot,
} from '@/platform/agent/modelHealth'

const POOL = {
  agent_models: [
    { role: 'orchestrator', provider: 'anthropic', model: 'opus', keyId: '1', primary: true },
    { role: 'orchestrator', provider: 'anthropic', model: 'opus', keyId: '2' },
    { role: 'scout', provider: 'local', model: 'llama3', keyId: '1', primary: true },
  ],
}

describe('modelHealth', () => {
  beforeEach(() => {
    resetModelHealth()
    clearKey('anthropic', '1')
    clearKey('anthropic', '2')
    setKey('anthropic', 'test-key-1', '1')
    setKey('anthropic', 'test-key-2', '2')
  })

  it('suspends a model after consecutive failures and a success clears it', () => {
    expect(isModelHealthy('anthropic', 'opus', '1')).toBe(true)
    recordModelFailure('anthropic', 'opus', '1', { error: 'x' })
    expect(isModelHealthy('anthropic', 'opus', '1')).toBe(true) // one failure — not yet suspended
    recordModelFailure('anthropic', 'opus', '1', { error: 'x' })
    expect(isModelHealthy('anthropic', 'opus', '1')).toBe(false) // suspended after two
    recordModelSuccess('anthropic', 'opus', '1')
    expect(isModelHealthy('anthropic', 'opus', '1')).toBe(true)
  })

  it('tracks health per provider:model:key independently', () => {
    recordModelFailure('anthropic', 'opus', '1', {})
    recordModelFailure('anthropic', 'opus', '1', {})
    expect(isModelHealthy('anthropic', 'opus', '1')).toBe(false)
    expect(isModelHealthy('anthropic', 'opus', '2')).toBe(true) // a different key is unaffected
  })

  it('promotes a chronic failer to a long, persistent (cross-session) suspension', () => {
    // Six total failures crosses the persistence threshold → suspended for hours, not seconds, so
    // the next session keeps skipping it (the registry is persisted) instead of retrying it.
    for (let i = 0; i < 6; i += 1) recordModelFailure('openai', 'gpt', '1', { error: 'boom' })
    expect(isModelHealthy('openai', 'gpt', '1')).toBe(false)
    const entry = modelHealthSnapshot().find((e) => e.id === 'openai:gpt:1')
    expect(entry?.persistent).toBe(true)
    expect(entry!.cooldownUntil - Date.now()).toBeGreaterThan(60 * 60 * 1000)
    // A real success fully clears it — a recovered model rejoins the pool.
    recordModelSuccess('openai', 'gpt', '1')
    expect(isModelHealthy('openai', 'gpt', '1')).toBe(true)
    expect(modelHealthSnapshot().find((e) => e.id === 'openai:gpt:1')).toBeUndefined()
  })

  it('picks the best healthy model by task fit, excluding the failed one', () => {
    const pick = pickFailoverModel(POOL as never, {
      provider: 'anthropic',
      model: 'opus',
      keyId: '1',
    })
    expect(pick).not.toBeNull()
    // Prefer another orchestrator (opus on Key 2) over the lower-tier scout.
    expect(pick?.role).toBe('orchestrator')
    expect(pick?.keyId).toBe('2')
  })

  it('skips a suspended candidate when picking a replacement', () => {
    recordModelFailure('anthropic', 'opus', '2', {})
    recordModelFailure('anthropic', 'opus', '2', {})
    const pick = pickFailoverModel(POOL as never, {
      provider: 'anthropic',
      model: 'opus',
      keyId: '1',
    })
    expect(pick?.role).toBe('scout') // the only healthy distinct model left
  })

  it('returns null when no healthy distinct model is configured', () => {
    const solo = {
      agent_models: [{ role: 'orchestrator', provider: 'anthropic', model: 'opus', keyId: '1', primary: true }],
    }
    expect(pickFailoverModel(solo as never, { provider: 'anthropic', model: 'opus', keyId: '1' })).toBeNull()
  })

  it('resolves the failover policy (off / limited-N / exhaust + legacy + default)', () => {
    expect(resolveFailoverPolicy({ agent_failover_mode: 'off' })).toEqual({
      enabled: false,
      maxAttempts: 0,
    })
    expect(resolveFailoverPolicy({ agent_failover_mode: 'limited', agent_failover_attempts: 3 })).toEqual({
      enabled: true,
      maxAttempts: 3,
    })
    expect(resolveFailoverPolicy({ agent_failover_mode: 'exhaust' }).maxAttempts).toBeGreaterThanOrEqual(12)
    expect(resolveFailoverPolicy({ agent_failover: false }).enabled).toBe(false) // legacy boolean
    expect(resolveFailoverPolicy({}).enabled).toBe(true) // default = limited
  })
})
