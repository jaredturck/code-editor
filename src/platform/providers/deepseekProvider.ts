/**
 * DeepSeek's API is OpenAI-compatible, but remains a first-class IRIS provider so
 * credential testing, model discovery, routing, and proxy security stay explicit.
 */

import { callOpenAICompatible, listOpenAICompatibleModels } from '@/platform/providers/openaiProvider'
import type { AIMessage, ProviderCallOptions, ProviderFetch } from '@/platform/providers/types'
import type { ProviderMeta } from '@/platform/agent/types'

export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com/v1'

export async function callDeepSeek(
  messages: readonly AIMessage[],
  apiKey: unknown,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  return callOpenAICompatible(
    messages,
    {
      apiKey,
      model,
      baseUrl: DEEPSEEK_API_BASE_URL,
      providerId: 'deepseek',
      providerLabel: 'DeepSeek',
      ...options,
    },
    fetchFn,
  )
}

export async function listDeepSeekModels(apiKey: unknown, fetchFn: ProviderFetch): Promise<string[]> {
  return listOpenAICompatibleModels(
    {
      apiKey,
      baseUrl: DEEPSEEK_API_BASE_URL,
    },
    fetchFn,
  )
}
