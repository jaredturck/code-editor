/** Enforces the chat-scoped guarantee that local-only runs never dispatch to cloud providers. */

import { readAgentModels } from '@/platform/agent/agentIdentity';

interface SettingsLike {
  ai_provider?: unknown;
  ai_model?: unknown;
  ai_api_key?: unknown;
  ai_runtime_api_key?: unknown;
  agent_local_only_enforced?: unknown;
  agent_primary_assignment_id?: unknown;
  agent_models?: unknown;
  [key: string]: unknown;
}

export function enforceLocalOnlyProvider<T extends SettingsLike>(settings: T): T {
  if (settings?.agent_local_only_enforced !== true) return settings;

  const currentProvider = String(settings.ai_provider || '').toLowerCase();
  const currentModel = String(settings.ai_model || '').trim();
  const primaryAssignmentId = String(settings.agent_primary_assignment_id || '');
  const localModels = readAgentModels(settings).filter(
    (entry) => entry.provider === 'local' && entry.model,
  );
  const selected = localModels.find((entry) => entry.id === primaryAssignmentId);
  const primary = localModels.find((entry) => entry.role === 'orchestrator' && entry.primary);
  const fallback = selected || primary || localModels[0];
  const model =
    currentProvider === 'local' && currentModel ? currentModel : fallback?.model || currentModel;

  return {
    ...settings,
    ai_provider: 'local',
    ai_model: model,
    ai_api_key: '',
    ai_runtime_api_key: '',
  };
}
