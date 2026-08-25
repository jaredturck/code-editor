/** Runs the explicit one-click setup operation and returns one atomic settings patch. */

import { testConnection } from '@/platform/aiService'
import { discoverLocalAIServers, pullLocalOllamaModel, systemStats } from '@/platform/desktopBridge'
import { getKey, listProviderKeys } from '@/platform/keyStore'
import { buildAutomaticSetupPlan } from '@/platform/autoSetup/autoSetupEngine'
import { evaluateModel } from '@/platform/autoSetup/modelSelectionRules'
import {
  normalizeModelList,
  providerCredentialId,
  type ProviderConfigurationSettings,
  type ProviderKeyValidationRecord,
} from '@/platform/providers/providerConfiguration'
import { AI_PROVIDER_DEFINITIONS } from '@/platform/providers/providerRegistry'
import { chooseAutomaticLocalModel } from '@/platform/providers/localModelCatalog'
import { evaluateLocalRuntimeFit, localRuntimeFitScore } from '@/platform/providers/localRuntimePolicy'

export interface AutomaticSetupResult {
  patch: Record<string, unknown>
  summary: string[]
  testedKeys: number
  validKeys: number
  localDetected: boolean
}

function classifyFailedTest(message: unknown): ProviderKeyValidationRecord['status'] {
  return /(401|403|unauthori[sz]ed|authentication|invalid.{0,20}(key|token)|credential|forbidden)/i.test(
    String(message || ''),
  )
    ? 'invalid'
    : 'unavailable'
}

function local_agent_score(candidate: ReturnType<typeof evaluateModel>) {
  return candidate.roleScores.scout + candidate.roleScores.executor + candidate.roleScores.orchestrator
}

function findSuitableInstalledLocalModel(
  models: string[],
  hardware: Awaited<ReturnType<typeof systemStats>> | null,
): string {
  const ranked = normalizeModelList(models)
    .filter((model) => !/(?:^|[-_:])(embed|embedding|minilm|clip|rerank|nomic|bge)(?:[-_:]|$)/i.test(model))
    .map((model) => ({
      evaluation: evaluateModel({ provider: 'local', model, keyId: '1' }),
      runtime: evaluateLocalRuntimeFit(model, hardware),
    }))
    .filter(({ evaluation }) => !evaluation.excluded)

  const hardware_viable = ranked.filter(({ runtime }) => runtime.fit !== 'oversized')
  const pool = hardware_viable.length ? hardware_viable : ranked
  pool.sort(
    (left, right) =>
      local_agent_score(right.evaluation) +
      localRuntimeFitScore(right.runtime) * 4 -
      (local_agent_score(left.evaluation) + localRuntimeFitScore(left.runtime) * 4),
  )
  return pool[0]?.evaluation.model || ''
}

export async function runAutomaticSetup(
  settings: ProviderConfigurationSettings & Record<string, unknown>,
): Promise<AutomaticSetupResult> {
  const validations = { ...(settings.provider_key_validation || {}) }
  const discovered = { ...(settings.discovered_models || {}) }
  const setupSummary: string[] = []
  let testedKeys = 0
  let validKeys = 0

  for (const provider of AI_PROVIDER_DEFINITIONS.filter((definition) => definition.requiresApiKey)) {
    const keyIds = listProviderKeys(provider.id).filter((keyId) => getKey(provider.id, keyId))
    for (const keyId of keyIds) {
      testedKeys += 1
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
      }))
      const id = providerCredentialId(provider.id, keyId)
      const models = normalizeModelList(result.models)
      validations[id] = {
        status: result.ok ? 'valid' : classifyFailedTest(result.message),
        testedAt: Date.now(),
        message: String(result.message || ''),
        models,
      }
      if (result.ok) {
        validKeys += 1
        discovered[id] = models
        if (keyId === '1') discovered[provider.id] = models
      } else {
        delete discovered[id]
        if (keyId === '1') delete discovered[provider.id]
      }
    }
  }

  let localDetected = false
  let localPatch: Record<string, unknown> = {}
  const result = await discoverLocalAIServers().catch(() => [])
  const servers = Array.isArray(result) ? result : result?.servers || []
  const preferred =
    (!Array.isArray(result) && result?.preferred) ||
    servers.find((server) => server.kind === 'ollama') ||
    servers.find((server) => Number(server.modelCount) > 0) ||
    servers[0]

  if (preferred) {
    const hardware = await systemStats().catch(() => null)
    let localModels = normalizeModelList(preferred.models)
    let selectedLocalModel = findSuitableInstalledLocalModel(localModels, hardware)
    if (!selectedLocalModel) {
      if (preferred.kind !== 'ollama') {
        throw new Error(
          'No suitable local chat model was found. Add a model in LM Studio or the configured OpenAI-compatible runtime, or connect Ollama so Auto Setup can install one.',
        )
      }
      selectedLocalModel = chooseAutomaticLocalModel(hardware)
      if (!selectedLocalModel) {
        const availableVramGb = evaluateLocalRuntimeFit('qwen3.5:9b', hardware).availableVramGb
        throw new Error(
          availableVramGb === null
            ? 'No suitable automatic local worker could be selected for this machine.'
            : `No recommended local worker safely fits the detected ${availableVramGb} GB of GPU memory. Install a smaller compatible model manually or use a cloud provider.`,
        )
      }
      await pullLocalOllamaModel(preferred.url, selectedLocalModel)
      localModels = normalizeModelList([selectedLocalModel, ...localModels])
      setupSummary.push(`Downloaded local worker: ${selectedLocalModel}`)
    }

    const runtimeFit = evaluateLocalRuntimeFit(selectedLocalModel, hardware)
    const fitDetail =
      runtimeFit.availableVramGb === null || runtimeFit.estimatedMemoryGb === null
        ? ''
        : ` (${runtimeFit.fit}; ~${runtimeFit.estimatedMemoryGb} GB model footprint / ${runtimeFit.availableVramGb} GB VRAM)`
    setupSummary.push(`Local runtime: ${preferred.kind} · ${selectedLocalModel}${fitDetail}`)

    const localId = providerCredentialId('local', '1')
    validations[localId] = {
      status: 'valid',
      testedAt: Date.now(),
      message: `Connected to ${preferred.kind}. Local worker ${selectedLocalModel} is ready${fitDetail}.`,
      models: localModels,
    }
    discovered.local = localModels
    discovered[localId] = localModels
    localPatch = {
      ai_local_url: preferred.url,
      local_runtime_kind: preferred.kind,
      agent_required_local_model: selectedLocalModel,
    }
    localDetected = true
  } else if (validKeys === 0) {
    throw new Error(
      'No local runtime or validated cloud provider is available. Start Ollama or add and test a cloud API key, then run Auto Setup again.',
    )
  } else {
    setupSummary.push('No local runtime detected; created a cloud-only agent profile.')
  }

  const workingSettings = {
    ...settings,
    ...localPatch,
    provider_key_validation: validations,
    discovered_models: discovered,
  }
  const plan = buildAutomaticSetupPlan(workingSettings)
  const audioProvider = String(settings.audio_provider || 'local')
  const audioModel = String(
    settings.audio_model || (audioProvider === 'local' ? 'gabegoodhart/granite4.1-speech:2b' : ''),
  )
  const audioKeyId = String(settings.audio_key_id || '1')
  const audioLocalFallback = settings.audio_local_fallback !== false

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
  }
}
