/**
 * Normalizes approval choices, option lists, and timeout display for the Chat panel's
 * interactive approval cards. The helpers give user responses one stable meaning before
 * they are returned to an active agent session.
 */

import { getToolTimeoutMs } from '@/platform/agent/toolCatalog'
import type { ApprovalOption, ApprovalRequest, TimelineEventData } from '../types'

/**
 * Maps labels such as allow, continue, extend, unlimited, reject, or stop onto the decision
 * tokens understood by an active agent run. Unknown values are preserved for explicit
 * handling, while an empty response defaults to denial.
 */

export function normalizeApprovalDecision(value: unknown): string {
  const token = String(value || '')
    .trim()
    .toLowerCase()
  if (!token) return 'deny'

  if (['approve', 'approved', 'allow', 'grant', 'yes'].includes(token)) return 'approve'
  if (['continue', 'continue_once', 'continue-once', 'once', 'retry'].includes(token)) return 'continue'
  if (['extend', 'extend_budget', 'extend-budget', 'increase_budget'].includes(token)) return 'extend'
  if (['unlimited', 'unlimited_session', 'unlimited-for-session', 'no_limits', 'disable_limits'].includes(token))
    return 'unlimited'
  if (['deny', 'denied', 'disapprove', 'reject', 'stop', 'no'].includes(token)) return 'deny'

  return token
}

// Evaluates whether is approval decision approved for the supplied value and current runtime state.
export function isApprovalDecisionApproved(decision: unknown): boolean {
  return ['approve', 'continue', 'extend', 'unlimited'].includes(normalizeApprovalDecision(decision))
}

// Returns default approval options without requiring callers to know where or how it is stored.
export function getDefaultApprovalOptions(requestType: unknown): ApprovalOption[] {
  if (String(requestType || '').toLowerCase() === 'limit') {
    return [
      {
        id: 'continue',
        label: 'Continue once',
        description: 'Retry with the minimum extra budget.',
        recommended: true,
      },
      {
        id: 'extend',
        label: 'Extend budget',
        description: 'Increase limits and continue.',
        recommended: false,
      },
      {
        id: 'unlimited',
        label: 'Unlimited session',
        description: 'Use high limits for the current run.',
        recommended: false,
      },
      {
        id: 'deny',
        label: 'Disapprove',
        description: 'Stop extending limits.',
        recommended: false,
      },
    ]
  }

  return [
    {
      id: 'approve',
      label: 'Approve',
      description: 'Allow this request.',
      recommended: true,
    },
    { id: 'deny', label: 'Deny', description: 'Reject this request.', recommended: false },
  ]
}

/**
 * Converts custom approval choices into the id, label, description, and recommendation
 * shape rendered by approval cards. Invalid or empty lists fall back to the safe defaults
 * for the request type.
 */

export function normalizeApprovalOptions(request: Partial<ApprovalRequest> | null | undefined): ApprovalOption[] {
  const input = Array.isArray(request?.options) ? request.options : []
  const requestType = String(request?.requestType || 'permission').toLowerCase()

  const persistentPermission =
    request?.persistentPermission === true ||
    (Array.isArray(request?.permissionKeys) && request.permissionKeys.length > 0)
  if (requestType === 'permission' && persistentPermission) {
    return [
      {
        id: 'allow_once',
        label: 'Allow once',
        description: 'Enable this capability for the current project run only.',
        recommended: true,
      },
      {
        id: 'allow_always',
        label: 'Always allow',
        description: 'Enable this capability in Settings for future runs.',
        recommended: false,
      },
      {
        id: 'deny',
        label: 'Deny',
        description: 'Reject this permission request.',
        recommended: false,
      },
    ]
  }

  if (!input.length) return getDefaultApprovalOptions(requestType)

  const normalized = input
    .map((option) => {
      const source = option as ApprovalOption & Record<string, unknown>
      const id = normalizeApprovalDecision(source?.id || source?.value || source?.decision || source?.label)
      if (!id) return null
      return {
        id,
        label: String(source?.label || id),
        description: String(source?.description || ''),
        recommended: source?.recommended === true,
      }
    })
    .filter((option): option is ApprovalOption => Boolean(option))

  return normalized.length ? normalized : getDefaultApprovalOptions(requestType)
}

// Formats timeout countdown for stable display or serialization without changing its underlying
// meaning.
export function formatTimeoutCountdown(ms: unknown): string {
  const safeMs = Math.max(0, Number(ms) || 0)
  const totalSeconds = Math.ceil(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export interface ToolTimeoutDisplay {
  timeoutMs: number
  elapsedMs: number
  remainingMs: number
  pending: boolean
  timedOut: boolean
  label: string
}

interface PendingToolCall {
  eventId: string | number | undefined
  signature: string
  startedAt: number
  timeoutMs: number
  completedAt: number | null
}

// Assembles tool timeout map from lower-level state so callers receive one consistent
// representation.
export function buildToolTimeoutMap(
  events: TimelineEventData[],
  nowTs = Date.now(),
): Record<string, ToolTimeoutDisplay> {
  const timeline = Array.isArray(events) ? events : []
  const callBySignature = new Map<string, PendingToolCall>()
  const pendingByEventId: Record<string, PendingToolCall> = {}

  timeline.forEach((event) => {
    if (event?.type === 'tool_call') {
      const signature = `${String(event?.step || 'na')}|${String(event?.tool || '').toLowerCase()}`
      const timeoutMs = Number.isFinite(Number(event?.timeoutMs))
        ? Math.max(1000, Number(event.timeoutMs))
        : getToolTimeoutMs(event?.tool)
      const eventId = event.id
      const info: PendingToolCall = {
        eventId,
        signature,
        startedAt: Number(event?.at) || nowTs,
        timeoutMs,
        completedAt: null,
      }

      callBySignature.set(signature, info)
      pendingByEventId[String(eventId)] = info
      return
    }

    if (event?.type === 'tool_result') {
      const signature = `${String(event?.step || 'na')}|${String(event?.tool || '').toLowerCase()}`
      const callInfo = callBySignature.get(signature)
      if (callInfo && !callInfo.completedAt) callInfo.completedAt = Number(event?.at) || nowTs
    }
  })

  const result: Record<string, ToolTimeoutDisplay> = {}
  Object.entries(pendingByEventId).forEach(([eventId, info]) => {
    const endAt = info.completedAt || nowTs
    const elapsedMs = Math.max(0, endAt - info.startedAt)
    const remainingMs = Math.max(0, info.timeoutMs - elapsedMs)
    const timedOut = elapsedMs >= info.timeoutMs

    result[eventId] = {
      timeoutMs: info.timeoutMs,
      elapsedMs,
      remainingMs,
      pending: !info.completedAt,
      timedOut,
      label: !info.completedAt
        ? timedOut
          ? 'timeout reached'
          : `${formatTimeoutCountdown(remainingMs)} until timeout`
        : timedOut
          ? 'completed after timeout budget'
          : `timeout budget ${formatTimeoutCountdown(info.timeoutMs)}`,
    }
  })

  return result
}
