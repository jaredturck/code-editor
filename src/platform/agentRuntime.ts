/**
 * Stable agent-runtime API.
 *
 * Legacy helpers remain exported for compatibility, while production project execution is
 * owned by projectAgentRuntime. Automatic project runs use a bounded approval adapter so
 * runtime limits cannot silently turn into unlimited sessions.
 */
export * from '@/platform/agentRuntimeLegacy'

import {
  persistedTaskMatchesInput,
  runAgentSession as runProjectAgentSession,
  withAutomaticApprovalPolicy,
  withThrottledStreamEvents,
} from '@/platform/projectAgentRuntime'
import type { AgentSessionInput, AgentSessionResult } from '@/platform/agentRuntimeLegacy'

export { persistedTaskMatchesInput, withAutomaticApprovalPolicy, withThrottledStreamEvents }

function isWorkspaceProjectRun(input: AgentSessionInput) {
  const session = input.settings?.chat_session
  const chatId = session && typeof session === 'object' && !Array.isArray(session)
    ? String((session as Record<string, unknown>).id || '').trim()
    : ''
  return Boolean(chatId && String(input.settings?.agent_working_dir || '').trim())
}

function withBoundedAutomaticApproval(input: AgentSessionInput): AgentSessionInput {
  if (!isWorkspaceProjectRun(input)) return input
  if (String(input.settings?.agent_project_run_mode || 'automatic') === 'plan_first') return input

  const originalApprovalRequest = input.onApprovalRequest
  return {
    ...input,
    // projectAgentRuntime skips its unlimited auto-approval wrapper for plan_first. Keep
    // planning disabled so this is still Automatic mode semantically; only approval policy changes.
    settings: {
      ...input.settings,
      agent_project_run_mode: 'plan_first',
      agent_planning_mode: false,
      agent_require_explicit_approval: false,
      agent_bounded_automatic: true,
    },
    onApprovalRequest: async (request) => {
      const record = request && typeof request === 'object' ? (request as Record<string, unknown>) : {}
      const requestType = String(record.requestType || '').toLowerCase()
      const requestedAction = String(record.requestedAction || '').toLowerCase()

      if (requestType === 'limit') return { approved: true, decision: 'continue' }
      if (requestType === 'question' && requestedAction === 'continue the long-running task') {
        return { approved: false, decision: 'deny', answer: 'Halt', stopped: true }
      }
      if (requestType === 'question' && record.planText) {
        return { approved: true, decision: 'approve', answer: 'Approve' }
      }
      if (requestType === 'question') {
        return { approved: true, decision: 'autonomous', answer: 'Proceed using the current project evidence.' }
      }
      if (typeof originalApprovalRequest === 'function') return originalApprovalRequest(request)
      return { approved: false, decision: 'deny' }
    },
  }
}

export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  return runProjectAgentSession(withBoundedAutomaticApproval(input))
}
