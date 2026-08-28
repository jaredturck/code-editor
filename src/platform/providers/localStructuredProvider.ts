/** Explicit JSON-schema support for local non-tool tasks such as initialization/evaluation. */
import { callLocalLLM } from '@/platform/providers/localProvider'
import type { AIMessage, ProviderCallOptions, ProviderFetch, ProviderFetchOptions } from '@/platform/providers/types'

function injectSchema(init: RequestInit, options: ProviderCallOptions): RequestInit {
  if (!options.responseSchema || typeof init.body !== 'string') return init
  let body: Record<string, unknown>
  try {
    body = JSON.parse(init.body)
  } catch {
    return init
  }
  const response = options.responseSchema
  body.response_format = {
    type: 'json_schema',
    json_schema: {
      name: String(response.name || 'response')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64),
      strict: response.strict !== false,
      schema: response.schema,
    },
  }
  return { ...init, body: JSON.stringify(body) }
}

export async function callStructuredLocalLLM(
  messages: readonly AIMessage[],
  baseUrl: string,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
) {
  if (!options.responseSchema) return callLocalLLM(messages, baseUrl, model, fetchFn, options)
  const wrappedFetch: ProviderFetch = (url, init = {}, fetchOptions?: ProviderFetchOptions) =>
    fetchFn(url, injectSchema(init, options), fetchOptions)
  return callLocalLLM(messages, baseUrl, model, wrappedFetch, options)
}
