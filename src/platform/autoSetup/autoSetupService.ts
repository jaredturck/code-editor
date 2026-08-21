/** Runs the explicit one-click setup operation and returns one atomic settings patch. */

import { testConnection } from '@/platform/aiService';
import { discoverLocalAIServers, pullLocalOllamaModel, systemStats } from '@/platform/desktopBridge';
import { getKey, listProviderKeys } from '@/platform/keyStore';
import { buildAutomaticSetupPlan } from '@/platform/autoSetup/autoSetupEngine';
import { evaluateModel } from '@/platform/autoSetup/modelSelectionRules';
import {
  normalizeModelList,
  providerCredentialId,
  type ProviderConfigurationSettings,
  type ProviderKeyValidationRecord,
} from '@/platform/providers/providerConfiguration';
import { AI_PROVIDER_DEFINITIONS } from '@/platform/providers/providerRegistry';
import { chooseAutomaticLocalModel } from '@/platform/providers/localModelCatalog';

export interface AutomaticSetupResult {
  patch: Record<string, unknown>;
  summary: string[];
  testedKeys: number;
  validKeys: number;
  localDetected: boolean;
}

function classifyFailedTest(message: unknown): ProviderKeyValidationRecord['status'] {
  return /(401|403|unauthori[sz]ed|authentication|invalid.{0,20}(key|token)|credential|forbidden)/i.test(
    String(message || ''),
  )
    ? 'invalid'
    : 'unavailable';
}

function findSuitableInstalledLocalModel(models: string[]): string {
  const ranked = normalizeModelList(models)
    .filter(
      (model) =>
        !/(?:^|[-_:])(embed|embedding|minilm|clip|rerank|nomic|bge)(?:[-_:]|$)/i.test(model),
    )
    .map((model) => evaluateModel({ provider: 'local', model, keyId: '1' }))
    .filter((candidate) => !candidate.excluded)
    .sort(
      (left, right) =>
        right.roleScores.scout +
        right.roleScores.executor +
        right.roleScores.orchestrator -
        (left.roleScores.scout + left.roleScores.executor + left.roleScores.orchestrator),
    );
  return ranked[0]?.model || '';
}

export async function runAutomaticSetup(
  settings: ProviderConfigurationSettings & Record<string, unknown>,
): Promise<AutomaticSetupResult> {
  const validations = { ...(settings.provider_key_validation || {}) };
  const discovered = { ...(settings.discovered_models || {}) };
  const setupSummary: string[] = [];
  let testedKeys = 0;
  let validKeys = 0;

  for (const provider of AI_PROVIDER_DEFINITIONS.filter(
    (definition) => definition.requiresApiKey,
  )) {
    const keyIds = listProviderKeys(provider.id).filter((keyId) => getKey(provider.id, keyId));
    for (const keyId of keyIds) {
      testedKeys += 1;
      const result = await testConnection(
        {
          ...settings,
          ai_provider: provider.id,
          ai_model: provider.defaultModel,
        },
        keyId,
      ).catch((error) => ({
        ok: false,
        models: [],
        message: error instanceof Error ? error.message : 'Connection test failed.',
      }));
      const id = providerCredentialId(provider.id, keyId);
      const models = normalizeModelList(result.models);
      validations[id] = {
        status: result.ok ? 'valid' : classifyFailedTest(result.message),
        testedAt: Date.now(),
        message: String(result.message || ''),
        models,
      };
      if (result.ok) {
        validKeys += 1;
        discovered[id] = models;
        if (keyId === '1') discovered[provider.id] = models;
      } else {
        delete discovered[id];
        if (keyId === '1') delete discovered[provider.id];
      }
    }
  }

  let localDetected = false;
  let localPatch: Record<string, unknown> = {};
  const result = await discoverLocalAIServers().catch(() => []);
  const servers = Array.isArray(result) ? result : result?.servers || [];
  const preferred =
    (!Array.isArray(result) && result?.preferred) ||
    servers.find((server) => server.kind === 'ollama') ||
    servers.find((server) => Number(server.modelCount) > 0) ||
    servers[0];

  if (preferred) {
    let localModels = normalizeModelList(preferred.models);
    let selectedLocalModel = findSuitableInstalledLocalModel(localModels);
    if (!selectedLocalModel) {
      if (preferred.kind !== 'ollama') {
        throw new Error(
          'No suitable local chat model was found. Add a model in LM Studio or connect Ollama so Auto Setup can install one.',
        );
      }
      const hardware = await systemStats().catch(() => null);
      selectedLocalModel = chooseAutomaticLocalModel(hardware);
      await pullLocalOllamaModel(preferred.url, selectedLocalModel);
      localModels = normalizeModelList([selectedLocalModel, ...localModels]);
      setupSummary.push(`Downloaded local worker: ${selectedLocalModel}`);
    }

    const localId = providerCredentialId('local', '1');
    validations[localId] = {
      status: 'valid',
      testedAt: Date.now(),
      message: `Connected to ${preferred.kind}. Local worker ${selectedLocalModel} is ready.`,
      models: localModels,
    };
    discovered.local = localModels;
    discovered[localId] = localModels;
    localPatch = {
      ai_local_url: preferred.url,
      local_runtime_kind: preferred.kind,
      agent_required_local_model: selectedLocalModel,
    };
    localDetected = true;
  } else if (validKeys === 0) {
    throw new Error(
      'No local runtime or validated cloud provider is available. Start Ollama or add and test a cloud API key, then run Auto Setup again.',
    );
  } else {
    setupSummary.push('No local runtime detected; created a cloud-only agent profile.');
  }

  const workingSettings = {
    ...settings,
    ...localPatch,
    provider_key_validation: validations,
    discovered_models: discovered,
  };
  const plan = buildAutomaticSetupPlan(workingSettings);
  const audioProvider = String(settings.audio_provider || 'local');
  const audioModel = String(
    settings.audio_model || (audioProvider === 'local' ? 'gabegoodhart/granite4.1-speech:2b' : ''),
  );
  const audioKeyId = String(settings.audio_key_id || '1');
  const audioLocalFallback = settings.audio_local_fallback !== false;

  return {
    patch: {
      ...localPatch,
      provider_key_validation: validations,
      discovered_models: discovered,
      ...plan.patch,
      audio_provider: audioProvider,
      audio_model: audioModel,
      audio_key_id: audioKeyId,
      audio_local_fallback: audioLocalFallback,
      agent_cloud_request_budget: 50,
      connection_status: 'connected',
    },
    summary: [
      ...setupSummary,
      ...plan.summary,
      audioProvider === 'local'
        ? 'Audio: local Granite Speech (downloaded on first use if needed)'
        : `Audio: ${audioProvider} / ${audioModel || 'select a transcription model'}`,
    ],
    testedKeys,
    validKeys,
    localDetected,
  };
}
