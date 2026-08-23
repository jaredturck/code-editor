/**
 * Defines the provider-neutral request, response, streaming, and registration contracts used
 * by the AI routing layer. Provider adapters keep their wire-format types local while sharing
 * these stable application boundaries.
 */

import type { AIMessageContentPart, JsonSchemaTool, ProviderMeta, ToolCall } from '@/platform/agent/types'
import type { ModelProfileSettings } from '@/platform/modelProfiles'

export type AIProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'opencode' | 'openrouter' | 'local'

export interface AIToolResult {
  id: string
  name: string
  content: unknown
}

export interface AIMessage extends Record<string, unknown> {
  role: string
  content?: string | AIMessageContentPart[] | unknown
  toolCalls?: ToolCall[]
  toolResults?: AIToolResult[]
}

export interface AISettings extends ModelProfileSettings, Record<string, unknown> {
  ai_provider?: string
  ai_api_key?: string
  ai_runtime_api_key?: string
  ai_model?: string
  ai_opencode_url?: string
  ai_local_url?: string
  extended_thinking?: boolean
  thinking_budget_tokens?: number
  reasoning_effort?: string
}

export interface ProviderResponseLike {
  ok: boolean
  status: number
  statusText?: string
  body?: ReadableStream<Uint8Array> | null
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export interface ProviderFetchOptions {
  timeoutMs?: number
  provider?: string
}

export type ProviderFetch = (
  url: string,
  init?: RequestInit,
  options?: ProviderFetchOptions,
) => Promise<ProviderResponseLike>

export interface ProviderStreamResult {
  ok: boolean
  status: number
}

export type ProviderStreamFn = (
  url: string,
  init: RequestInit,
  onChunk: (chunk: string) => void,
  options?: ProviderFetchOptions,
) => Promise<ProviderStreamResult | void>

export type ToolCallStreamEvent =
  | {
      phase: 'start'
      index: number
      id: string
      name: string
    }
  | {
      phase: 'args'
      index: number
      partial: string
      json: string
    }

export interface ProviderCallOptions {
  tools?: readonly JsonSchemaTool[]
  toolChoice?: string | Record<string, unknown>
  onToken?: (token: string) => void
  onThinkingToken?: (token: string) => void
  onToolCall?: (event: ToolCallStreamEvent) => void
  streamFn?: ProviderStreamFn
  settings?: AISettings
  signal?: AbortSignal
  /** Runtime-only classification used by the per-turn cloud safety budget. */
  cloudPurpose?: 'agent' | 'consult' | 'final' | 'retry'
}

export interface ProviderInvokeContext {
  messages: readonly AIMessage[]
  settings: AISettings
  apiKey: string
  model: string
  fetchFn: ProviderFetch
  options: ProviderCallOptions
}

export interface ProviderDiscoveryContext {
  settings: AISettings
  apiKey: string
  fetchFn: ProviderFetch
}

export interface AIProviderDefinition {
  readonly id: AIProviderId
  readonly label: string
  readonly color: string
  readonly keyPlaceholder: string | null
  readonly keyHelpUrl: string | null
  readonly requiresApiKey: boolean
  readonly defaultModel: string
  readonly models: readonly string[]
}

export interface AIProvider extends AIProviderDefinition {
  readonly invoke: (context: ProviderInvokeContext) => Promise<ProviderMeta>
  readonly discoverModels: (context: ProviderDiscoveryContext) => Promise<string[]>
}

export interface OpenAICompatibleOptions extends ProviderCallOptions {
  apiKey: unknown
  model: string
  baseUrl: unknown
  providerId?: string
  providerLabel: string
  extraHeaders?: Record<string, string>
}

export interface OpenAIModelDiscoveryOptions {
  apiKey: unknown
  baseUrl: unknown
  extraHeaders?: Record<string, string>
}

export interface AIConnectionTestResult {
  ok: boolean
  models: string[]
  message: string
}
