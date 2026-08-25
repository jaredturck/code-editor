/**
 * Controls step, timeout, and extension behavior for long-running agent sessions. It turns
 * limit conditions into user-facing choices rather than silently abandoning productive
 * work.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.

import { DEFAULT_TOOL_TIMEOUT_MS, getToolTimeoutMs as getCatalogToolTimeoutMs } from '@/platform/agent/toolCatalog'

import * as config from '@/platform/agent/runtime/config'
import * as continuity from '@/platform/agent/runtime/continuity'
import * as todoTrace from '@/platform/agent/runtime/todoTrace'
import * as capabilityPolicy from '@/platform/agent/runtime/capabilityPolicy'
import * as webSearchPolicy from '@/platform/agent/runtime/webSearchPolicy'
const {
  SESSION_STEP_BUDGET_EXTEND_INCREMENT,
  DOCUMENTS_ALIAS_TOKENS,
  normalizePathToken,
  isLikelyRelativePath,
  dedupeStrings,
} = Object.assign({}, config, continuity, todoTrace, capabilityPolicy, webSearchPolicy)

interface ApprovalResponseRecord {
  decision?: unknown
  choice?: unknown
  selection?: unknown
  action?: unknown
  approved?: unknown
}

interface LimitIssueInput {
  toolName?: unknown
  message?: unknown
}

interface FindFallbackOptions {
  includeGlobalFallback?: boolean
}

/**
 * Maps the different labels an approval UI or model may return onto the small set of limit
 * decisions understood by the runtime. This keeps continue, extend, unlimited, and deny
 * behavior consistent across approval sources.
 */

export function normalizeApprovalDecisionToken(value: unknown): string {
  const token = String(value || '')
    .trim()
    .toLowerCase()
  if (!token) return ''

  if (['approve', 'approved', 'allow', 'grant', 'yes', 'ok', 'proceed'].includes(token)) return 'approve'
  if (['continue', 'continue_once', 'continue-once', 'once', 'retry'].includes(token)) return 'continue'
  if (['extend', 'extend_budget', 'extend-budget', 'increase_budget', 'more_budget'].includes(token)) return 'extend'
  if (['unlimited', 'unlimited_session', 'unlimited-for-session', 'no_limits', 'disable_limits'].includes(token))
    return 'unlimited'
  if (['deny', 'denied', 'disapprove', 'reject', 'stop', 'no'].includes(token)) return 'deny'

  return token
}

/**
 * Converts a raw limit-approval response into the runtime's decision plus optional budget
 * changes. Missing or malformed responses fail closed so a timed-out approval cannot
 * silently grant more work.
 */

export function normalizeApprovalResponse(rawResponse: unknown): { approved: boolean; decision: string } {
  if (rawResponse && typeof rawResponse === 'object') {
    const response = rawResponse as ApprovalResponseRecord
    const decision = normalizeApprovalDecisionToken(
      response.decision || response.choice || response.selection || response.action,
    )

    const approved = response.approved === true || ['approve', 'continue', 'extend', 'unlimited'].includes(decision)

    return {
      approved,
      decision: decision || (approved ? 'approve' : 'deny'),
    }
  }

  if (typeof rawResponse === 'string') {
    const decision = normalizeApprovalDecisionToken(rawResponse)
    const approved = ['approve', 'continue', 'extend', 'unlimited'].includes(decision)
    return {
      approved,
      decision: decision || (approved ? 'approve' : 'deny'),
    }
  }

  const approved = Boolean(rawResponse)
  return {
    approved,
    decision: approved ? 'approve' : 'deny',
  }
}

// Determines whether the classify limit issue for the agent session runtime.
export function classifyLimitIssue({ toolName, message }: LimitIssueInput) {
  const tool = String(toolName || '').trim()
  const raw = String(message || '').trim()
  const lower = raw.toLowerCase()
  if (!lower) return null

  if (tool === 'search.web' && lower.includes('budget reached')) {
    const budgetMatch = raw.match(/\((\d+)\s*\/\s*(\d+)\)/)
    return {
      kind: 'search_budget',
      label: 'search budget',
      context: {
        callsUsed: budgetMatch ? Number(budgetMatch[1]) : null,
        callBudget: budgetMatch ? Number(budgetMatch[2]) : null,
      },
    }
  }

  if (lower.includes('timed out after') || lower.includes('timeout')) {
    return {
      kind: 'tool_timeout',
      label: 'tool timeout',
      context: {},
    }
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('429') ||
    lower.includes('throttl')
  ) {
    const waitSecondsMatch = lower.match(/retry in(?: about)?\s+(\d+)s/)
    const retryAfterMs = waitSecondsMatch ? Math.max(0, Number(waitSecondsMatch[1]) * 1000) : 0

    return {
      kind: 'rate_limit',
      label: 'rate limit',
      context: {
        retryAfterMs,
      },
    }
  }

  if (
    lower.includes('limit reached') ||
    lower.includes('budget exceeded') ||
    lower.includes('max limit') ||
    lower.includes('exceeded maximum')
  ) {
    return {
      kind: 'generic_limit',
      label: 'runtime limit',
      context: {},
    }
  }

  return null
}

// Assembles limit decision options from lower-level state so callers receive one consistent
// representation.
export function buildLimitDecisionOptions(limitKind: unknown) {
  const kind = String(limitKind || '').toLowerCase()

  const continueLabel = kind === 'step_budget' ? 'Continue task' : 'Continue once'
  const continueDescription =
    kind === 'step_budget'
      ? 'Allow one more planning step and continue this task.'
      : 'Retry now with the minimum extra budget needed.'

  const extendLabel = kind === 'tool_timeout' ? 'Extend timeout' : 'Extend budget'
  const extendDescription =
    kind === 'step_budget'
      ? `Add ${SESSION_STEP_BUDGET_EXTEND_INCREMENT} more steps for this run.`
      : 'Increase the current limit and keep going.'

  const recommended = kind === 'step_budget' ? 'extend' : 'continue'

  return [
    {
      id: 'continue',
      label: continueLabel,
      description: continueDescription,
      recommended: recommended === 'continue',
    },
    {
      id: 'extend',
      label: extendLabel,
      description: extendDescription,
      recommended: recommended === 'extend',
    },
    {
      id: 'unlimited',
      label: 'Unlimited session',
      description: 'Use high session limits for this run.',
      recommended: false,
    },
    {
      id: 'deny',
      label: 'Disapprove',
      description: 'Stop extending limits and continue with current constraints.',
      recommended: false,
    },
  ]
}

// Selects or derives tool timeout ms from the available settings, input, and runtime context.
export function resolveToolTimeoutMs(toolName: string): number {
  return getCatalogToolTimeoutMs(toolName)
}

/**
 * Runs with timeout from initialization through completion, including its cleanup behavior.
 */

export async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => {
        reject(new Error(message))
      },
      Math.max(1000, Number(timeoutMs) || DEFAULT_TOOL_TIMEOUT_MS),
    )
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

// Waits for milliseconds without allowing the surrounding workflow to wait indefinitely.
export async function waitMs(durationMs: number): Promise<void> {
  const ms = Math.max(0, Number(durationMs) || 0)
  if (!ms) return

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Assembles find fallback paths from lower-level state so callers receive one consistent
// representation.
export function buildFindFallbackPaths(
  pathInput: unknown,
  { includeGlobalFallback = false }: FindFallbackOptions = {},
): string[] {
  const rawPath = String(pathInput || '').trim()
  if (!rawPath) return []

  const fallbackPaths: string[] = []

  if ((rawPath === '.' || rawPath === './') && includeGlobalFallback) {
    fallbackPaths.push('~/Documents')
    fallbackPaths.push('~')
    return dedupeStrings(fallbackPaths)
  }

  if (rawPath === '.' || rawPath === './') return []

  const leaf =
    rawPath
      .split(/[\\/]+/g)
      .filter(Boolean)
      .pop() || rawPath
  const leafToken = normalizePathToken(leaf)

  if (DOCUMENTS_ALIAS_TOKENS.has(leafToken)) {
    fallbackPaths.push('~/Documents')
  }

  if (isLikelyRelativePath(rawPath)) {
    fallbackPaths.push(`~/Documents/${rawPath}`)
    fallbackPaths.push(`~/${rawPath}`)
  }

  return dedupeStrings(fallbackPaths)
}

// The agent's filesystem root. Defaults to the user's home (~) so the assistant
// searches the whole home dir by default; narrowed to a working directory when
// the user sets one with the /dir chat command (settings.agent_working_dir).
