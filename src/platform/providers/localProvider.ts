/**
 * localProvider.js
 * Local LLM adapter — Ollama (/api/chat) with fallback to LM Studio (/v1/chat/completions).
 * Multimodal requests are preserved for vision-capable Ollama and LM Studio models.
 */

import {
  contentToText,
  normalizeUsage,
  parseToolArguments,
  safeNumber,
  toMetaResponse,
} from '@/platform/providers/providerUtils'
import { normalizeOpenAIMessages, parseOpenAIChatResponse } from '@/platform/providers/openaiProvider'
import { decodeToolName, encodeToolName, toOpenAITools } from '@/platform/agent/toolSchema'
import type { AIMessage, ProviderCallOptions, ProviderFetch, ProviderStreamFn } from '@/platform/providers/types'
import type { ProviderGenerationTimings, ToolCall } from '@/platform/agent/types'

/**
 * Sends a provider-neutral request to the configured local model server and normalizes its
 * completion into the same result shape used by hosted providers. Endpoint differences
 * remain here so the agent loop does not need a separate local execution path.
 */

interface LocalStreamResult {
  text: string
  thinking: string
  usage: ReturnType<typeof normalizeUsage>
  emitted: boolean
  timings: ProviderGenerationTimings
}

function localStreamError(message: string, partial = false): Error & { partial?: boolean } {
  const error = new Error(message) as Error & { partial?: boolean }
  if (partial) error.partial = true
  return error
}

function emitLocalToken(options: ProviderCallOptions, token: unknown): string {
  const text = String(token || '')
  if (text) options.onToken?.(text)
  return text
}

function emitLocalThinkingToken(options: ProviderCallOptions, token: unknown): string {
  const text = String(token || '')
  if (text) options.onThinkingToken?.(text)
  return text
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = Number(value)
  if (!Number.isFinite(nanoseconds) || nanoseconds < 0) return undefined
  return nanoseconds / 1_000_000
}

function elapsedMilliseconds(startedAt: number, timestamp: number | null): number | undefined {
  if (timestamp === null) return undefined
  return Math.max(0, timestamp - startedAt)
}

function streamPhaseMilliseconds(startedAt: number | null, completedAt: number | null): number | undefined {
  if (startedAt === null || completedAt === null) return undefined
  return Math.max(0, completedAt - startedAt)
}

function buildLocalStreamTimings(
  startedAt: number,
  completedAt: number,
  firstResponseAt: number | null,
  firstThinkingAt: number | null,
  lastThinkingAt: number | null,
  firstAnswerAt: number | null,
  finalData: Record<string, unknown> | null = null,
): ProviderGenerationTimings {
  const thinkingCompletedAt =
    firstAnswerAt === null
      ? lastThinkingAt
      : lastThinkingAt === null
        ? firstAnswerAt
        : Math.max(firstAnswerAt, lastThinkingAt)
  return {
    totalMs: nanosecondsToMilliseconds(finalData?.total_duration) ?? Math.max(0, completedAt - startedAt),
    loadMs: nanosecondsToMilliseconds(finalData?.load_duration),
    promptEvalMs: nanosecondsToMilliseconds(finalData?.prompt_eval_duration),
    generationMs: nanosecondsToMilliseconds(finalData?.eval_duration),
    firstResponseMs: elapsedMilliseconds(startedAt, firstResponseAt),
    firstThinkingMs: elapsedMilliseconds(startedAt, firstThinkingAt),
    firstAnswerMs: elapsedMilliseconds(startedAt, firstAnswerAt),
    thinkingStreamMs: streamPhaseMilliseconds(firstThinkingAt, thinkingCompletedAt),
    answerStreamMs: streamPhaseMilliseconds(firstAnswerAt, completedAt),
  }
}

function buildOllamaTimings(data: Record<string, unknown>): ProviderGenerationTimings {
  return {
    totalMs: nanosecondsToMilliseconds(data.total_duration),
    loadMs: nanosecondsToMilliseconds(data.load_duration),
    promptEvalMs: nanosecondsToMilliseconds(data.prompt_eval_duration),
    generationMs: nanosecondsToMilliseconds(data.eval_duration),
  }
}

function normalizeOllamaToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((toolCall) => Boolean(toolCall?.function?.name))
    .map((toolCall, index) => {
      const rawArguments = toolCall?.function?.arguments
      const parsed =
        rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
          ? { args: rawArguments as Record<string, unknown>, argsError: false }
          : parseToolArguments(rawArguments)
      return {
        id: String(toolCall?.id || `ollama-tool-${index + 1}`),
        name: decodeToolName(toolCall?.function?.name),
        args: parsed.args,
        argsError: parsed.argsError,
        rawArgs: parsed.rawArgs,
      }
    })
}

function localResponseFormat(options: ProviderCallOptions) {
  const response = options.responseSchema
  if (!response?.schema || typeof response.schema !== 'object' || Array.isArray(response.schema)) return null
  return {
    ollama: response.schema,
    openai: {
      type: 'json_schema',
      json_schema: {
        name: String(response.name || 'response').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'response',
        strict: response.strict !== false,
        schema: response.schema,
      },
    },
  }
}

async function streamOllamaCompletion(
  url: string,
  model: string,
  messages: unknown[],
  streamFn: ProviderStreamFn,
  options: ProviderCallOptions,
): Promise<LocalStreamResult> {
  let buffer = ''
  let text = ''
  let thinking = ''
  let usage = normalizeUsage(null)
  let emitted = false
  let finalData: Record<string, unknown> | null = null
  const startedAt = Date.now()
  let firstResponseAt: number | null = null
  let firstThinkingAt: number | null = null
  let lastThinkingAt: number | null = null
  let firstAnswerAt: number | null = null

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const data = JSON.parse(trimmed)
    if (data?.error) throw localStreamError(String(data.error), emitted)
    const thinkingDelta = emitLocalThinkingToken(options, data?.message?.thinking ?? data?.message?.reasoning_content)
    if (thinkingDelta) {
      const now = Date.now()
      if (firstThinkingAt === null) firstThinkingAt = now
      lastThinkingAt = now
      emitted = true
      thinking += thinkingDelta
    }
    const delta = emitLocalToken(options, data?.message?.content)
    if (delta) {
      if (firstAnswerAt === null) firstAnswerAt = Date.now()
      emitted = true
      text += delta
    }
    if (data?.done) {
      finalData = data
      usage = normalizeUsage(data?.usage, {
        promptTokens: safeNumber(data?.prompt_eval_count),
        completionTokens: safeNumber(data?.eval_count),
      })
    }
  }

  const requestBody: Record<string, unknown> = { model, messages, stream: true }
  const responseFormat = localResponseFormat(options)
  if (responseFormat) requestBody.format = responseFormat.ollama

  const streamResult = await streamFn(
    `${url}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    },
    (chunk) => {
      if (firstResponseAt === null) firstResponseAt = Date.now()
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    },
    { provider: 'local' },
  )
  if (buffer.trim()) consumeLine(buffer)
  if (streamResult && streamResult.ok === false) {
    throw localStreamError(`Ollama streaming request failed (${streamResult.status})`, emitted)
  }
  if (!text) throw localStreamError('Ollama returned no streamed text.', emitted)
  const completedAt = Date.now()
  return {
    text,
    thinking,
    usage,
    emitted,
    timings: buildLocalStreamTimings(
      startedAt,
      completedAt,
      firstResponseAt,
      firstThinkingAt,
      lastThinkingAt,
      firstAnswerAt,
      finalData,
    ),
  }
}

async function streamOpenAICompatibleCompletion(
  url: string,
  model: string,
  messages: unknown[],
  streamFn: ProviderStreamFn,
  options: ProviderCallOptions,
): Promise<LocalStreamResult> {
  let buffer = ''
  let text = ''
  let thinking = ''
  let usage = normalizeUsage(null)
  let emitted = false
  const startedAt = Date.now()
  let firstResponseAt: number | null = null
  let firstThinkingAt: number | null = null
  let lastThinkingAt: number | null = null
  let firstAnswerAt: number | null = null

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    const data = JSON.parse(payload)
    if (data?.error) {
      throw localStreamError(String(data.error?.message || data.error || 'Local stream failed'), emitted)
    }
    const reasoning =
      data?.choices?.[0]?.delta?.reasoning_content ??
      data?.choices?.[0]?.delta?.reasoning ??
      data?.choices?.[0]?.delta?.thinking
    const thinkingDelta = emitLocalThinkingToken(options, reasoning)
    if (thinkingDelta) {
      const now = Date.now()
      if (firstThinkingAt === null) firstThinkingAt = now
      lastThinkingAt = now
      emitted = true
      thinking += thinkingDelta
    }
    const delta = emitLocalToken(options, data?.choices?.[0]?.delta?.content)
    if (delta) {
      if (firstAnswerAt === null) firstAnswerAt = Date.now()
      emitted = true
      text += delta
    }
   if (data?.usage) usage = normalizeUsage(data.usage)
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages,
   stream: true,
    stream_options: { include_usage: true },
  }
  const responseFormat = localResponseFormat(options)
  if (responseFormat) requestBody.response_format = responseFormat.openai

  const streamResult = await streamFn(
    `${url}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    },
    (chunk) => {
      if (firstResponseAt === null) firstResponseAt = Date.now()
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    },
    { provider: 'local' },
  )
  if (buffer.trim()) consumeLine(buffer)
  if (streamResult && streamResult.ok === false) {
    throw localStreamError(`LM Studio streaming request failed (${streamResult.status})`, emitted)
  }
  if (!text) throw localStreamError('LM Studio returned no streamed text.', emitted)
  const completedAt = Date.now()
  return {
    text,
    thinking,
    usage,
    emitted,
    timings: buildLocalStreamTimings(
      startedAt,
      completedAt,
      firstResponseAt,
      firstThinkingAt,
      lastThinkingAt,
      firstAnswerAt,
     ),
  }
}

export async function callLocalLLM (
  messages: readonly AIMessage[],
  baseUrl: string,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
{
  if (!baseUrl) throw new Error('Local server URL not configured.')
  const _url = baseUrl.replace(/\/$/, '').replace(/(^https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')

  const toDataUrl = (part: any): string => {
    const image = part?.image_url
    if (typeof image === 'string') return image
    if (image && typeof image.url === 'string') return image.url
    if (part?.inline_data?.data) {
      return `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`
    }
    return ''
  }

  const toOllamaMessages = (message: AIMessage): Array<Record<string, unknown>> => {
    if (message.role === 'tool' && Array.isArray(message.toolResults)) {
      return message.toolResults.map((result) => ({
        role: 'tool',
        content: String(result.content ?? ''),
        tool_name: encodeToolName(result.name),
        ...(result.id ? { tool_call_id: result.id } : {}),
      }))
    }

    const content = Array.isArray(message.content) ? contentToText(message.content) : String(message.content || '')
    const images = Array.isArray(message.content)
      ? message.content
          .map((Part: any) => toDataUrl(part))
          .filter((url: string) => /^data:image\/[^;]+;