/**
 * Local inference client for the agentic coding IDE.
 *
 * There is one execution target: the configured local Qwen-compatible server. No API keys,
 * hosted-provider routing, cloud budgets, or automatic model downloads live in this layer.
 */
import { DEFAULT_AI_PROVIDER_ID, getAIProvider } from '@/platform/providers/providerRegistry'
import { getErrorMessage } from '@/platform/providers/providerUtils'
import type { ProviderMeta } from '@/platform/agent/types'
import type {
  AIConnectionTestResult,
  AIMessage,
  AISettings,
  ProviderCallOptions,
  ProviderFetch,
  ProviderFetchOptions,
  ProviderResponseLike,
  ProviderStreamResult,
} from '@/platform/providers/types'

export type { AIConnectionTestResult, AIMessage, AISettings, ProviderCallOptions } from '@/platform/providers/types'

const DEFAULT_TIMEOUT_MS = 5 * 60_000

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

export async function fetchWithBridgeFallback(
  url: string,
  init: RequestInit = {},
  options: ProviderFetchOptions = {},
): Promise<ProviderResponseLike> {
  if (init.signal?.aborted) throw abortError()
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const external = init.signal
  const onAbort = () => controller.abort()
  external?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

export async function fetchAIStream(
  url: string,
  init: RequestInit = {},
  onChunk?: (chunk: string) => void,
  options: ProviderFetchOptions = {},
): Promise<ProviderStreamResult> {
  const response = await fetchWithBridgeFallback(url, init, options)
  if (!response.ok || !response.body) return { ok: response.ok, status: response.status }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) onChunk?.(decoder.decode(value, { stream: true }))
  }
  return { ok: true, status: response.status }
}

export async function discoverModelsForProvider(
  provider: unknown,
  settings: AISettings,
): Promise<string[]> {
  if (String(provider || DEFAULT_AI_PROVIDER_ID).toLowerCase() !== 'local') return []
  try {
    const registration = getAIProvider('local')
    const fetchFn: ProviderFetch = (url, init = {}, options = {}) => fetchWithBridgeFallback(url, init, options)
    return await registration.discoverModels({ settings, apiKey: '', fetchFn })
  } catch {
    return []
  }
}

export async function callAIWithMeta(
  messages: readonly AIMessage[],
  settings: AISettings,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  if (options.signal?.aborted) throw abortError()
  const registration = getAIProvider('local')
  const model = String(settings?.ai_model || registration.defaultModel)
  const localSettings: AISettings = { ...settings, ai_provider: 'local', ai_model: model }
  const fetchFn: ProviderFetch = (url, init = {}, requestOptions = {}) =>
    fetchWithBridgeFallback(url, { ...init, signal: init.signal ?? options.signal }, requestOptions)
  return registration.invoke({
    messages,
    settings: localSettings,
    apiKey: '',
    model,
    fetchFn,
    options: { ...options, settings: localSettings },
  })
}

export async function callAI(messages: readonly AIMessage[], settings: AISettings): Promise<string> {
  const response = await callAIWithMeta(messages, settings)
  return String(response?.text || '')
}

export async function testConnection(settings: AISettings): Promise<AIConnectionTestResult> {
  const models = await discoverModelsForProvider('local', settings)
  const selected = String(settings?.ai_model || '').trim()
  try {
    const response = await callAI([{ role: 'user', content: 'Reply with OK only.' }], {
      ...settings,
      ai_provider: 'local',
      ai_model: selected || models[0],
    })
    return {
      ok: Boolean(response.trim()),
      models,
      message: response.trim()
        ? `Local model server connected${selected ? ` and ${selected} responded` : ''}.`
        : 'Local model server returned an empty response.',
    }
  } catch (error) {
    return {
      ok: false,
      models,
      message: getErrorMessage(error, 'Local model connection failed.'),
    }
  }
}
