/**
 * Cloud-aware execution policy for Chat runs.
 *
 * Hybrid sessions keep the UI branch's unified model mesh: when a cloud responder is selected and
 * a local model is available, the local model coordinates the task while every configured model
 * remains reachable through normal delegation and consultation. Cloud calls are still explicitly
 * classified and charged to one per-turn safety budget, and the selected responder owns the final
 * synthesis whenever it is available.
 */

import { getKey } from '@/platform/keyStore';
import { readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity';
import { evaluateModel, type ModelEvaluation } from '@/platform/autoSetup/modelSelectionRules';
import {
  getValidProviderKeyIds,
  normalizeModelList,
  type ProviderConfigurationSettings,
} from '@/platform/providers/providerConfiguration';

export const DEFAULT_CLOUD_REQUEST_BUDGET = 50;
export const CLOUD_REQUEST_HARD_CAP = 100;
export const RUNTIME_CLOUD_USAGE_STATE_KEY = 'agent_runtime_cloud_usage_state';

export type CloudRequestPurpose = 'agent' | 'consult' | 'final' | 'retry';

export interface CloudResponder {
  id: string;
  provider: string;
  model: string;
  keyId: string;
  preferenceRank?: number;
}

export interface HybridExecutionPlan {
  workingSettings: Record<string, any>;
  finalResponder: CloudResponder;
  localWorker: AgentModelEntry;
  cloudCandidates: CloudResponder[];
}

export interface CloudUsageState {
  used: number;
  max: number;
  reservedForFinal: number;
}

interface SettingsLike {
  ai_provider?: unknown;
  ai_model?: unknown;
  ai_api_key?: unknown;
  ai_runtime_api_key?: unknown;
  agent_execution_policy?: unknown;
  agent_primary_assignment_id?: unknown;
  agent_cloud_request_budget?: unknown;
  agent_multi_enabled?: unknown;
  agent_peer_consult_enabled?: unknown;
  agent_models?: unknown;
  provider_selected_models?: unknown;
  provider_key_validation?: unknown;
  [key: string]: unknown;
}

export function isLocalProvider(provider: unknown): boolean {
  return (
    String(provider || '')
      .trim()
      .toLowerCase() === 'local'
  );
}

export function isCloudProvider(provider: unknown): boolean {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase();
  return Boolean(normalized) && normalized !== 'local';
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
  };
}

export function resolveRequiredLocalWorker(
  settings: SettingsLike | null | undefined,
): AgentModelEntry | null {
  const local = readAgentModels(settings).filter(
    (entry) => isLocalProvider(entry.provider) && Boolean(entry.model),
  );
  if (!local.length) return null;

  const preferredRoles: AgentRoleId[] = ['scout', 'executor', 'orchestrator', 'overwatcher'];
  for (const role of preferredRoles) {
    const primary = local.find((entry) => entry.role === role && entry.primary);
    if (primary) return primary;
    const any = local.find((entry) => entry.role === role);
    if (any) return any;
  }
  return local[0] || null;
}

function resolveFinalResponder(settings: SettingsLike): CloudResponder | null {
  const allModels = readAgentModels(settings);
  const assignmentId = String(settings.agent_primary_assignment_id || '');
  const assigned = allModels.find((entry) => entry.id === assignmentId);
  const provider = String(assigned?.provider || settings.ai_provider || '').trim();
  const model = String(assigned?.model || settings.ai_model || '').trim();
  const keyId = String(assigned?.keyId || '1');
  if (!provider || !model || isLocalProvider(provider)) return null;
  return {
    id: assigned?.id || `orchestrator:${provider}:${model}:${keyId}`.toLowerCase(),
    provider,
    model,
    keyId,
  };
}

export function getAllowedCloudCandidates(settings: SettingsLike): CloudResponder[] {
  const seen = new Set<string>();
  const result: CloudResponder[] = [];
  const addCandidate = (candidate: CloudResponder): void => {
    const identity = `${candidate.provider}:${candidate.model}:${candidate.keyId}`.toLowerCase();
    if (
      !candidate.provider ||
      !candidate.model ||
      isLocalProvider(candidate.provider) ||
      seen.has(identity)
    ) {
      return;
    }
    seen.add(identity);
    result.push(candidate);
  };

  const selectedModels =
    settings.provider_selected_models && typeof settings.provider_selected_models === 'object'
      ? (settings.provider_selected_models as Record<string, unknown>)
      : {};
  for (const [provider, models] of Object.entries(selectedModels)) {
    if (isLocalProvider(provider)) continue;
    const keyId =
      getValidProviderKeyIds(settings as ProviderConfigurationSettings, provider)[0] || '1';
    normalizeModelList(models).forEach((model, preferenceRank) => {
      addCandidate({
        id: `cloud:${provider}:${model}:${keyId}`.toLowerCase(),
        provider,
        model,
        keyId,
        preferenceRank,
      });
    });
  }

  for (const entry of readAgentModels(settings)) {
    addCandidate({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      keyId: entry.keyId || '1',
    });
  }

  return result;
}

function ensureLocalOrchestratorPrimary(
  allModels: AgentModelEntry[],
  localOrchestrator: AgentModelEntry,
): AgentModelEntry[] {
  const exists = allModels.some((entry) => entry.id === localOrchestrator.id);
  const base = exists ? allModels : [localOrchestrator, ...allModels];
  return base.map((entry) =>
    entry.role === 'orchestrator'
      ? { ...entry, primary: entry.id === localOrchestrator.id }
      : entry,
  );
}

export function buildHybridExecutionPlan(settings: SettingsLike): HybridExecutionPlan | null {
  if (String(settings.agent_execution_policy || '') !== 'hybrid') return null;
  const finalResponder = resolveFinalResponder(settings);
  if (!finalResponder) return null;
  const localWorker = resolveRequiredLocalWorker(settings);
  // Cloud-only devices are supported. Returning null leaves the selected cloud responder in charge.
  if (!localWorker) return null;

  const cloudCandidates = getAllowedCloudCandidates(settings);
  if (!cloudCandidates.some((candidate) => candidate.id === finalResponder.id)) {
    cloudCandidates.unshift(finalResponder);
  }

  const localOrchestrator = makeLocalRoleEntry('orchestrator', localWorker);
  const roster = ensureLocalOrchestratorPrimary(readAgentModels(settings), localOrchestrator);
  const multiEnabled = settings.agent_multi_enabled === true;
  const workingSettings = {
    ...settings,
    ai_provider: 'local',
    ai_model: localWorker.model,
    ai_api_key: '',
    ai_runtime_api_key: '',
    agent_models: roster,
    agent_primary_assignment_id: localOrchestrator.id,
    agent_multi_enabled: multiEnabled,
    agent_peer_consult_enabled:
      multiEnabled && settings.agent_peer_consult_enabled !== false,
  };

  return { workingSettings, finalResponder, localWorker, cloudCandidates };
}

export function createCloudUsageState(
  settings: SettingsLike,
  hasCloudFinal: boolean,
): CloudUsageState {
  const configured = Number(settings.agent_cloud_request_budget);
  const max = Number.isFinite(configured)
    ? Math.max(hasCloudFinal ? 1 : 0, Math.min(CLOUD_REQUEST_HARD_CAP, Math.round(configured)))
    : DEFAULT_CLOUD_REQUEST_BUDGET;
  return {
    used: 0,
    max,
    reservedForFinal: hasCloudFinal ? 1 : 0,
  };
}

export function getCloudUsageState(
  settings: SettingsLike | null | undefined,
): CloudUsageState | null {
  const value = settings?.[RUNTIME_CLOUD_USAGE_STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const state = value as CloudUsageState;
  if (!Number.isFinite(state.used) || !Number.isFinite(state.max)) return null;
  return state;
}

export function canUseCloud(state: CloudUsageState, purpose: CloudRequestPurpose): boolean {
  if (purpose === 'final') return state.used < state.max;
  return state.used < Math.max(0, state.max - state.reservedForFinal);
}

export function consumeCloudRequest(state: CloudUsageState, purpose: CloudRequestPurpose): number {
  if (!canUseCloud(state, purpose)) {
    throw new Error(
      purpose === 'final'
        ? 'The cloud request safety budget is exhausted.'
        : 'The cloud request safety budget is exhausted. Continue locally or start a new turn.',
    );
  }
  state.used += 1;
  return state.used;
}

function inferredRole(text: string): AgentRoleId {
  const value = text.toLowerCase();
  if (/(code|debug|patch|implement|typescript|python|test|build|compile)/.test(value)) {
    return 'executor';
  }
  if (/(review|verify|risk|architecture|design|contradict|reason|decision)/.test(value)) {
    return 'overwatcher';
  }
  if (/(search|research|summari[sz]e|retrieve|find|context)/.test(value)) return 'scout';
  return 'orchestrator';
}

function scoreCandidate(candidate: CloudResponder, role: AgentRoleId): number {
  const evaluation: ModelEvaluation = evaluateModel({
    provider: candidate.provider,
    model: candidate.model,
    keyId: candidate.keyId,
  });
  const preferenceBonus = Number.isFinite(candidate.preferenceRank)
    ? Math.max(0, 8 - Number(candidate.preferenceRank) * 2)
    : 0;
  return (
    evaluation.roleScores[role] +
    evaluation.costEfficiency * 0.4 +
    evaluation.quality * 0.2 +
    evaluation.tools * 0.15 +
    evaluation.reasoning * 0.15 +
    evaluation.speed * 0.1 +
    preferenceBonus
  );
}

export function selectCloudConsultModel(
  candidates: CloudResponder[],
  question: string,
  finalResponder: CloudResponder,
): CloudResponder {
  const pool = candidates.length ? candidates : [finalResponder];
  const role = inferredRole(question);
  return [...pool].sort((left, right) => {
    const score = scoreCandidate(right, role) - scoreCandidate(left, role);
    if (score !== 0) return score;
    if (left.id === finalResponder.id) return -1;
    if (right.id === finalResponder.id) return 1;
    return left.model.localeCompare(right.model);
  })[0];
}

export function buildCloudRequestSettings(
  settings: SettingsLike,
  candidate: CloudResponder,
): Record<string, any> {
  return {
    ...settings,
    ai_provider: candidate.provider,
    ai_model: candidate.model,
    ai_runtime_api_key: getKey(candidate.provider, candidate.keyId || '1'),
    agent_local_only_enforced: false,
    agent_execution_policy: 'hybrid',
  };
}
