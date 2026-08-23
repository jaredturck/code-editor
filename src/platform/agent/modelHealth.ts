/**
 * Persistent model-health registry used by main-agent and delegated-agent failover.
 *
 * Health is driven primarily by real requests. A successful request clears the entry; user
 * cancellation is ignored; repeated consecutive failures create progressively longer cooldowns.
 * Background discovery only clears a suspension when it has positive evidence that a model is
 * available — it never burns completion tokens or turns an empty model list into a false failure.
 */
import { buildAgentRoster } from '@/platform/agent/modelTags'
import { readStorageJson, writeStorageJson, canUseLocalStorage } from '@/platform/localStorageStore'

export type ModelHealthStatus = 'healthy' | 'degraded' | 'temporarily_unavailable' | 'suspended'

export interface ModelHealthEntry {
  consecutiveFailures: number
  totalFailures: number
  suspended: boolean
  persistent: boolean
  lastError: string
  cooldownUntil: number
  updatedAt: number
  lastFailureAt: number
  lastSuccessAt: number
}

const STORAGE_KEY = 'iris_model_health_v1'
const registry = new Map<string, ModelHealthEntry>()
let hydrated = false

const SUSPEND_AFTER_CONSECUTIVE = 2
const PERSISTENT_AFTER_CONSECUTIVE = 6
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000
const ERROR_COOLDOWN_MS = 2 * 60 * 1000
const PERSISTENT_COOLDOWN_MS = 6 * 60 * 60 * 1000

export function modelHealthKey(provider: unknown, model: unknown, keyId: unknown = '1'): string {
  return `${String(provider || '').toLowerCase()}:${String(model || '').toLowerCase()}:${String(keyId || '1')}`
}

export function parseModelHealthKey(key: string): { provider: string; model: string; keyId: string } | null {
  const parts = String(key || '').split(':')
  if (parts.length < 3) return null
  return {
    provider: parts.shift() || '',
    keyId: parts.pop() || '1',
    model: parts.join(':'),
  }
}

function ensureHydrated(): void {
  if (hydrated) return
  hydrated = true
  try {
    const stored = readStorageJson<Record<string, ModelHealthEntry>>(STORAGE_KEY, {})
    for (const [id, raw] of Object.entries(stored || {})) {
      if (!raw || typeof raw !== 'object') continue
      registry.set(id, {
        consecutiveFailures: Math.max(0, Number(raw.consecutiveFailures) || 0),
        totalFailures: Math.max(0, Number(raw.totalFailures) || 0),
        suspended: raw.suspended === true,
        persistent: raw.persistent === true,
        lastError: String(raw.lastError || ''),
        cooldownUntil: Math.max(0, Number(raw.cooldownUntil) || 0),
        updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
        lastFailureAt: Math.max(0, Number(raw.lastFailureAt) || 0),
        lastSuccessAt: Math.max(0, Number(raw.lastSuccessAt) || 0),
      })
    }
  } catch {
    /* start healthy if persistence is unavailable */
  }
}

function persist(): void {
  if (!canUseLocalStorage()) return
  try {
    writeStorageJson(STORAGE_KEY, Object.fromEntries(registry.entries()))
  } catch {
    /* health telemetry must never break a model call */
  }
}

function isCancellation(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error) {
    if (String((error as { name?: unknown }).name) === 'AbortError') return true
  }
  const text = String(error instanceof Error ? error.message : error || '').toLowerCase()
  return /\b(abort(?:ed)?|cancel(?:led|ed)?|user stopped|stop requested)\b/.test(text)
}

export function recordModelFailure(
  provider: unknown,
  model: unknown,
  keyId: unknown,
  opts: { error?: unknown; rateLimited?: boolean } = {},
): void {
  if (isCancellation(opts.error)) return
  ensureHydrated()
  const key = modelHealthKey(provider, model, keyId)
  const now = Date.now()
  const entry = registry.get(key) || {
    consecutiveFailures: 0,
    totalFailures: 0,
    suspended: false,
    persistent: false,
    lastError: '',
    cooldownUntil: 0,
    updatedAt: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
  }
  entry.consecutiveFailures += 1
  entry.totalFailures += 1
  entry.lastError = String(opts.error instanceof Error ? opts.error.message : opts.error || '').slice(0, 240)
  entry.updatedAt = now
  entry.lastFailureAt = now

  if (entry.consecutiveFailures >= SUSPEND_AFTER_CONSECUTIVE) {
    entry.suspended = true
    entry.cooldownUntil = now + (opts.rateLimited ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS)
  }
  if (entry.consecutiveFailures >= PERSISTENT_AFTER_CONSECUTIVE) {
    entry.persistent = true
    entry.suspended = true
    entry.cooldownUntil = Math.max(entry.cooldownUntil, now + PERSISTENT_COOLDOWN_MS)
  }
  registry.set(key, entry)
  persist()
}

export function recordModelSuccess(provider: unknown, model: unknown, keyId: unknown = '1'): void {
  ensureHydrated()
  const key = modelHealthKey(provider, model, keyId)
  if (registry.delete(key)) persist()
}

export function isModelHealthy(provider: unknown, model: unknown, keyId: unknown = '1'): boolean {
  ensureHydrated()
  const entry = registry.get(modelHealthKey(provider, model, keyId))
  if (!entry || !entry.suspended) return true
  if (Date.now() >= entry.cooldownUntil) {
    // Cooldown expiry makes the model eligible for one real retry. Its failure streak remains until
    // a successful request clears it, so another failure backs off quickly rather than flapping.
    entry.suspended = false
    entry.persistent = false
    entry.updatedAt = Date.now()
    persist()
    return true
  }
  return false
}

export function getModelHealthStatus(provider: unknown, model: unknown, keyId: unknown = '1'): ModelHealthStatus {
  ensureHydrated()
  const entry = registry.get(modelHealthKey(provider, model, keyId))
  if (!entry) return 'healthy'
  if (entry.suspended && Date.now() < entry.cooldownUntil) {
    return entry.persistent ? 'suspended' : 'temporarily_unavailable'
  }
  return entry.consecutiveFailures > 0 ? 'degraded' : 'healthy'
}

export function modelHealthSnapshot(): Array<{ id: string; status: ModelHealthStatus } & ModelHealthEntry> {
  ensureHydrated()
  return Array.from(registry.entries()).map(([id, entry]) => ({
    id,
    status:
      entry.suspended && Date.now() < entry.cooldownUntil
        ? entry.persistent
          ? 'suspended'
          : 'temporarily_unavailable'
        : entry.consecutiveFailures > 0
          ? 'degraded'
          : 'healthy',
    ...entry,
  }))
}

export function listSuspendedModelKeys(): string[] {
  ensureHydrated()
  const now = Date.now()
  return Array.from(registry.entries())
    .filter(([, entry]) => entry.suspended && now < entry.cooldownUntil)
    .map(([id]) => id)
}

export function clearModelHealth(provider: unknown, model: unknown, keyId: unknown = '1'): void {
  ensureHydrated()
  if (registry.delete(modelHealthKey(provider, model, keyId))) persist()
}

export function resetModelHealth(): void {
  registry.clear()
  hydrated = true
  persist()
}

const FAILOVER_HARD_CAP = 12

export interface FailoverPolicy {
  enabled: boolean
  maxAttempts: number
}

export function resolveFailoverPolicy(settings: Record<string, unknown> | null | undefined): FailoverPolicy {
  const legacy = settings?.agent_failover === false ? 'off' : settings?.agent_failover === true ? 'limited' : ''
  const mode = String(settings?.agent_failover_mode ?? legacy ?? '').toLowerCase() || 'limited'
  if (mode === 'off') return { enabled: false, maxAttempts: 0 }
  if (mode === 'exhaust') return { enabled: true, maxAttempts: FAILOVER_HARD_CAP }
  const raw = Number(settings?.agent_failover_attempts)
  const attempts = Number.isFinite(raw) && raw > 0 ? Math.min(FAILOVER_HARD_CAP, Math.round(raw)) : 4
  return { enabled: true, maxAttempts: attempts }
}

export interface FailoverPick {
  provider: string
  model: string
  keyId: string
  role: string
  tier: number
}

export function pickFailoverModel(
  settings: Record<string, unknown>,
  failed: { provider: unknown; model: unknown; keyId: unknown },
  opts: { preferRole?: string } = {},
): FailoverPick | null {
  const failedKey = modelHealthKey(failed.provider, failed.model, failed.keyId)
  const preferRole = opts.preferRole || 'orchestrator'
  const healthy = buildAgentRoster(settings)
    .filter((member) => member.provider && member.model)
    .filter((member) => modelHealthKey(member.provider, member.model, member.keyId) !== failedKey)
    .filter((member) => isModelHealthy(member.provider, member.model, member.keyId))
  if (!healthy.length) return null
  healthy.sort(
    (left, right) =>
      Number(right.role === preferRole) - Number(left.role === preferRole) ||
      right.tier - left.tier ||
      right.tags.length - left.tags.length ||
      Number(right.primary) - Number(left.primary),
  )
  const pick = healthy[0]
  return {
    provider: pick.provider,
    model: pick.model,
    keyId: pick.keyId || '1',
    role: pick.role,
    tier: pick.tier,
  }
}
