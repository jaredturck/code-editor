/**
 * Adaptive, token-free model-health monitor.
 *
 * Real inference requests are the primary health signal. The monitor only probes models already
 * marked unavailable and only clears them on positive model-list evidence. Healthy providers are
 * left alone for long intervals, while degraded providers retry with exponential backoff.
 */
import { buildAgentRoster } from '@/platform/agent/modelTags'
import { discoverModelsForProvider } from '@/platform/aiService'
import { clearModelHealth, listSuspendedModelKeys, modelHealthKey } from '@/platform/agent/modelHealth'
import { subscribeSettingsChanged } from '@/platform/settingsStorage'

type Settings = Record<string, unknown>

const DEFAULT_HEALTHY_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_DEGRADED_INTERVAL_MS = 5 * 60 * 1000
const MIN_INTERVAL_MS = 60_000
const MAX_BACKOFF_MS = 4 * 60 * 60 * 1000

let timer: ReturnType<typeof setTimeout> | null = null
let probing = false
let subscribed = false
let currentSettings: Settings = {}
let emptyProbeStreak = 0
let lastProbeAt = 0
let nextProbeAt = 0

function lower(value: unknown): string {
  return String(value || '').toLowerCase()
}

function boundedInterval(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(MIN_INTERVAL_MS, Math.round(parsed)) : fallback
}

function isHealthCheckEnabled(settings: Settings): boolean {
  return settings?.agent_health_check_enabled !== false
}

function suspendedRoster(settings: Settings) {
  const suspended = new Set(listSuspendedModelKeys())
  return buildAgentRoster(settings).filter(
    (member) =>
      member.provider && member.model && suspended.has(modelHealthKey(member.provider, member.model, member.keyId)),
  )
}

export interface ModelHealthProbeResult {
  probedGroups: number
  recoveredModels: number
  suspendedModels: number
}

export async function probeModelHealthOnce(settings: Settings): Promise<ModelHealthProbeResult> {
  if (probing) return { probedGroups: 0, recoveredModels: 0, suspendedModels: 0 }
  probing = true
  lastProbeAt = Date.now()
  try {
    const roster = suspendedRoster(settings)
    if (!roster.length) {
      emptyProbeStreak = 0
      return { probedGroups: 0, recoveredModels: 0, suspendedModels: 0 }
    }

    const groups = new Map<string, { provider: string; keyId: string; models: Set<string> }>()
    for (const member of roster) {
      const keyId = String(member.keyId || '1')
      const groupKey = `${lower(member.provider)}:${keyId}`
      const group = groups.get(groupKey) || {
        provider: member.provider,
        keyId,
        models: new Set<string>(),
      }
      group.models.add(member.model)
      groups.set(groupKey, group)
    }

    let recoveredModels = 0
    let positiveEvidence = false
    for (const group of groups.values()) {
      // discoverModelsForProvider is deliberately fail-soft and returns [] on network/auth errors.
      // Therefore an empty result is inconclusive and must never create more failure records.
      const available = await discoverModelsForProvider(group.provider, settings as never, group.keyId)
      const listed = new Set(available.map(lower))
      if (listed.size) positiveEvidence = true
      for (const model of group.models) {
        if (listed.has(lower(model))) {
          clearModelHealth(group.provider, model, group.keyId)
          recoveredModels += 1
        }
      }
    }
    emptyProbeStreak = positiveEvidence ? 0 : Math.min(8, emptyProbeStreak + 1)
    return {
      probedGroups: groups.size,
      recoveredModels,
      suspendedModels: roster.length,
    }
  } finally {
    probing = false
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer)
  const hasSuspended = suspendedRoster(currentSettings).length > 0
  const healthyInterval = boundedInterval(
    currentSettings.agent_health_check_healthy_interval_ms,
    DEFAULT_HEALTHY_INTERVAL_MS,
  )
  const degradedBase = boundedInterval(
    currentSettings.agent_health_check_degraded_interval_ms,
    DEFAULT_DEGRADED_INTERVAL_MS,
  )
  const delay = hasSuspended ? Math.min(MAX_BACKOFF_MS, degradedBase * 2 ** emptyProbeStreak) : healthyInterval
  nextProbeAt = Date.now() + delay
  timer = setTimeout(async () => {
    if (isHealthCheckEnabled(currentSettings)) await probeModelHealthOnce(currentSettings)
    scheduleNext()
  }, delay)
  ;(timer as { unref?: () => void })?.unref?.()
}

export function startModelHealthMonitor(initialSettings: Settings = {}): void {
  currentSettings = initialSettings || {}
  if (!subscribed) {
    subscribed = true
    try {
      subscribeSettingsChanged((next) => {
        currentSettings = (next as Settings) || {}
        scheduleNext()
      })
    } catch {
      /* use the supplied settings snapshot */
    }
  }
  if (!timer) scheduleNext()
}

export async function retryModelHealthNow(settings: Settings = currentSettings): Promise<ModelHealthProbeResult> {
  currentSettings = settings || currentSettings
  emptyProbeStreak = 0
  const result = await probeModelHealthOnce(currentSettings)
  scheduleNext()
  return result
}

export function getModelHealthMonitorState(): {
  probing: boolean
  lastProbeAt: number
  nextProbeAt: number
  suspendedModels: number
} {
  return {
    probing,
    lastProbeAt,
    nextProbeAt,
    suspendedModels: suspendedRoster(currentSettings).length,
  }
}

export function stopModelHealthMonitor(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  nextProbeAt = 0
}
