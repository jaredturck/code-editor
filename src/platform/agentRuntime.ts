/**
 * Stable agent-runtime API.
 *
 * Legacy helpers remain exported for compatibility, while production project execution is
 * owned by projectAgentRuntime: one core session plus at most one objective remediation pass.
 */
export * from '@/platform/agentRuntimeLegacy'
export {
  persistedTaskMatchesInput,
  runAgentSession,
  withAutomaticApprovalPolicy,
  withThrottledStreamEvents,
} from '@/platform/projectAgentRuntime'
