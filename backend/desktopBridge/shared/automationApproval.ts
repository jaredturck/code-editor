/**
 * Creates short-lived, single-use capabilities for one exact desktop-automation plan.
 * Binding approval to the actions and working directory prevents a token obtained for a
 * harmless plan from being replayed for different mouse or keyboard input.
 */

import { createHash, randomUUID } from 'node:crypto'

const APPROVAL_TTL_MS = 60_000
const MAX_PENDING_APPROVALS = 256

interface AutomationApprovalRequest {
  actions: unknown[]
  cwd: string
}

interface PendingApproval {
  signature: string
  expiresAt: number
}

const pendingApprovals = new Map<string, PendingApproval>()

// Produces a stable representation of an automation action plan for approval signing.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

// Hashes the canonical action plan so an approval can only authorize that exact plan.
function approvalSignature(request: AutomationApprovalRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ actions: request.actions, cwd: request.cwd })))
    .digest('hex')
}

// Removes expired desktop-control approvals before new approvals are issued or consumed.
function pruneExpired(now = Date.now()): void {
  for (const [token, approval] of pendingApprovals) {
    if (approval.expiresAt <= now) pendingApprovals.delete(token)
  }
  while (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
    const oldest = pendingApprovals.keys().next().value as string | undefined
    if (!oldest) break
    pendingApprovals.delete(oldest)
  }
}

// Creates a short-lived approval bound to one normalized desktop automation plan.
export function createAutomationApproval(request: AutomationApprovalRequest): string {
  pruneExpired()
  const token = randomUUID()
  pendingApprovals.set(token, {
    signature: approvalSignature(request),
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  })
  return token
}

/** Consumes a matching capability once; mismatched attempts invalidate it as well. */
export function consumeAutomationApproval(token: unknown, request: AutomationApprovalRequest): boolean {
  pruneExpired()
  const normalizedToken = String(token || '').trim()
  if (!normalizedToken) return false
  const approval = pendingApprovals.get(normalizedToken)
  pendingApprovals.delete(normalizedToken)
  return Boolean(approval && approval.signature === approvalSignature(request))
}

// Clears retained automation approvals so tests start from isolated state.
export function clearAutomationApprovalsForTests(): void {
  pendingApprovals.clear()
}
