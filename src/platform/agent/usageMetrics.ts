/**
 * usageMetrics.js
 * Token-usage accounting + the per-run usage summary. Extracted from
 * agentRuntime.js (W5) as a cohesive, near-self-contained cluster: a usage
 * tracker is created per session, fed one sample per model call (provider-
 * reported tokens when available, chars/4 estimate otherwise), and summarized
 * into the cache-hit / native-adoption / context-fill metrics the run report and
 * the eval harness consume.
 *
 * @typedef {import('./types').Usage} Usage
 */
import { resolveContextWindow } from '@/platform/modelProfiles'

export interface UsageSample {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  estimated?: boolean
}

export interface UsageTracker {
  provider: string
  model: string
  contextWindow: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  lastPromptTokens: number
  requests: number
  estimatedCalls: number
  providerReportedCalls: number
  cacheReadTokens: number
  cacheWriteTokens: number
  nativeSteps: number
  jsonSteps: number
}

interface UsageSampleInput {
  usage?: UsageSample | null
  messages?: Array<Record<string, unknown>>
  text?: unknown
}

/** Rough token estimate (~4 chars/token) for budgeting when no provider usage. */
export function estimateTokens(text: unknown) {
  const input = String(text || '')
  if (!input) return 0
  return Math.max(1, Math.ceil(input.length / 4))
}

// Estimates prompt tokens from messages for policy or budgeting decisions in the agent tool and
// policy layer.
export function estimatePromptTokensFromMessages(messages: unknown) {
  const combined = Array.isArray(messages)
    ? messages.map((message) => `${message?.role || 'user'}: ${String(message?.content || '')}`).join('\n')
    : ''
  return estimateTokens(combined)
}

/** Fresh per-session usage tracker. */
export function createUsageTracker(settings: Record<string, unknown>): UsageTracker {
  return {
    provider: String(settings?.ai_provider || 'unknown'),
    model: String(settings?.ai_model || ''),
    contextWindow: resolveContextWindow(settings),
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    // Most recent call's measured input tokens — the truest proxy for current
    // context fill, used to drive the auto-compaction trigger.
    lastPromptTokens: 0,
    requests: 0,
    estimatedCalls: 0,
    providerReportedCalls: 0,
    // Prompt-cache accounting — measures the P1 caching win.
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    // Controller-protocol adoption — native tool-calling vs JSON-in-text fallback.
    nativeSteps: 0,
    jsonSteps: 0,
  }
}

/** Fold one model call's usage into the tracker (provider-reported, else estimated). */
export function trackUsageSample(
  tracker: UsageTracker | null | undefined,
  { usage, messages, text }: UsageSampleInput,
) {
  if (!tracker) return

  tracker.requests += 1

  const providerPromptTokens =
    Number.isFinite(Number(usage?.promptTokens)) && Number(usage?.promptTokens) > 0 ? Number(usage!.promptTokens) : 0
  const providerCompletionTokens =
    Number.isFinite(Number(usage?.completionTokens)) && Number(usage?.completionTokens) > 0
      ? Number(usage!.completionTokens)
      : 0
  const providerTotalTokens =
    Number.isFinite(Number(usage?.totalTokens)) && Number(usage?.totalTokens) > 0 ? Number(usage!.totalTokens) : 0

  const hasProviderUsage = providerPromptTokens > 0 || providerCompletionTokens > 0 || providerTotalTokens > 0
  if (hasProviderUsage) {
    tracker.providerReportedCalls += 1
  }

  let promptTokens = providerPromptTokens
  let completionTokens = providerCompletionTokens
  let totalTokens = providerTotalTokens
  let usedEstimate = usage?.estimated === true

  if (!hasProviderUsage) {
    promptTokens = estimatePromptTokensFromMessages(messages)
    completionTokens = estimateTokens(String(text || ''))
    totalTokens = promptTokens + completionTokens
    usedEstimate = true
  } else {
    if (!totalTokens) {
      totalTokens = providerPromptTokens + providerCompletionTokens
    }

    if (!promptTokens && completionTokens && totalTokens > completionTokens) {
      promptTokens = totalTokens - completionTokens
    }

    if (!completionTokens && promptTokens && totalTokens > promptTokens) {
      completionTokens = totalTokens - promptTokens
    }

    if (!promptTokens && !completionTokens && totalTokens > 0) {
      const estimatedPrompt = Math.max(0, Math.min(totalTokens, estimatePromptTokensFromMessages(messages)))
      promptTokens = estimatedPrompt
      completionTokens = Math.max(0, totalTokens - promptTokens)
      usedEstimate = true
    }

    if (!promptTokens) {
      const estimatedPrompt = estimatePromptTokensFromMessages(messages)
      promptTokens = totalTokens > 0 ? Math.max(0, Math.min(totalTokens, estimatedPrompt)) : estimatedPrompt
      usedEstimate = true
    }

    if (!completionTokens) {
      completionTokens = totalTokens > promptTokens ? totalTokens - promptTokens : estimateTokens(String(text || ''))
      usedEstimate = true
    }

    if (totalTokens > 0 && promptTokens + completionTokens > totalTokens) {
      completionTokens = Math.max(0, totalTokens - promptTokens)
    }

    if (!totalTokens) {
      totalTokens = promptTokens + completionTokens
      usedEstimate = true
    }
  }

  tracker.promptTokens += promptTokens
  tracker.completionTokens += completionTokens
  tracker.totalTokens += totalTokens
  tracker.lastPromptTokens = promptTokens
  tracker.cacheReadTokens += Math.max(0, Number(usage?.cacheReadTokens || 0))
  tracker.cacheWriteTokens += Math.max(0, Number(usage?.cacheWriteTokens || 0))

  if (usedEstimate) {
    tracker.estimatedCalls += 1
  }
}

/** Summarize a tracker into the run/eval report metrics (cache-hit, adoption, fill). */
export function buildUsageSummary(tracker: UsageTracker | null | undefined) {
  if (!tracker) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      contextWindow: 0,
      contextRemaining: 0,
      contextUsedPct: 0,
      estimatedCalls: 0,
      providerReportedCalls: 0,
      estimatedOnly: true,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitRatio: 0,
      nativeSteps: 0,
      jsonSteps: 0,
      nativeToolAdoption: 0,
    }
  }

  const contextWindow = Number(tracker.contextWindow || 0)
  const cacheReadTokens = Math.max(0, Number(tracker.cacheReadTokens || 0))
  const cacheWriteTokens = Math.max(0, Number(tracker.cacheWriteTokens || 0))
  const promptInputTotal = Math.max(0, Number(tracker.promptTokens || 0)) + cacheReadTokens
  // Fraction of input tokens served from the prompt cache (0–1).
  const cacheHitRatio = promptInputTotal > 0 ? Math.round((cacheReadTokens / promptInputTotal) * 1000) / 1000 : 0
  const nativeSteps = Math.max(0, Number(tracker.nativeSteps || 0))
  const jsonSteps = Math.max(0, Number(tracker.jsonSteps || 0))
  // Fraction of controller steps that used native tool-calling vs JSON fallback.
  const nativeToolAdoption =
    nativeSteps + jsonSteps > 0 ? Math.round((nativeSteps / (nativeSteps + jsonSteps)) * 1000) / 1000 : 0
  const totalTokens = Math.max(0, Number(tracker.totalTokens || 0))
  const contextRemaining = contextWindow > 0 ? Math.max(0, contextWindow - totalTokens) : 0
  const contextUsedPct = contextWindow > 0 ? Math.min(100, Math.round((totalTokens / contextWindow) * 1000) / 10) : 0

  return {
    provider: tracker.provider,
    model: tracker.model,
    promptTokens: Math.max(0, Number(tracker.promptTokens || 0)),
    completionTokens: Math.max(0, Number(tracker.completionTokens || 0)),
    totalTokens,
    requests: Math.max(0, Number(tracker.requests || 0)),
    contextWindow,
    contextRemaining,
    contextUsedPct,
    estimatedCalls: Math.max(0, Number(tracker.estimatedCalls || 0)),
    providerReportedCalls: Math.max(0, Number(tracker.providerReportedCalls || 0)),
    estimatedOnly: Number(tracker.estimatedCalls || 0) >= Number(tracker.requests || 0),
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitRatio,
    nativeSteps,
    jsonSteps,
    nativeToolAdoption,
  }
}
