/**
 * Resolves the conversation-level responder from configured Orchestrator cards.
 * The selected card owns the final answer; helper routing remains available only
 * when the resulting execution policy allows it.
 */

import { getKey } from '@/platform/keyStore'
import { AGENT_ROLE_IDS, readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'

export type AgentExecutionPolicy = 'hybrid' | 'local_only' | 'primary_only'

export interface ChatResponderChoice extends AgentModelEntry {
  label: string
}

interface SettingsLike {
  agent_models?: unknown
  ai_provider?: unknown
  ai_model?: unknown
  [key: string]: unknown
}

function localEntryId(role: AgentRoleId, model: string, keyId: string): string {
  return `${role}:local:${model}:${keyId}`.toLowerCase()
}

function buildLocalOnlyModelPool(allModels: AgentModelEntry[], responder: ChatResponderChoice): AgentModelEntry[] {
  const localModels = allModels.filter((entry) => entry.provider === 'local')

  return AGENT_ROLE_IDS.flatMap((role) => {
    let roleModels = localModels.filter((entry) => entry.role === role)

    if (role === 'orchestrator') {
      roleModels = [responder, ...roleModels.filter((entry) => entry.id !== responder.id)]
    }

    if (!roleModels.length) {
      return [
        {
          id: localEntryId(role, responder.model, responder.keyId || '1'),
          role,
          provider: 'local',
          model: responder.model,
          keyId: responder.keyId || '1',
          primary: true,
          tags: [...responder.tags],
          disabledTags: [...responder.disabledTags],
        },
      ]
    }

    return roleModels.map((entry, index) => ({
      ...entry,
      primary: index === 0,
    }))
  })
}

export function getChatResponderChoices(settings: SettingsLike | null | undefined): ChatResponderChoice[] {
  return readAgentModels(settings)
    .filter((entry) => entry.role === 'orchestrator' && entry.provider && entry.model)
    .map((entry) => ({
      ...entry,
      label: `${entry.provider === 'local' ? 'Local' : entry.provider} · ${entry.model}`,
    }))
}

export function getDefaultChatResponder(settings: SettingsLike | null | undefined): ChatResponderChoice | null {
  const choices = getChatResponderChoices(settings)
  return choices.find((entry) => entry.primary) || choices[0] || null
}

export function resolveChatResponder(
  settings: SettingsLike | null | undefined,
  responderId: string | null | undefined,
): ChatResponderChoice | null {
  const choices = getChatResponderChoices(settings)
  return choices.find((entry) => entry.id === responderId) || getDefaultChatResponder(settings)
}

export function buildChatExecutionSettings<T extends SettingsLike>(
  settings: T,
  responder: ChatResponderChoice | null,
  requestedPolicy?: AgentExecutionPolicy | null,
): T & {
  agent_primary_locked?: boolean
  agent_execution_policy?: AgentExecutionPolicy
} {
  if (!responder) return settings

  const policy: AgentExecutionPolicy = responder.provider === 'local' ? 'local_only' : requestedPolicy || 'hybrid'
  const localOnly = policy === 'local_only'
  const primaryOnly = policy === 'primary_only'
  const allModels = readAgentModels(settings)
  const allowedModels = localOnly
    ? buildLocalOnlyModelPool(allModels, responder)
    : primaryOnly
      ? allModels.filter((entry) => entry.id === responder.id)
      : allModels

  return {
    ...settings,
    ai_provider: responder.provider,
    ai_model: responder.model,
    ai_runtime_api_key: responder.provider === 'local' ? '' : getKey(responder.provider, responder.keyId || '1'),
    ai_api_key: responder.provider === 'local' ? '' : settings.ai_api_key,
    // Only local_only / primary_only lock the primary. Hybrid runs through the MESH (local-first
    // orchestration → full-agent cloud escalation), so it must NOT lock — role binding, routing,
    // and failover all need to run. buildHybridExecutionPlan rebinds the orchestrator to a local
    // worker when one exists.
    agent_primary_locked: localOnly || primaryOnly,
    agent_primary_assignment_id: responder.id,
    agent_execution_policy: policy,
    agent_local_only_enforced: localOnly,
    agent_models: allowedModels,
    // Enable the communication bridge for both local_only AND hybrid so the responder can pull in
    // peers / escalate to cloud as full agents under their own role tier.
    ...(localOnly || policy === 'hybrid'
      ? {
          agent_multi_enabled: true,
          agent_peer_consult_enabled: true,
          agent_peer_review: 'suggested',
        }
      : {}),
    ...(localOnly || primaryOnly
      ? {
          agent_model_routing: 'off',
          agent_failover_mode: 'off',
        }
      : {}),
  }
}
