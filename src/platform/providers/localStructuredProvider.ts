/**
 * Provider-level structured output enforcement for local models.
 * Explicit response schemas pass through unchanged. Structured controller turns also receive a
 * minimal inferred schema so the agent loop does not depend on prompt-only JSON compliance.
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

const CONTROLLER_ACTION_SCHEMA: ProviderResponseSchema = {
  name: 'controller_action',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['tool', 'final'] },
      tool: { type: 'string' },
      args: { type: 'object', additionalProperties: true },
      message: { type: 'string' },
    },
    required: ['type'],
  },
}

function schemaName(response: ProviderResponseSchema) {
  return String(response.name || 'response').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'response'
}

function messageText(message: AIMessage) {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '')
}

function inferredResponseSchema(messages: readonly AIMessage[], options: ProviderCallOptions) {
  if (options.responseSchema) return options.responseSchema
  if (Array.isArray(options.tools) && options.tools.length) return null

  const controllerTurn = messages.some(
    (message) =>
      message.role === 'system' &&
      /return the controller decision object/i.test(messageText(message)),
  )
  return controllerTurn ? CONTROLLER_ACTION_SCHEMA : null
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
  const response = inferredResponseSchema(messages, options)
  if (!response) return callLocalLLM(messages, baseUrl, model, fetchFn, options)

  const wrappedFetch: ProviderFetch = (url, init = {}, fetchOptions?: ProviderFetchOptions) =>
    fetchFn(url, injectStructuredFormat(url, init, response), fetchOptions)

  const wrappedStream: ProviderStreamFn | undefined = options.streamFn
    ? (url, init, onChunk, streamOptions) =>
        options.streamFn!(url, injectStructuredFormat(url, init, response), onChunk, streamOptions)
    : undefined

  return callLocalLLM(messages, baseUrl, model, wrappedFetch, {
    ...options,
    responseSchema: response,
    streamFn: wrappedStream,
  })
}
