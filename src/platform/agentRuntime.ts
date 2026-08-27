/**
 * Stable agent-runtime API.
 *
 * Legacy helpers remain exported for compatibility. Workspace project execution is owned by
 * projectAgentRuntime and Automatic mode is explicitly bounded rather than masquerading as
 * another run mode.
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

function withBoundedProjectMode(input: AgentSessionInput): AgentSessionInput {
  if (!isWorkspaceProjectRun(input)) return input
  if (String(input.settings?.agent_project_run_mode || 'automatic') === 'plan_first') return input
  return {
    ...input,
    settings: {
      ...input.settings,
      agent_bounded_automatic: true,
    },
  }
}

export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  return runProjectAgentSession(withBoundedProjectMode(input))
}
