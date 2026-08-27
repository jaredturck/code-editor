/**
 * Local-only model provider registry.
 *
 * The editor is an agentic coding IDE, not a general cloud-provider client. All coding roles
 * execute through the configured local inference server. Role specialization remains a runtime
 * concern; provider switching, API-key routing and cloud discovery do not.
 */
import { listLocalModels } from '@/platform/providers/localProvider'
import { callStructuredLocalLLM } from '@/platform/providers/localStructuredProvider'
import type {
  AIProvider,
  AIProviderDefinition,
  AIProviderId,
  ProviderDiscoveryContext,
  ProviderInvokeContext,
} from '@/platform/providers/types'

export type { AIProvider, AIProviderDefinition, AIProviderId } from '@/platform/providers/types'

const LOCAL_PROVIDER: AIProvider = Object.freeze({
  id: 'local',
  label: 'Local',
  color: '#94A3B8',
  keyPlaceholder: null,
  keyHelpUrl: null,
  requiresApiKey: false,
  defaultModel: 'llama3',
  models: Object.freeze(['llama3', 'llama3.2', 'codellama', 'qwen3', 'qwen3.5', 'deepseek-coder']),
  invoke: ({ messages, model, settings, fetchFn, options }: ProviderInvokeContext) =>
    callStructuredLocalLLM(messages, String(settings?.ai_local_url || ''), model, fetchFn, options),
  discoverModels: ({ settings, fetchFn }: ProviderDiscoveryContext) =>
    listLocalModels(String(settings?.ai_local_url || ''), fetchFn),
})

const PROVIDERS = Object.freeze([LOCAL_PROVIDER] as const)
const PROVIDER_MAP = new Map<AIProviderId, AIProvider>([['local', LOCAL_PROVIDER]])

export const AI_PROVIDER_DEFINITIONS: readonly AIProviderDefinition[] = Object.freeze([
  Object.freeze({
    id: LOCAL_PROVIDER.id,
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
  return PROVIDER_MAP.get(String(value || '').trim().toLowerCase() as AIProviderId) || null
}

export function getAIProvider(value: unknown): AIProvider {
  const provider = findAIProvider(value)
  if (provider) return provider
  throw new Error(`Only local model execution is supported. Requested provider: ${String(value || '')}`)
}
