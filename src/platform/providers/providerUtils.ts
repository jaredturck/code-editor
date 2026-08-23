/**
 * Provides the shared conversions used by AI provider adapters, including tool arguments,
 * data URLs, endpoints, API keys, usage, and response metadata. Centralizing these edge
 * cases keeps each provider focused on its own wire format.
 */

import type {
  AIMessageContentPart,
  ProviderGenerationTimings,
  ProviderMeta,
  ToolCall,
  Usage,
} from '@/platform/agent/types'

type UsageInput = Partial<Usage> & {
  prompt_tokens?: unknown
  input_tokens?: unknown
  completion_tokens?: unknown
  output_tokens?: unknown
  total_tokens?: unknown
  cache_read_input_tokens?: unknown
  cached_tokens?: unknown
  cache_creation_input_tokens?: unknown
}

export interface MetaResponseInput {
  provider: unknown
  model: unknown
  text: unknown
  usage?: Usage | null
  toolCalls?: ToolCall[] | null
  stopReason?: unknown
  thinkingText?: unknown
  timings?: ProviderGenerationTimings
}

export interface SSELineReader {
  push(chunk: unknown): string[]
}

export interface ParsedToolArguments {
  args: Record<string, unknown>
  argsError: boolean
  rawArgs?: string
}

export interface ParsedBase64DataUrl {
  mimeType: string
  data: string
}

// Interprets tool arguments and turns the source representation into structured application data.
export function parseToolArguments(rawJson: unknown): ParsedToolArguments {
  const raw = typeof rawJson === 'string' ? rawJson : ''
  if (!raw) return { args: {}, argsError: false }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown>, argsError: false }
    }
    return { args: {}, argsError: true, rawArgs: raw }
  } catch {
    return { args: {}, argsError: true, rawArgs: raw }
  }
}

// Interprets base64 data URL and turns the source representation into structured application data.
export function parseBase64DataUrl(value: unknown): ParsedBase64DataUrl | null {
  const match = String(value || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], data: match[2] }
}

/**
 * Accepts a host, API root, or full OpenAI-compatible endpoint and reduces it to the stable
 * versioned base URL used by discovery and completion calls. It removes resource-specific
 * suffixes while preserving valid HTTP or HTTPS hosts.
 */

export function normalizeOpenAICompatibleBaseUrl(baseUrl: unknown): string {
  let raw = String(baseUrl || '').trim()
  if (!raw) return ''

  raw = raw.replace(/^['\"]+|['\"]+$/g, '')
  if (!raw) return ''

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    raw = `https://${raw.replace(/^\/+/, '')}`
  }

  if (!/^https?:\/\//i.test(raw)) return ''

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    let path = String(parsed.pathname || '').replace(/\/+$/, '')

    path = path.replace(/\/(chat\/completions|responses|models)$/i, '')
    path = path.replace(/\/v\d+\/(chat\/completions|responses|models)$/i, (segment: string) => {
      const versionMatch = segment.match(/\/v\d+/i)
      return versionMatch ? versionMatch[0] : ''
    })

    if (!/\/v\d+$/i.test(path)) path = `${path}/v1`

    parsed.pathname = path.replace(/\/+/g, '/')
    parsed.search = ''
    parsed.hash = ''

    return parsed.toString().replace(/\/+$/, '')
  } catch {
    const trimmed = raw.replace(/\/+$/, '')
    if (!trimmed) return ''
    if (/\/v\d+$/i.test(trimmed)) return trimmed
    return `${trimmed}/v1`
  }
}

// Converts api key into the canonical representation expected by later code.
export function normalizeApiKey(apiKey: unknown): string {
  const trimmed = String(apiKey || '')
    .trim()
    .replace(/^['\"]+|['\"]+$/g, '')
  if (!trimmed) return ''
  return trimmed.replace(/^Bearer\s+/i, '').trim()
}

// Normalizes number to a safe fallback when provider data is missing or malformed.
export function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

/**
 * Combines the different token-field names returned by supported providers into IRIS's
 * prompt, completion, total, and cache usage record. Empty accounting data returns null so
 * callers can distinguish unavailable metrics from a genuine zero-token response.
 */

export function normalizeUsage(rawUsage: UsageInput | null | undefined, fallback: UsageInput = {}): Usage | null {
  const promptTokens = safeNumber(
    rawUsage?.promptTokens ?? rawUsage?.prompt_tokens ?? rawUsage?.input_tokens ?? fallback.promptTokens,
  )
  const completionTokens = safeNumber(
    rawUsage?.completionTokens ?? rawUsage?.completion_tokens ?? rawUsage?.output_tokens ?? fallback.completionTokens,
  )
  const totalTokens = safeNumber(
    rawUsage?.totalTokens ?? rawUsage?.total_tokens ?? fallback.totalTokens ?? promptTokens + completionTokens,
  )
  const estimated = rawUsage?.estimated === true
  const cacheReadTokens = safeNumber(
    rawUsage?.cacheReadTokens ?? rawUsage?.cache_read_input_tokens ?? rawUsage?.cached_tokens,
  )
  const cacheWriteTokens = safeNumber(rawUsage?.cacheWriteTokens ?? rawUsage?.cache_creation_input_tokens)

  if (!promptTokens && !completionTokens && !totalTokens) return null

  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || promptTokens + completionTokens,
    estimated,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

// Converts content to array into the canonical representation expected by later code.
export function normalizeContentToArray(content: unknown): AIMessageContentPart[] {
  if (Array.isArray(content)) return content as AIMessageContentPart[]
  return [{ type: 'text', text: String(content ?? '') }]
}

// Flattens provider content blocks into the text consumed by the renderer.
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as AIMessageContentPart[])
      .filter((part) => part?.type === 'text')
      .map((part) => String(part.text || ''))
      .join('\n')
  }
  return String(content ?? '')
}

// Normalizes provider output into the shared response and usage metadata shape.
export function toMetaResponse({
  provider,
  model,
  text,
  usage,
  toolCalls,
  stopReason,
  thinkingText,
  timings,
}: MetaResponseInput): ProviderMeta {
  return {
    provider: String(provider || 'unknown'),
    model: String(model || ''),
    text: String(text || ''),
    usage: usage || null,
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    stopReason: stopReason ? String(stopReason) : '',
    thinkingText: thinkingText ? String(thinkingText) : '',
    ...(timings ? { timings } : {}),
  }
}

// Creates sseline reader with the state and dependencies needed by its consumers.
export function createSSELineReader(): SSELineReader {
  let buffer = ''
  return {
    // Appends one normalized item while preserving the bounds owned by provider utils.
    push(chunk: unknown): string[] {
      buffer += String(chunk || '')
      const payloads: string[] = []
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        const match = line.match(/^data:\s?(.*)$/)
        if (match) payloads.push(match[1])
      }
      return payloads
    },
  }
}

// Returns error message without requiring callers to know where or how it is stored.
export function getErrorMessage(err: unknown, fallbackMessage: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallbackMessage
}
