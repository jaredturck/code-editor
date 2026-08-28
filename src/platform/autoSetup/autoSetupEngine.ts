/** Builds the local agent configuration from discovered model inventory. */

import { type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'
import {
  compareForRole,
  evaluateModel,
  type AutoSetupCandidate,
  type ModelEvaluation,
} from '@/platform/autoSetup/modelSelectionRules'

export interface AutomaticSetupPatch {
  provider_selected_models: Record<string, string[]>
  agent_models: AgentModelEntry[]
  agent_multi_enabled: boolean
  agent_peer_consult_enabled: boolean
  agent_peer_review: string
  agent_model_routing: string
  ai_provider: string
  ai_model: string
  agent_execution_policy: string
}

export interface AutomaticSetupPlan {
  patch: AutomaticSetupPatch
  selected: Partial<Record<AgentRoleId, ModelEvaluation>>
  summary: string[]
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((model) => String(model || '').trim()).filter(Boolean)))
}

function localModels(settings: Record<string, unknown>) {
  const discovered = settings.discovered_models && typeof settings.discovered_models === 'object'
    ? settings.discovered_models as Record<string, unknown>
    : {}
  const selected = settings.provider_selected_models && typeof settings.provider_selected_models === 'object'
    ? settings.provider_selected_models as Record<string, unknown>
    : {}
  return normalizeModelList([
    ...normalizeModelList(discovered.local),
    ...normalizeModelList(selected.local),
    String(settings.ai_model || ''),
  ])
}

function collectCandidates(settings: Record<string, unknown>): ModelEvaluation[] {
  const candidates: AutoSetupCandidate[] = localModels(settings).map((model) => ({
    provider: 'local',
    model,
    keyId: '1',
  }))
  return candidates.map(evaluateModel).filter((candidate) => !candidate.excluded)
}

function makeEntry(role: AgentRoleId, candidate: ModelEvaluation, primary = true): AgentModelEntry {
  return {
    id: `${role}:local:${candidate.model}:1`.toLowerCase(),
    role,
    provider: 'local',
    model: candidate.model,
    keyId: '1',
    primary,
    tags: [],
    disabledTags: [],
  }
}

function pickBest(role: AgentRoleId, candidates: ModelEvaluation[]): ModelEvaluation | null {
  return [...candidates].sort((left, right) => compareForRole(role, left, right))[0] || null
}

export function buildAutomaticSetupPlan(settings: Record<string, unknown>): AutomaticSetupPlan {
  const candidates = collectCandidates(settings)
  if (!candidates.length) {
    throw new Error('No suitable local model is available for Auto Setup.')
  }

  const orchestrator = pickBest('orchestrator', candidates) || candidates[0]
  const executor = pickBest('executor', candidates) || orchestrator
  const scout = pickBest('scout', candidates) || orchestrator
  const overwatcher = pickBest('overwatcher', candidates) || orchestrator
  const agentModels = [
    makeEntry('orchestrator', orchestrator, true),
    makeEntry('executor', executor, true),
    makeEntry('scout', scout, true),
    makeEntry('overwatcher', overwatcher, true),
  ]
  const selectedModels = normalizeModelList(candidates.map((candidate) => candidate.model))
  const distinctModelBindings = new Set(agentModels.map((entry) => entry.model.toLowerCase())).size

  return {
    patch: {
      provider_selected_models: { local: selectedModels },
      agent_models: agentModels,
      agent_multi_enabled: true,
      agent_peer_consult_enabled: true,
      agent_peer_review: 'suggested',
      agent_model_routing: distinctModelBindings > 1 ? 'on' : 'off',
      ai_provider: 'local',
      ai_model: orchestrator.model,
      agent_execution_policy: 'local_only',
    },
    selected: {
      orchestrator,
      executor,
      scout,
      overwatcher,
    },
    summary: [
      `Local worker: ${orchestrator.model}`,
      'Cloud use disabled: the coding runtime is local-only',
    ],
  }
}
