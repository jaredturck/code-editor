import { readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'
import { normalizeModelList } from '@/platform/providers/providerConfiguration'
import type { OrbSettings } from '@/platform/settingsStorage'

export type AISettingsSection =
  | 'providers'
  | 'models'
  | 'agents'
  | 'routing'
  | 'autonomy'
  | 'limits'
  | 'skills'
  | 'semantic'

export const ai_settings_sections: Array<{ id: AISettingsSection; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'Agents' },
  { id: 'routing', label: 'Routing' },
  { id: 'autonomy', label: 'Autonomy' },
  { id: 'limits', label: 'Limits' },
  { id: 'skills', label: 'Skills' },
  { id: 'semantic', label: 'Semantic Index' },
]

export const agent_role_details: Record<
  AgentRoleId,
  { label: string; description: string; default_tier: number }
> = {
  orchestrator: {
    label: 'Orchestrator',
    description: 'Primary planner and coordinator for project-level work.',
    default_tier: 3,
  },
  executor: {
    label: 'Executor',
    description: 'Implementation-focused worker for code changes and tool execution.',
    default_tier: 2,
  },
  scout: {
    label: 'Scout',
    description: 'Read-oriented researcher for repository, semantic and web discovery.',
    default_tier: 1,
  },
  overwatcher: {
    label: 'Reviewer',
    description: 'Independent reasoning/review role used to supervise and verify work.',
    default_tier: 1,
  },
}

export const permission_tier_options = [
  { value: 0, label: '0 · Locked' },
  { value: 1, label: '1 · Read only' },
  { value: 2, label: '2 · Standard' },
  { value: 3, label: '3 · Power' },
]

export function set_provider_selected_models(
  settings: Pick<OrbSettings, 'provider_selected_models'>,
  provider_id: string,
  models: unknown,
) {
  return {
    ...(settings.provider_selected_models || {}),
    [provider_id]: normalizeModelList(models),
  }
}

export function get_primary_agent_model(settings: Pick<OrbSettings, 'agent_models'>, role: AgentRoleId) {
  const models = readAgentModels(settings)
  return models.find((entry) => entry.role === role && entry.primary) || null
}

export function set_primary_agent_model(
  settings: Pick<OrbSettings, 'agent_models'>,
  role: AgentRoleId,
  binding: { provider: string; model: string; key_id?: string } | null,
): AgentModelEntry[] {
  const models = readAgentModels(settings)
  const other_roles = models.filter((entry) => entry.role !== role)
  const existing_role = models.filter((entry) => entry.role === role)

  if (!binding?.provider || !binding.model) {
    return other_roles
  }

  const provider = binding.provider.trim()
  const model = binding.model.trim()
  const key_id = String(binding.key_id || '1').trim() || '1'
  const existing = existing_role.find(
    (entry) =>
      entry.provider.toLowerCase() === provider.toLowerCase() &&
      entry.model.toLowerCase() === model.toLowerCase() &&
      entry.keyId === key_id,
  )

  const primary: AgentModelEntry = {
    id: `${role}:${provider}:${model}:${key_id}`.toLowerCase(),
    role,
    provider,
    model,
    keyId: key_id,
    primary: true,
    tags: existing?.tags || [],
    disabledTags: existing?.disabledTags || [],
  }

  const secondary = existing_role
    .filter(
      (entry) =>
        !entry.primary &&
        !(
          entry.provider.toLowerCase() === provider.toLowerCase() &&
          entry.model.toLowerCase() === model.toLowerCase() &&
          entry.keyId === key_id
        ),
    )
    .map((entry) => ({ ...entry, primary: false }))

  return [...other_roles, primary, ...secondary]
}

export function classify_provider_failure(message: unknown) {
  return /(401|403|unauthori[sz]ed|authentication|invalid.{0,20}(key|token)|credential|forbidden)/i.test(
    String(message || ''),
  )
    ? 'invalid'
    : 'unavailable'
}

export function clamp_number(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}
