/**
 * Builds the permitted web-search provider chain, tracks search budgets and caches within a
 * session, and coordinates site-level approval state for web research.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.
import { getKey } from '@/platform/keyStore'

import * as config from '@/platform/agent/runtime/config'
import * as continuity from '@/platform/agent/runtime/continuity'
import * as todoTrace from '@/platform/agent/runtime/todoTrace'
import * as capabilityPolicy from '@/platform/agent/runtime/capabilityPolicy'
const {
  SEARCH_WEB_DEFAULT_CALL_BUDGET,
  SEARCH_WEB_MAX_CALL_BUDGET,
  WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER,
  WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
  WEB_SEARCH_PAID_PROVIDER_IDS,
} = Object.assign({}, config, continuity, todoTrace, capabilityPolicy)

interface WebProviderSettings {
  googleCseApiKey: string
  googleCseCx: string
  tavilyApiKey: string
  exaApiKey: string
  serperApiKey: string
  serpApiApiKey: string
  braveApiKey: string
}

interface WebSearchSettings {
  search_web_google_cse_cx?: unknown
  search_web_primary_provider?: unknown
  search_web_fallback_chain?: unknown
  search_web_require_paid_fallback_confirmation?: unknown
  agent_search_web_budget?: unknown
}

interface WebSearchApprovalState {
  allowPaidSearchFallback?: boolean
}

export interface WebSearchSessionState<T = unknown> {
  maxCalls: number
  callsUsed: number
  queryHistory: string[]
  cache: Map<string, T>
}

// Converts path for policy into the canonical representation expected by later code.
export function normalizePathForPolicy(pathInput: unknown): string {
  return String(pathInput || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

// Converts path token into the canonical representation expected by later code.
export function normalizePathToken(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

// Evaluates whether is likely relative path for the supplied value and current runtime state.
export function isLikelyRelativePath(pathInput: unknown): boolean {
  const text = String(pathInput || '').trim()
  if (!text) return false
  if (text.startsWith('/') || text.startsWith('~/') || text === '~') return false
  return true
}

// Removes duplicate strings while preserving first-seen order.
export function dedupeStrings(items: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  items.forEach((item) => {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    output.push(value)
  })

  return output
}

// Converts web search query key into the canonical representation expected by later code.
export function normalizeWebSearchQueryKey(query: unknown): string {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

/**
 * Maps configured web-search provider names and aliases onto the supported provider
 * identifiers used by the bridge. Unknown or empty values are rejected rather than silently
 * selecting an unintended paid service.
 */

export function normalizeWebProviderId(value: unknown, fallback: string = WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER): string {
  const token = String(value || '')
    .trim()
    .toLowerCase()
  if (!token) return fallback

  if (token === 'google') return 'google_cse'
  if (token === 'ddg') return 'duckduckgo'

  const known = new Set<string>(['duckduckgo', 'google_cse', 'tavily', 'exa', 'serper', 'brave', 'serpapi'])

  return known.has(token) ? token : fallback
}

/**
 * Builds an ordered, duplicate-free web-search fallback list from the user's settings. The
 * primary provider stays first while unsupported entries are removed before any research
 * request is attempted.
 */

export function normalizeWebProviderList(
  value: unknown,
  fallbackList: readonly unknown[] = WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
): string[] {
  const input = Array.isArray(value) ? value : String(value || '').split(',')

  const seen = new Set<string>()
  const output: string[] = []

  input.forEach((entry) => {
    const providerId = normalizeWebProviderId(entry, '')
    if (!providerId || seen.has(providerId)) return
    seen.add(providerId)
    output.push(providerId)
  })

  if (output.length) return output

  const fallbackSeen = new Set<string>()
  return fallbackList
    .map((entry) => normalizeWebProviderId(entry, ''))
    .filter((entry) => {
      if (!entry || fallbackSeen.has(entry)) return false
      fallbackSeen.add(entry)
      return true
    })
}

// Converts web provider settings into the canonical representation expected by later code.
export function normalizeWebProviderSettings(settings: WebSearchSettings | null | undefined): WebProviderSettings {
  return {
    googleCseApiKey: getKey('search-google-cse'),
    googleCseCx: String(settings?.search_web_google_cse_cx || '').trim(),
    tavilyApiKey: getKey('search-tavily'),
    exaApiKey: getKey('search-exa'),
    serperApiKey: getKey('search-serper'),
    serpApiApiKey: getKey('search-serpapi'),
    braveApiKey: getKey('search-brave'),
  }
}

/**
 * Evaluates whether has configured provider credentials for the supplied value and current
 * runtime state.
 */

export function hasConfiguredProviderCredentials(providerId: string, providerSettings: WebProviderSettings): boolean {
  switch (providerId) {
    case 'duckduckgo':
      return true
    case 'google_cse':
      return Boolean(providerSettings.googleCseApiKey && providerSettings.googleCseCx)
    case 'tavily':
      return Boolean(providerSettings.tavilyApiKey)
    case 'exa':
      return Boolean(providerSettings.exaApiKey)
    case 'serper':
      return Boolean(providerSettings.serperApiKey)
    case 'brave':
      return Boolean(providerSettings.braveApiKey)
    case 'serpapi':
      return Boolean(providerSettings.serpApiApiKey)
    default:
      return false
  }
}

// Evaluates whether has configured paid fallback providers for the supplied value and current
// runtime state.
export function hasConfiguredPaidFallbackProviders(
  providerList: readonly unknown[] | null | undefined,
  providerSettings: WebProviderSettings,
): boolean {
  const candidates = Array.isArray(providerList) ? providerList : []

  return candidates.some((providerId) => {
    if (!WEB_SEARCH_PAID_PROVIDER_IDS.has(providerId)) return false
    return hasConfiguredProviderCredentials(providerId, providerSettings)
  })
}

// Assembles web search provider policy from lower-level state so callers receive one consistent
// representation.
export function buildWebSearchProviderPolicy(
  settings: WebSearchSettings | null | undefined,
  approvalState: WebSearchApprovalState | null | undefined,
) {
  const primaryProvider = normalizeWebProviderId(
    settings?.search_web_primary_provider,
    WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER,
  )
  const fallbackProviders = normalizeWebProviderList(
    settings?.search_web_fallback_chain,
    WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
  ).filter((providerId) => providerId !== primaryProvider)

  const requirePaidFallbackConfirmation = settings?.search_web_require_paid_fallback_confirmation !== false
  const allowPaidFallback = !requirePaidFallbackConfirmation || Boolean(approvalState?.allowPaidSearchFallback)

  const providerSettings = normalizeWebProviderSettings(settings)

  return {
    providerPolicy: {
      primaryProvider,
      fallbackProviders,
      allowPaidFallback,
    },
    providerSettings,
    requirePaidFallbackConfirmation,
  }
}

// Selects or derives web search call budget from the available settings, input, and runtime
// context.
export function resolveWebSearchCallBudget(settings: WebSearchSettings | null | undefined): number {
  const configured = Number(settings?.agent_search_web_budget)
  if (!Number.isFinite(configured)) return SEARCH_WEB_DEFAULT_CALL_BUDGET
  return Math.max(1, Math.min(SEARCH_WEB_MAX_CALL_BUDGET, Math.round(configured)))
}

// Creates web search session state with the state and dependencies needed by its consumers.
export function createWebSearchSessionState(settings: WebSearchSettings | null | undefined): WebSearchSessionState {
  return {
    maxCalls: resolveWebSearchCallBudget(settings),
    callsUsed: 0,
    queryHistory: [],
    cache: new Map<string, unknown>(),
  }
}

// Persists web search query in the durable memory owned by the current chat.
export function rememberWebSearchQuery(state: WebSearchSessionState | null | undefined, queryKey: string): void {
  if (!state || !queryKey) return

  const history = Array.isArray(state.queryHistory) ? state.queryHistory : []
  const nextHistory = [queryKey, ...history.filter((entry) => entry !== queryKey)].slice(0, 8)
  state.queryHistory = nextHistory
}

// Returns web search cache without requiring callers to know where or how it is stored.
export function getWebSearchCache<T = unknown>(
  state: WebSearchSessionState<T> | null | undefined,
  queryKey: string,
): T | null {
  if (!state || !queryKey) return null
  if (!(state.cache instanceof Map)) return null
  return state.cache.get(queryKey) || null
}

// Changes web search cache and performs any related synchronization required by the feature.
export function setWebSearchCache<T>(
  state: WebSearchSessionState<T> | null | undefined,
  queryKey: string,
  payload: T,
): void {
  if (!state || !queryKey || !payload) return
  if (!(state.cache instanceof Map)) return

  state.cache.set(queryKey, payload)

  if (state.cache.size > 10) {
    const oldestKey = state.cache.keys().next().value
    if (oldestKey) state.cache.delete(oldestKey)
  }
}
