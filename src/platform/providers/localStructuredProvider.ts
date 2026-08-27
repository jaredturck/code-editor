/**
 * Adds provider-level structured output enforcement around the stable local-model adapter.
 * Keeping this wire-format concern in a small wrapper avoids coupling the main adapter to
 * every structured-response experiment used by the agent runtime.
 */

import { callLocalLLM } from '@/platform/providers/localProvider'
import type {
  AIMessage,
  ProviderCallOptions,
  ProviderFetch,
  ProviderFetchOptions,
  ProviderResponseSchema,
  ProviderStreamFn,
} from '@/platform/providers/types'

function schemaName(response: ProviderResponseSchema) {
  return String(response.name || 'response').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'response'
}

function injectStructuredFormat(url: string, init: RequestInit, response: ProviderResponseSchema): RequestInit {
  if (typeof init.body !== 'string') return init

  let body: Record<string, unknown>
  try {
    body = JSON.parse(init.body) as Record<string, unknown>
  } catch {
    return init
  }

  if (url.endsWith('/api/chat')) {
    body.format = response.schema
  } else if (url.includes('/v1/chat/completions')) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: schemaName(response),
        strict: response.strict !== false,
        schema: response.schema,
      },
    }
  } else {
    return init
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
  const response = options.responseSchema
  if (!response) return callLocalLLM(messages, baseUrl, model, fetchFn, options)

  const wrappedFetch: ProviderFetch = (url, init = {}, fetchOptions?: ProviderFetchOptions) =>
    fetchFn(url, injectStructuredFormat(url, init, response), fetchOptions)

  const wrappedStream: ProviderStreamFn | undefined = options.streamFn
    ? (url, init, onChunk, streamOptions) =>
        options.streamFn!(url, injectStructuredFormat(url, init, response), onChunk, streamOptions)
    : undefined

  return callLocalLLM(messages, baseUrl, model, wrappedFetch, {
    ...options,
    streamFn: wrappedStream,
  })
}
