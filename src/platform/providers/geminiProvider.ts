/**
 * geminiProvider.ts
 * Google Gemini API adapter.
 * Converts image_url data-URL parts to Gemini's inlineData format.
 */

import {
  normalizeApiKey,
  normalizeContentToArray,
  parseBase64DataUrl,
  normalizeUsage,
  safeNumber,
  toMetaResponse,
  contentToText,
} from '@/platform/providers/providerUtils'
import { resolveMaxOutputTokens } from '@/platform/modelProfiles'
import { toGeminiTools, encodeToolName, decodeToolName } from '@/platform/agent/toolSchema'
import type { ProviderMeta } from '@/platform/agent/types'
import type { AIMessage, ProviderCallOptions, ProviderFetch } from '@/platform/providers/types'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiFunctionCall {
  name?: string
  args?: Record<string, unknown>
}

interface GeminiResponsePart {
  text?: string
  functionCall?: GeminiFunctionCall
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiResponsePart[] }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: unknown
    candidatesTokenCount?: unknown
    totalTokenCount?: unknown
  }
}

interface GeminiErrorResponse {
  error?: { message?: string }
}

interface GeminiModelListResponse {
  models?: Array<{
    name?: string
    supportedGenerationMethods?: string[]
  }>
}

interface GeminiRequestBody {
  contents: Array<Record<string, unknown>>
  generationConfig: { maxOutputTokens: number }
  system_instruction?: { parts: Array<{ text: string }> }
  tools?: ReturnType<typeof toGeminiTools>
}

/** Converts canonical IRIS turns into Gemini content and function-call parts. */
export function normalizeGeminiContents(messages: readonly AIMessage[]): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message): Record<string, unknown> => {
      if (message.role === 'tool' && Array.isArray(message.toolResults)) {
        return {
          role: 'user',
          parts: message.toolResults.map((result) => ({
            functionResponse: {
              name: encodeToolName(result.name),
              response: { result: String(result.content ?? '') },
            },
          })),
        }
      }
      if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
        const parts: Array<Record<string, unknown>> = []
        const text = typeof message.content === 'string' ? message.content : contentToText(message.content)
        if (text) parts.push({ text })
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              name: encodeToolName(toolCall.name),
              args: toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {},
            },
          })
        }
        return { role: 'model', parts }
      }

      const role = message.role === 'assistant' ? 'model' : 'user'
      const parts = normalizeContentToArray(message.content).map((part) => {
        if (part.type === 'text') return { text: part.text }
        const imageUrl =
          part.type === 'image_url' &&
          part.image_url &&
          typeof part.image_url === 'object' &&
          typeof part.image_url.url === 'string'
            ? part.image_url.url
            : ''
        if (imageUrl) {
          const parsed = parseBase64DataUrl(imageUrl)
          if (parsed)
            return {
              inlineData: { mimeType: parsed.mimeType, data: parsed.data },
            }
          return { text: `[Image: ${imageUrl}]` }
        }
        return { text: String(part.text || '') }
      })
      return { role, parts }
    })
}

/** Builds the Gemini generation request with system guidance and optional native tools. */
export function buildGeminiRequestBody(
  messages: readonly AIMessage[],
  model: string,
  options: ProviderCallOptions,
): GeminiRequestBody {
  const systemMessage = messages.find((message) => message.role === 'system')
  const systemText = systemMessage ? contentToText(systemMessage.content) : ''
  const body: GeminiRequestBody = {
    contents: normalizeGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: resolveMaxOutputTokens(model, 'gemini', options.settings),
    },
  }
  if (systemText) body.system_instruction = { parts: [{ text: systemText }] }
  if (Array.isArray(options.tools) && options.tools.length) {
    body.tools = toGeminiTools(options.tools)
  }
  return body
}

/** Converts a Gemini candidate response into IRIS's provider-neutral metadata. */
export function parseGeminiResponse(data: GeminiResponse, model: string): ProviderMeta {
  const parts = data?.candidates?.[0]?.content?.parts || []
  const finishReason = String(data?.candidates?.[0]?.finishReason || '')
  const truncated = finishReason === 'MAX_TOKENS'
  const text = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text || '')
    .join('')
  const toolCalls = parts
    .filter((part) => Boolean(part?.functionCall?.name))
    .map((part, index) => {
      const args = part.functionCall?.args
      const hasArgs = Boolean(args && typeof args === 'object')
      return {
        id: `gemini-${index}`,
        name: decodeToolName(part.functionCall?.name),
        args: hasArgs ? (args as Record<string, unknown>) : {},
        argsError: truncated && (!hasArgs || Object.keys(args || {}).length === 0),
      }
    })
  const usage = normalizeUsage(undefined, {
    promptTokens: safeNumber(data?.usageMetadata?.promptTokenCount),
    completionTokens: safeNumber(data?.usageMetadata?.candidatesTokenCount),
    totalTokens: safeNumber(data?.usageMetadata?.totalTokenCount),
  })

  return toMetaResponse({
    provider: 'Gemini',
    model,
    text,
    usage,
    toolCalls,
    stopReason: data?.candidates?.[0]?.finishReason || '',
  })
}

/**
 * Translates IRIS messages and tools into Gemini content parts, sends the request, and
 * normalizes candidate text, function calls, reasoning metadata, and token usage.
 * Provider-specific safety or response fields remain contained in this adapter.
 */

export async function callGemini(
  messages: readonly AIMessage[],
  apiKey: unknown,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
) {
  const _apiKey = normalizeApiKey(apiKey)
  if (!_apiKey) throw new Error('Gemini API key not configured.')
  const _body = buildGeminiRequestBody(messages, model, options)

  const _res = await fetchFn(`${GEMINI_API_BASE}/${model}:generateContent?key=${_apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(_body),
  })

  if (!_res.ok) {
    const _err = (await _res.json().catch(() => ({}))) as GeminiErrorResponse
    throw new Error(_err?.error?.message || `Gemini error: ${_res.status}`)
  }

  const _data = (await _res.json()) as GeminiResponse
  return parseGeminiResponse(_data, model)
}

/**
 * List Gemini models the given key can access that support generateContent.
 * Returns [] on missing key or failure.
 */
export async function listGeminiModels(apiKey: unknown, fetchFn: ProviderFetch): Promise<string[]> {
  const _apiKey = normalizeApiKey(apiKey)
  if (!_apiKey) return []

  const _res = await fetchFn(`${GEMINI_API_BASE}?key=${_apiKey}&pageSize=1000`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!_res.ok) return []

  const _data = (await _res.json().catch(() => ({}))) as GeminiModelListResponse
  const _raw = Array.isArray(_data?.models) ? _data.models : []
  return _raw
    .filter(
      (entry) =>
        !Array.isArray(entry?.supportedGenerationMethods) ||
        entry.supportedGenerationMethods.includes('generateContent'),
    )
    .map((entry) => String(entry?.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
