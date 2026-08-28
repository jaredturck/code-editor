/** Runs the explicit one-click local model setup operation and returns one atomic settings patch. */

import { testConnection } from '@/platform/aiService'
import { buildAutomaticSetupPlan } from '@/platform/autoSetup/autoSetupEngine'
import { DEFAULT_AI_MODEL } from '@/platform/providers/providerRegistry'

export interface AutomaticSetupResult {
  patch: Record<string, unknown>
  summary: string[]
  testedKeys: number
  validKeys: number
  localDetected: boolean
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((model) => String(model || '').trim()).filter(Boolean)))
}

export async function runAutomaticSetup(settings: Record<string, unknown>): Promise<AutomaticSetupResult> {
  const result = await testConnection({
    ...settings,
    ai_provider: 'local',
  })
  if (!result.ok) {
    throw new Error(result.message || 'The local model server is unavailable.')
  }

  const models = normalizeModelList([
    ...normalizeModelList(result.models),
    String(settings.ai_model || ''),
    DEFAULT_AI_MODEL,
  ])
  const discovered =
    settings.discovered_models && typeof settings.discovered_models === 'object'
      ? (settings.discovered_models as Record<string, unknown>)
      : {}
  const workingSettings = {
    ...settings,
    ai_provider: 'local',
    discovered_models: {
      ...discovered,
      local: models,
    },
    provider_selected_models: { local: models },
  }
  const plan = buildAutomaticSetupPlan(workingSettings)

  return {
    patch: {
      discovered_models: workingSettings.discovered_models,
      ...plan.patch,
      connection_status: 'connected',
    },
    summary: [`Local runtime connected · ${plan.patch.ai_model}`, ...plan.summary],
    testedKeys: 0,
    validKeys: 0,
    localDetected: true,
  }
}
