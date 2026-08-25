/** Normalizes interactive approval choices before they are returned to an active agent run. */

import type { ApprovalOption, ApprovalRequest } from '../types'

export function normalizeApprovalDecision(value: unknown): string {
  const token = String(value || '')
    .trim()
    .toLowerCase()
  if (!token) return 'deny'

  if (['approve', 'approved', 'allow', 'grant', 'yes'].includes(token)) return 'approve'
  if (['continue', 'continue_once', 'continue-once', 'once', 'retry'].includes(token)) return 'continue'
  if (['extend', 'extend_budget', 'extend-budget', 'increase_budget'].includes(token)) return 'extend'
  if (['unlimited', 'unlimited_session', 'unlimited-for-session', 'no_limits', 'disable_limits'].includes(token)) {
    return 'unlimited'
  }
  if (['deny', 'denied', 'disapprove', 'reject', 'stop', 'no'].includes(token)) return 'deny'

  return token
}

export function isApprovalDecisionApproved(decision: unknown): boolean {
  return ['approve', 'continue', 'extend', 'unlimited'].includes(normalizeApprovalDecision(decision))
}

function getDefaultApprovalOptions(requestType: unknown): ApprovalOption[] {
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
