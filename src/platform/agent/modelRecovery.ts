/**
 * Exhausted-role recovery recommendations.
 *
 * Prefer a healthy model the user can use immediately. If none meets the role and hardware floor,
 * recommend a hardware-sized Ollama download. Selection is deterministic and reuses Auto Setup's
 * model scoring rather than making another AI request.
 */
import type { AutoSetupCandidate, ModelEvaluation } from '@/platform/autoSetup/modelSelectionRules'
import { compareForRole, evaluateModel } from '@/platform/autoSetup/modelSelectionRules'
import { systemStats } from '@/platform/desktopBridge'
import {
  getValidProviderKeyIds,
  getDiscoveredModelsForKey,
  normalizeModelList,
  type ProviderConfigurationSettings,
} from '@/platform/providers/providerConfiguration'
import { chooseAutomaticLocalModel, RECOMMENDED_LOCAL_MODELS } from '@/platform/providers/localModelCatalog'
import { isModelCredentialReady, isModelHealthy } from '@/platform/agent/modelHealth'

export interface RecoveryRecommendation {
  provider: string
  model: string
  keyId: string
  role: string
  label: string
  reason: string
  requiresDownload: boolean
  downloadBaseUrl?: string
  downloadSize?: string
}

type RecoverySettings = ProviderConfigurationSettings & Record<string, unknown>

const KNOWN_CLOUD_PROVIDERS = [
  'anthropic',
  'openai',
  'deepseek',
  'openrouter',
  'google',
  'gemini',
  'mistral',
  'groq',
  'xai',
]

function identity(provider: unknown, model: unknown, keyId: unknown): string {
  return `${String(provider || '').toLowerCase()}:${String(model || '').toLowerCase()}:${String(keyId || '1')}`
}

function listAvailableCandidates(settings: RecoverySettings): AutoSetupCandidate[] {
  const out: AutoSetupCandidate[] = []
  const seen = new Set<string>()
  const add = (provider: string, model: string, keyId: string): void => {
    const id = identity(provider, model, keyId)
    if (!model || seen.has(id)) return
    seen.add(id)
    out.push({ provider, model, keyId })
  }

  for (const model of normalizeModelList((settings.discovered_models || {})['local'])) {
    add('local', model, '1')
  }

  const providerIds = new Set<string>([
    ...Object.keys(settings.provider_selected_models || {}),
    ...KNOWN_CLOUD_PROVIDERS,
  ])
  for (const provider of providerIds) {
    if (String(provider).toLowerCase() === 'local') continue
    for (const keyId of getValidProviderKeyIds(settings, provider)) {
      for (const model of getDiscoveredModelsForKey(settings, provider, keyId)) {
        add(provider, model, keyId)
      }
    }
  }
  return out
}

function parameterBillions(model: string): number | null {
  const matches = [
    ...String(model)
      .toLowerCase()
      .matchAll(/(?:^|[-_:])([0-9]+(?:\.[0-9]+)?)b(?:[-_:]|$)/g),
  ]
  const value = Number(matches.at(-1)?.[1])
  return Number.isFinite(value) ? value : null
}

function fitsLocalHardware(
  evaluation: ModelEvaluation,
  hardware: Awaited<ReturnType<typeof systemStats>>,
  role: string,
): boolean {
  if (!evaluation.local) return true
  const parameters = parameterBillions(evaluation.model)
  if (parameters != null) {
    const floor = role === 'scout' ? 3 : 4
    if (parameters < floor) return false
    const gpuGb = Number(hardware?.gpuMemoryTotalMb || 0) / 1024
    const ramGb = Number(hardware?.memTotal || 0) / 1024 ** 3
    const practicalGb = gpuGb + Math.min(24, ramGb * 0.35)
    const estimatedQ4Gb = parameters * 0.65 + 1.5
    if (practicalGb > 0 && estimatedQ4Gb > practicalGb) return false
  }
  return true
}

function isRoleSuitable(evaluation: ModelEvaluation, role: string): boolean {
  if (evaluation.excluded) return false
  const roleScore = evaluation.roleScores[role as keyof typeof evaluation.roleScores] || 0
  return roleScore >= 45 && evaluation.quality >= 35
}

export async function recommendRecoveryModel(
  settings: RecoverySettings,
  role: string,
  exclude: Array<{ provider: unknown; model: unknown; keyId?: unknown }> = [],
): Promise<RecoveryRecommendation | null> {
  const excludeSet = new Set(exclude.map((entry) => identity(entry.provider, entry.model, entry.keyId)))
  const hardware = await systemStats().catch(() => null)
  const candidates = listAvailableCandidates(settings)
    .filter((candidate) => !excludeSet.has(identity(candidate.provider, candidate.model, candidate.keyId)))
    .filter((candidate) => isModelCredentialReady(candidate.provider, candidate.keyId))
    .filter((candidate) => isModelHealthy(candidate.provider, candidate.model, candidate.keyId))
    .map(evaluateModel)
    .filter((evaluation) => isRoleSuitable(evaluation, role))
    .filter((evaluation) => fitsLocalHardware(evaluation, hardware, role))
    .sort((left, right) => compareForRole(role as never, left, right))

  const best = candidates[0]
  if (best) {
    return {
      provider: best.provider,
      model: best.model,
      keyId: best.keyId || '1',
      role,
      label: `${best.local ? 'Local' : best.provider} · ${best.model}`,
      reason: best.local
        ? 'Already installed, healthy, and suitable for this role on the detected hardware.'
        : 'Already available through a saved provider key and suitable for this role.',
      requiresDownload: false,
    }
  }

  if (String(settings.local_runtime_kind || '').toLowerCase() !== 'ollama') return null
  const baseUrl = String(settings.ai_local_url || '').trim()
  if (!baseUrl) return null
  const model = chooseAutomaticLocalModel(hardware)
  if (excludeSet.has(identity('local', model, '1'))) return null
  const catalog = RECOMMENDED_LOCAL_MODELS.find((entry) => entry.id === model)
  return {
    provider: 'local',
    model,
    keyId: '1',
    role,
    label: `Local · ${catalog?.label || model}`,
    reason: `No installed or configured model met the recovery threshold. This model is sized for the detected hardware and supports general agent work.`,
    requiresDownload: true,
    downloadBaseUrl: baseUrl,
    downloadSize: catalog?.size || 'size varies',
  }
}
