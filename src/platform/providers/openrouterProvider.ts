/**
 * openrouterProvider.js
 * OpenRouter API adapter — OpenAI-compatible aggregator of 100+ models.
 * Model format: "openai/gpt-4o", "anthropic/claude-3-5-sonnet", etc.
 */

import { normalizeApiKey } from '@/platform/providers/providerUtils'
import { callOpenAICompatible } from '@/platform/providers/openaiProvider'
import type { AIMessage, ProviderCallOptions, ProviderFetch } from '@/platform/providers/types'

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1'

const _OPENROUTER_EXTRA_HEADERS = {
  'HTTP-Referer': 'iris-agentics',
  'X-Title': 'IRIS',
}

// Invokes OpenRouter with attribution headers and returns the shared provider response shape.
export async function callOpenRouter(
  messages: readonly AIMessage[],
  apiKey: string,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
) {
  const _apiKey = normalizeApiKey(apiKey)
  if (!_apiKey) throw new Error('OpenRouter API key not configured. Get one at openrouter.ai')

  return callOpenAICompatible(
    messages,
    {
      apiKey: _apiKey,
      model,
      baseUrl: OPENROUTER_API_BASE_URL,
      providerId: 'openrouter',
      providerLabel: 'OpenRouter',
      extraHeaders: _OPENROUTER_EXTRA_HEADERS,
      ...options,
    },
    fetchFn,
  )
}
