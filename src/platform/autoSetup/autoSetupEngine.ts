/** Builds IRIS's agent configuration from validated live model inventories. */

import { type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity';
import {
  getDiscoveredModelsForKey,
  getValidProviderKeyIds,
  normalizeModelList,
  type ProviderConfigurationSettings,
} from '@/platform/providers/providerConfiguration';
import { AI_PROVIDER_DEFINITIONS } from '@/platform/providers/providerRegistry';
import {
  compareForRole,
  evaluateModel,
  type AutoSetupCandidate,
  type ModelEvaluation,
} from '@/platform/autoSetup/modelSelectionRules';

export interface AutomaticSetupPatch {
  provider_selected_models: Record<string, string[]>;
  agent_models: AgentModelEntry[];
  agent_multi_enabled: boolean;
  agent_peer_consult_enabled: boolean;
  agent_peer_review: string;
  agent_model_routing: string;
  ai_provider: string;
  ai_model: string;
  agent_execution_policy: string;
}

export interface AutomaticSetupPlan {
  patch: AutomaticSetupPatch;
  selected: Partial<Record<AgentRoleId, ModelEvaluation>>;
  summary: string[];
}

function collectCandidates(settings: ProviderConfigurationSettings): ModelEvaluation[] {
  const candidates: AutoSetupCandidate[] = [];

  for (const provider of AI_PROVIDER_DEFINITIONS) {
    const validKeyIds = getValidProviderKeyIds(settings, provider.id);
    for (const keyId of validKeyIds) {
      const models = getDiscoveredModelsForKey(settings, provider.id, keyId);
      for (const model of models) candidates.push({ provider: provider.id, model, keyId });
    }
  }

  return candidates.map(evaluateModel).filter((candidate) => !candidate.excluded);
}

function makeEntry(role: AgentRoleId, candidate: ModelEvaluation, primary = true): AgentModelEntry {
  return {
    id: `${role}:${candidate.provider}:${candidate.model}:${candidate.keyId}`.toLowerCase(),
    role,
    provider: candidate.provider,
    model: candidate.model,
    keyId: candidate.keyId,
    primary,
    tags: [],
    disabledTags: [],
  };
}

function pickBest(role: AgentRoleId, candidates: ModelEvaluation[]): ModelEvaluation | null {
  return [...candidates].sort((left, right) => compareForRole(role, left, right))[0] || null;
}

function pickCloudResponders(cloud: ModelEvaluation[]): ModelEvaluation[] {
  const bestByProvider = new Map<string, ModelEvaluation>();
  for (const candidate of cloud) {
    const current = bestByProvider.get(candidate.provider);
    if (!current || compareForRole('orchestrator', candidate, current) < 0) {
      bestByProvider.set(candidate.provider, candidate);
    }
  }
  return [...bestByProvider.values()]
    .sort((left, right) => compareForRole('orchestrator', left, right))
    .slice(0, 4);
}

function buildSelectedProviderModels(
  settings: ProviderConfigurationSettings,
  candidates: ModelEvaluation[],
): Record<string, string[]> {
  const next = { ...(settings.provider_selected_models || {}) };

  for (const provider of AI_PROVIDER_DEFINITIONS) {
    const available = candidates.filter((candidate) => candidate.provider === provider.id);
    if (!available.length) continue;
    const bestGeneral = pickBest('orchestrator', available);
    const bestExecutor = pickBest('executor', available);
    const bestScout = pickBest('scout', available);
    const availableIds = new Set(available.map((candidate) => candidate.model));
    const existing = normalizeModelList(next[provider.id] || []).filter((model) =>
      availableIds.has(model),
    );
    next[provider.id] = normalizeModelList([
      ...existing,
      bestGeneral?.model,
      bestExecutor?.model,
      bestScout?.model,
    ]);
  }

  return next;
}

export function buildAutomaticSetupPlan(
  settings: ProviderConfigurationSettings,
): AutomaticSetupPlan {
  const candidates = collectCandidates(settings);
  const local = candidates.filter((candidate) => candidate.local);
  const cloud = candidates.filter((candidate) => !candidate.local);
  if (!local.length && !cloud.length) {
    throw new Error('No suitable local or validated cloud model is available for Auto Setup.');
  }

  const cloudResponders = pickCloudResponders(cloud);
  const localOrchestrator = pickBest('orchestrator', local);
  const localExecutor = pickBest('executor', local);
  const localScout = pickBest('scout', local);
  const localOverwatcher = pickBest('overwatcher', local);
  const cloudOrchestrator = pickBest('orchestrator', cloud);
  const cloudExecutor = pickBest('executor', cloud) || cloudOrchestrator;
  const cloudScout = pickBest('scout', cloud) || cloudOrchestrator;
  const cloudOverwatcher = pickBest('overwatcher', cloud) || cloudOrchestrator;
  const primary = cloudResponders[0] || localOrchestrator || cloudOrchestrator!;

  const agentModels: AgentModelEntry[] = [];
  cloudResponders.forEach((candidate, index) => {
    agentModels.push(makeEntry('orchestrator', candidate, index === 0));
  });
  if (localOrchestrator) {
    agentModels.push(makeEntry('orchestrator', localOrchestrator, cloudResponders.length === 0));
  } else if (!cloudResponders.length && cloudOrchestrator) {
    agentModels.push(makeEntry('orchestrator', cloudOrchestrator, true));
  }
  if (localExecutor || cloudExecutor)
    agentModels.push(makeEntry('executor', localExecutor || cloudExecutor!));
  if (localScout || cloudScout) agentModels.push(makeEntry('scout', localScout || cloudScout!));
  if (localOverwatcher || cloudOverwatcher) {
    agentModels.push(makeEntry('overwatcher', localOverwatcher || cloudOverwatcher!));
  }

  const selected: Partial<Record<AgentRoleId, ModelEvaluation>> = {
    orchestrator: primary,
    executor: localExecutor || cloudExecutor || primary,
    scout: localScout || cloudScout || primary,
    overwatcher: localOverwatcher || cloudOverwatcher || primary,
  };

  return {
    patch: {
      provider_selected_models: buildSelectedProviderModels(settings, candidates),
      agent_models: agentModels,
      agent_multi_enabled: true,
      agent_peer_consult_enabled: true,
      agent_peer_review: 'off',
      agent_model_routing: 'off',
      ai_provider: primary.provider,
      ai_model: primary.model,
      agent_execution_policy: primary.local ? 'local_only' : 'hybrid',
    },
    selected,
    summary: [
      localOrchestrator
        ? `Local worker: ${localOrchestrator.model}`
        : 'Local worker: none (cloud-only profile)',
      cloudResponders.length
        ? `Cloud responders: ${cloudResponders.map((candidate) => candidate.model).join(', ')}`
        : 'Cloud use disabled: no validated cloud models were found',
    ],
  };
}
