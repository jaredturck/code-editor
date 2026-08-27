/**
 * Stable agent-runtime API.
 *
 * Legacy helpers remain exported for compatibility. Automatic workspace projects are owned by
 * the durable long-running lifecycle; plan-first and non-project chat retain the direct runtime.
 */
export * from '@/platform/agentRuntimeLegacy'

import { terminalCommandLikelyMutatesSource } from '@/platform/agent/repetitionAdvisory'
import { runLongRunningProject } from '@/platform/agent/longRunningProjectRuntime'
import {
  persistedTaskMatchesInput,
  runAgentSession as runDirectAgentSession,
  withAutomaticApprovalPolicy,
  withThrottledStreamEvents,
} from '@/platform/projectAgentRuntime'
import type { AgentSessionInput, AgentSessionResult } from '@/platform/agentRuntimeLegacy'

export { persistedTaskMatchesInput, withAutomaticApprovalPolicy, withThrottledStreamEvents }

const OBSERVATION_TOOLS = new Set([
  'files.read',
  'files.list',
  'files.find',
  'files.stat',
  'files.diff',
  'search.ripgrep',
  'search.find',
  'search.fd',
  'rag.retrieve',
  'browser.inspect',
  'diagnostics.check',
  'search.web',
  'web.fetch',
  'sources.lookup',
  'system.stats',
  'system.processes',
  'agent.status',
])

const VERIFICATION_TOOLS = new Set(['browser.inspect', 'diagnostics.check', 'agent.review'])

function isWorkspaceProjectRun(input: AgentSessionInput) {
  const session = input.settings?.chat_session
  const chatId = session && typeof session === 'object' && !Array.isArray(session)
    ? String((session as Record<string, unknown>).id || '').trim()
    : ''
  return Boolean(chatId && String(input.settings?.agent_working_dir || '').trim())
}

function stepTool(step: Record<string, unknown>) {
  return String(step.tool || step.requestedTool || '')
}

function stepArgs(step: Record<string, unknown>) {
  return step.args && typeof step.args === 'object' && !Array.isArray(step.args)
    ? (step.args as Record<string, unknown>)
    : {}
}

function successfulMutation(step: Record<string, unknown>) {
  if (step.ok === false || ['error', 'failed'].includes(String(step.status || '').toLowerCase())) return false
  const tool = stepTool(step)
  if (['files.write', 'files.edit', 'files.patch'].includes(tool)) return true
  return tool === 'terminal.exec' && terminalCommandLikelyMutatesSource(stepArgs(step).command)
}

function terminalVerification(step: Record<string, unknown>) {
  if (stepTool(step) !== 'terminal.exec') return false
  const command = String(stepArgs(step).command || '')
  return /\b(?:test|vitest|jest|pytest|playwright|cypress|lint|eslint|ruff|typecheck|tsc|build|compile|check)\b|npm\s+run\s+(?:test|lint|build|typecheck|check)|pnpm\s+(?:test|lint|build|typecheck|check)/i.test(command)
}

function buildEfficiencyMetrics(result: AgentSessionResult) {
  const history = Array.isArray(result.stepHistory) ? result.stepHistory : []
  let firstMutationIndex = -1
  let sourceMutations = 0
  let observations = 0
  let observationsBeforeFirstMutation = 0
  let verificationActions = 0
  let repetitionBlocks = 0
  const toolCounts: Record<string, number> = {}

  history.forEach((rawStep, index) => {
    const step = rawStep as Record<string, unknown>
    const tool = stepTool(step) || 'unknown'
    toolCounts[tool] = (toolCounts[tool] || 0) + 1

    const mutation = successfulMutation(step)
    if (mutation) {
      sourceMutations += 1
      if (firstMutationIndex < 0) firstMutationIndex = index
    }

    if (OBSERVATION_TOOLS.has(tool)) {
      observations += 1
      if (firstMutationIndex < 0) observationsBeforeFirstMutation += 1
    }

    if (VERIFICATION_TOOLS.has(tool) || terminalVerification(step)) verificationActions += 1
    if (/repetition block|repeated call blocked|tool guard/i.test(String(step.error || ''))) repetitionBlocks += 1
  })

  const successfulActions = history.filter((step) => (step as Record<string, unknown>).ok !== false).length
  const failedActions = history.length - successfulActions

  return {
    totalActions: history.length,
    successfulActions,
    failedActions,
    firstMutationAction: firstMutationIndex < 0 ? null : firstMutationIndex + 1,
    observationsBeforeFirstMutation,
    totalObservations: observations,
    sourceMutations,
    verificationActions,
    browserInspections: toolCounts['browser.inspect'] || 0,
    diagnosticsChecks: toolCounts['diagnostics.check'] || 0,
    repetitionBlocks,
    observationToMutationRatio: sourceMutations > 0 ? Number((observations / sourceMutations).toFixed(2)) : observations,
    toolCounts,
  }
}

export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  const workspaceProject = isWorkspaceProjectRun(input)
  const automatic = String(input.settings?.agent_project_run_mode || 'automatic') !== 'plan_first'
  const result = workspaceProject && automatic ? await runLongRunningProject(input) : await runDirectAgentSession(input)
  if (!workspaceProject) return result
  return {
    ...result,
    summary: {
      ...(result.summary || {}),
      efficiency: buildEfficiencyMetrics(result),
    },
  }
}
