import { readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'
import type { OrbSettings } from '@/platform/settingsStorage'

export type AISettingsSection =
  | 'providers'
  | 'agents'
  | 'autonomy'
  | 'skills'
  | 'models'
  | 'routing'
  | 'limits'
  | 'semantic'

export const ai_settings_sections: Array<{ id: AISettingsSection; label: string }> = [
  { id: 'providers', label: 'Local model' },
  { id: 'agents', label: 'Agents' },
  { id: 'autonomy', label: 'Autonomy' },
  { id: 'skills', label: 'Skills' },
]

export const agent_role_details: Record<AgentRoleId, { label: string; description: string; default_tier: number }> = {
  orchestrator: {
    label: 'Orchestrator',
    description: 'Plans the work and coordinates the other agents.',
    default_tier: 3,
  },
  executor: {
    label: 'Executor',
    description: 'Writes and edits code for assigned tasks.',
    default_tier: 2,
  },
  scout: {
    label: 'Scout',
    description: 'Explores the codebase and researches information without changing files.',
    default_tier: 1,
  },
  overwatcher: {
    label: 'Evaluator',
    description: 'Reviews completed work and checks it against the task requirements.',
    default_tier: 1,
  },
}

export const permission_tier_options = [
  { value: 0, label: '0 · Locked' },
  { value: 1, label: '1 · Read only' },
  { value: 2, label: '2 · Standard' },
  { value: 3, label: '3 · Power' },
]

export function get_primary_agent_model(settings: Pick<OrbSettings, 'agent_models'>, role: AgentRoleId) {
  return readAgentModels(settings).find((entry) => entry.role === role && entry.primary) || null
}

export function set_primary_agent_model(
  settings: Pick<OrbSettings, 'agent_models'>,
  role: AgentRoleId,
  binding: { model: string } | null,
): AgentModelEntry[] {
  const models = readAgentModels(settings)
  const otherRoles = models.filter((entry) => entry.role !== role)
  if (!binding?.model.trim()) return otherRoles
  const model = binding.model.trim()
  const existing = models.find((entry) => entry.role === role && entry.model === model)
  const primary: AgentModelEntry = {
    id: `${role}:local:${model}:1`.toLowerCase(),
    role,
    provider: 'local',
    model,
    keyId: '1',
    primary: true,
    tags: existing?.tags || [],
    disabledTags: existing?.disabledTags || [],
  }
  return [...otherRoles, primary]
}

export function clamp_number(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}
