/** Single local model provider for the agentic coding IDE. */
import { listLocalModels } from '@/platform/providers/localProvider'
import { callStructuredLocalLLM } from '@/platform/providers/localStructuredProvider'
import type { AIProvider, AIProviderDefinition, AIProviderId, ProviderDiscoveryContext, ProviderInvokeContext } from '@/platform/providers/types'

export type { AIProvider, AIProviderDefinition, AIProviderId } from '@/platform/providers/types'

const LOCAL_PROVIDER: AIProvider = Object.freeze({
  id: 'local',
  label: 'Local Qwen',
  color: '#94A3B8',
  keyPlaceholder: null,
  keyHelpUrl: null,
  requiresApiKey: false,
  defaultModel: 'qwen3.6:27b',
  models: Object.freeze(['qwen3.6:27b', 'qwen3-coder:30b']),
  invoke: ({ messages, model, settings, fetchFn, options }: ProviderInvokeContext) =>
    callStructuredLocalLLM(messages, String(settings?.ai_local_url || ''), model, fetchFn, options),
  discoverModels: ({ settings, fetchFn }: ProviderDiscoveryContext) =>
    listLocalModels(String(settings?.ai_local_url || ''), fetchFn),
})

const PROVIDERS = Object.freeze([LOCAL_PROVIDER] as const)

export const AI_PROVIDER_DEFINITIONS: readonly AIProviderDefinition[] = Object.freeze([
  Object.freeze({
    id: 'local',
    label: LOCAL_PROVIDER.label,
    color: LOCAL_PROVIDER.color,
    keyPlaceholder: null,
    keyHelpUrl: null,
    requiresApiKey: false,
    defaultModel: LOCAL_PROVIDER.defaultModel,
    models: LOCAL_PROVIDER.models,
  }),
])

export const DEFAULT_AI_PROVIDER_ID: AIProviderId = 'local'
export const DEFAULT_AI_MODEL = LOCAL_PROVIDER.defaultModel

export function listAIProviders(): readonly AIProvider[] {
  return PROVIDERS
}

export function listAIProviderDefinitions(): readonly AIProviderDefinition[] {
  return AI_PROVIDER_DEFINITIONS
}

export function isAIProviderId(value: unknown): value is AIProviderId {
  return String(value || '').trim().toLowerCase() === 'local'
}

export function findAIProvider(value: unknown): AIProvider | null {
  return isAIProviderId(value) ? LOCAL_PROVIDER : null
}

export function getAIProvider(value: unknown): AIProvider {
  const provider = findAIProvider(value)
  if (provider) return provider
  throw new Error(`Only local Qwen model execution is supported. Requested provider: ${String(value || '')}`)
}
