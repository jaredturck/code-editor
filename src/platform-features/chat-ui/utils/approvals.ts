/** Normalizes interactive approval choices before they are returned to an active agent run. */

import type { ApprovalOption, ApprovalRequest, UnknownRecord } from '../types'

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

function approvalStepAction(request: Partial<ApprovalRequest> | null | undefined): UnknownRecord {
  const stepAction = request?.stepAction
  if (!stepAction || typeof stepAction !== 'object' || Array.isArray(stepAction)) return {}
  return stepAction
}

export function approvalCommand(request: Partial<ApprovalRequest> | null | undefined): string {
  const stepAction = approvalStepAction(request)
  const direct = String(request?.command || stepAction.command || '').trim()
  if (direct) return direct

  const requestedAction = String(request?.requestedAction || '').trim()
  const tool = String(request?.requestedTool || request?.tool || '').toLowerCase()
  if (tool === 'terminal.exec') {
    return requestedAction.replace(/^run command\s+/i, '').trim()
  }
  if (tool === 'launch.run') {
    return requestedAction.replace(/^launch\s+/i, '').trim()
  }
  return ''
}

export function approvalWorkingDirectory(request: Partial<ApprovalRequest> | null | undefined): string {
  const stepAction = approvalStepAction(request)
  return String(request?.cwd || stepAction.cwd || '').trim()
}

export function formatApprovalRequestForDisplay(request: ApprovalRequest, now = Date.now()): ApprovalRequest {
  const requestType = String(request.requestType || '').toLowerCase()
  if (requestType === 'question') return request

  const command = approvalCommand(request)
  const cwd = approvalWorkingDirectory(request)
  const defaultDescription = 'The agent is requesting permission before continuing.'
  const description = String(
    command
      ? request.reason || request.requestedAction || defaultDescription
      : request.requestedAction || request.reason || defaultDescription,
  ).trim()
  const sections: string[] = []

  if (description && description !== command) sections.push(description)
  if (command) sections.push(`Command:\n${command}`)
  if (command && cwd) sections.push(`Working directory:\n${cwd}`)

  const expiresAt = Number(request.expiresAt || 0)
  if (expiresAt) {
    const secondsRemaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
    sections.push(`Auto-denies in ${secondsRemaining}s if you do not respond.`)
  }

  return {
    ...request,
    requestedAction: sections.join('\n\n') || defaultDescription,
  }
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
