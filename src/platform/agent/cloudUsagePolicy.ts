/** Local-only execution compatibility policy for the coding runtime. */

import { readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'

export const DEFAULT_CLOUD_REQUEST_BUDGET = 0
export const CLOUD_REQUEST_HARD_CAP = 0
export const RUNTIME_CLOUD_USAGE_STATE_KEY = 'agent_runtime_cloud_usage_state'

export type CloudRequestPurpose = 'agent' | 'consult' | 'final' | 'retry'

export interface CloudResponder {
  id: string
  provider: string
  model: string
  keyId: string
  preferenceRank?: number
}

export interface HybridExecutionPlan {
  workingSettings: Record<string, any>
  finalResponder: CloudResponder
  localWorker: AgentModelEntry
  cloudCandidates: CloudResponder[]
}

export interface CloudUsageState {
  used: number
  max: number
  reservedForFinal: number
}

interface SettingsLike {
  ai_provider?: unknown
  ai_model?: unknown
  agent_models?: unknown
  [key: string]: unknown
}

export function isLocalProvider(provider: unknown): boolean {
  return (
    String(provider || '')
      .trim()
      .toLowerCase() === 'local'
  )
}

export function isCloudProvider(_provider: unknown): boolean {
  return false
}

function makeLocalRoleEntry(role: AgentRoleId, source: AgentModelEntry): AgentModelEntry {
  return {
    id: `${role}:local:${source.model}:${source.keyId || '1'}`.toLowerCase(),
    role,
    provider: 'local',
    model: source.model,
    keyId: source.keyId || '1',
    primary: true,
    tags: [...source.tags],
    disabledTags: [...source.disabledTags],
  }
}

export function resolveRequiredLocalWorker(settings: SettingsLike | null | undefined): AgentModelEntry | null {
  const local = readAgentModels(settings).filter((entry) => isLocalProvider(entry.provider) && Boolean(entry.model))
  if (!local.length) return null

  const preferredRoles: AgentRoleId[] = ['scout', 'executor', 'orchestrator', 'overwatcher']
  for (const role of preferredRoles) {
    const primary = local.find((entry) => entry.role === role && entry.primary)
    if (primary) return primary
    const any = local.find((entry) => entry.role === role)
    if (any) return any
  }
  return local[0] || null
}

export function getAllowedCloudCandidates(_settings: SettingsLike): CloudResponder[] {
  return []
}

export function buildHybridExecutionPlan(_settings: SettingsLike): HybridExecutionPlan | null {
  return null
}

export function createCloudUsageState(_settings: SettingsLike, _hasCloudFinal: boolean): CloudUsageState {
  return { used: 0, max: 0, reservedForFinal: 0 }
}

export function getCloudUsageState(settings: SettingsLike | null | undefined): CloudUsageState | null {
  const value = settings?.[RUNTIME_CLOUD_USAGE_STATE_KEY]
  if (!value || typeof value !== 'object') return null
  const state = value as CloudUsageState
  if (!Number.isFinite(state.used) || !Number.isFinite(state.max)) return null
  return state
}

export function canUseCloud(_state: CloudUsageState, _purpose: CloudRequestPurpose): boolean {
  return false
}

export function consumeCloudRequest(_state: CloudUsageState, _purpose: CloudRequestPurpose): number {
  throw new Error('Cloud model execution is disabled in the local-only runtime.')
}

export function selectCloudConsultModel(
  _candidates: CloudResponder[],
  _question: string,
  _finalResponder: CloudResponder,
): CloudResponder {
  throw new Error('Cloud model execution is disabled in the local-only runtime.')
}

export function buildCloudRequestSettings(_settings: SettingsLike, _candidate: CloudResponder): Record<string, any> {
  throw new Error('Cloud model execution is disabled in the local-only runtime.')
}

export function buildLocalWorkerSettings(settings: SettingsLike, role: AgentRoleId = 'orchestrator') {
  const localWorker = resolveRequiredLocalWorker(settings)
  if (!localWorker) return { ...settings, ai_provider: 'local' }
  const localRole = makeLocalRoleEntry(role, localWorker)
  return {
    ...settings,
    ai_provider: 'local',
    ai_model: localRole.model,
  }
}
