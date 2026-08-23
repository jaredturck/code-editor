/**
 * Small project-level verification facade around the inherited agent runtime.
 *
 * The legacy runtime remains byte-for-byte at agentRuntimeLegacy.ts. This layer owns only
 * model-defined verification acceptance so project policy can evolve without repeatedly
 * rewriting the large established lifecycle implementation.
 */
export * from '@/platform/agentRuntimeLegacy'

import { buildLocalPreflightPlan, type LocalPreflightPlan } from '@/platform/agent/localPlanner'
import {
  buildVerificationContractKey,
  ensureVerificationState,
  evaluateVerificationGate,
  snapshotVerificationState,
  type VerificationGateResult,
  type VerificationState,
} from '@/platform/agent/verificationEvidence'
import {
  buildProjectWorkingContext,
  runAgentSession as runLegacyAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '@/platform/agentRuntimeLegacy'
import { getChatSessionState, loadChatContext, saveCompacted } from '@/platform/chatSessionStore'

const VERIFICATION_GATE_TODO_ID = 'verification-gate'
const MAX_VERIFICATION_REMEDIATION_PASSES = 2

function cleanLine(value: unknown, maxChars = 500) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars)}…`
}

function projectChatId(input: AgentSessionInput) {
  const session = input.settings?.chat_session
  if (!session || typeof session !== 'object') return ''
  return String((session as Record<string, unknown>).id || '').trim()
}

function isWorkspaceProjectRun(input: AgentSessionInput) {
  return Boolean(projectChatId(input) && String(input.settings?.agent_working_dir || '').trim())
}

function taskPreflightPlan(input: AgentSessionInput): LocalPreflightPlan | null {
  const plan = input.settings?.agent_preflight_plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null
  return plan as unknown as LocalPreflightPlan
}

function persistedProjectSummary(input: AgentSessionInput) {
  if (!isWorkspaceProjectRun(input)) return null
  const projectRun = getChatSessionState(projectChatId(input))?.projectRun
  const runtimeSummary = projectRun?.runtime_summary
  if (runtimeSummary && typeof runtimeSummary === 'object' && !Array.isArray(runtimeSummary)) {
    return runtimeSummary as Record<string, unknown>
  }
  const legacySummary = projectRun?.summary
  if (legacySummary && typeof legacySummary === 'object' && !Array.isArray(legacySummary)) {
    return legacySummary as Record<string, unknown>
  }
  return null
}

function persistedTaskPreflightPlan(input: AgentSessionInput): LocalPreflightPlan | null {
  const plan = persistedProjectSummary(input)?.taskPreflightPlan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null
  return plan as unknown as LocalPreflightPlan
}

async function withModelTaskContract(input: AgentSessionInput): Promise<AgentSessionInput> {
  if (taskPreflightPlan(input) || !String(input.userInput || '').trim()) return input

  const persistedPlan = persistedTaskPreflightPlan(input)
  if (persistedPlan) {
    return {
      ...input,
      settings: {
        ...input.settings,
        agent_preflight_plan: persistedPlan,
      },
    }
  }

  try {
    const conversation = (input.conversation || []).map((message) => ({
      role: typeof message.role === 'string' ? message.role : undefined,
      content: message.content,
    }))
    const plan = await buildLocalPreflightPlan(input.userInput, conversation, input.settings, input.abortSignal)
    if (!plan) return input

    input.onEvent?.({
      type: 'thinking',
      summary: `AI preflight interpreted the task as ${plan.taskType}${plan.workspaceMutationExpected ? ' with workspace changes' : ''}${plan.verificationRequired ? ' and completion verification' : ''}.`,
      at: Date.now(),
    })
    return {
      ...input,
      settings: {
        ...input.settings,
        agent_preflight_plan: plan,
      },
    }
  } catch (error) {
    input.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `AI task preflight was unavailable; the main agent will interpret the request directly (${cleanLine(error instanceof Error ? error.message : error, 180)}).`,
      at: Date.now(),
    })
    return input
  }
}

function withVerificationState(input: AgentSessionInput): AgentSessionInput {
  const plan = taskPreflightPlan(input)
  if (!plan || !isWorkspaceProjectRun(input)) return input
  const required = plan.developmentTask === true && plan.verificationRequired === true
  const contractKey = buildVerificationContractKey(plan as unknown as Record<string, unknown>)
  const projectSummary = persistedProjectSummary(input)
  const persistedState = input.settings?.agent_verification_state || projectSummary?.verificationState
  const state = ensureVerificationState(persistedState, contractKey, required)
  return {
    ...input,
    settings: {
      ...input.settings,
      agent_verification_state: state,
    },
  }
}

function activeVerificationState(input: AgentSessionInput): VerificationState | null {
  const state = input.settings?.agent_verification_state
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  return state as unknown as VerificationState
}

function withoutVerificationTodo(todos: Array<Record<string, unknown>> | undefined) {
  return (Array.isArray(todos) ? todos : []).filter((todo) => String(todo.id || '') !== VERIFICATION_GATE_TODO_ID)
}

function mergeAgentResults(previous: AgentSessionResult, next: AgentSessionResult): AgentSessionResult {
  const artifacts = new Map<string, Record<string, unknown>>()
  for (const artifact of [...(previous.artifacts || []), ...(next.artifacts || [])]) {
    const key = String(
      artifact.id || artifact.artifactId || artifact.path || artifact.filename || JSON.stringify(artifact),
    )
    artifacts.set(key, artifact)
  }
  return {
    ...next,
    timeline: [...(previous.timeline || []), ...(next.timeline || [])].slice(-600),
    stepHistory: [...(previous.stepHistory || []), ...(next.stepHistory || [])].slice(-600),
    artifacts: [...artifacts.values()],
    steps: Number(previous.steps || 0) + Number(next.steps || 0),
    todos: Array.isArray(next.todos) ? next.todos : previous.todos,
  }
}

function formatVerificationGate(gate: VerificationGateResult) {
  if (!gate.requirements.length) return '- No verification requirements have been declared yet.'
  return gate.requirements
    .map((item) => {
      const source = item.sourceTool
        ? ` via ${item.sourceTool}${item.source ? ` (${cleanLine(item.source, 220)})` : ''}`
        : ''
      return `- ${item.requirement}: ${item.status}${source}${item.detail ? ` — ${cleanLine(item.detail, 300)}` : ''}`
    })
    .join('\n')
}

function buildVerificationRemediationPrompt(
  originalRequest: string,
  gate: VerificationGateResult,
  result: AgentSessionResult,
) {
  const recentEvidence = (result.stepHistory || [])
    .slice(-24)
    .map((step) => {
      const tool = String(step.tool || step.requestedTool || 'action')
      const detail = step.ok === false ? step.error : step.summary
      return `- ${tool}: ${step.ok === false ? 'failed' : 'ok'}${detail ? ` — ${cleanLine(detail, 360)}` : ''}`
    })
    .join('\n')

  return [
    `Continue the original development request:\n${originalRequest}`,
    'VERIFICATION GATE REMEDIATION: The runtime cannot accept this task yet because the verification checks chosen by the model are incomplete, stale, failed, or inconclusive.',
    'Use your own engineering judgment. You decide which checks are relevant to this project; the runtime does not infer checks from framework or language names.',
    'Use verification.require to declare or revise the checks you consider necessary. Real terminal.exec, launch.run, browser.inspect, diagnostics.check, and agent.review results return verificationCandidateId values. Use verification.record to bind the appropriate candidate to one declared requirement. The runtime derives pass/fail from the real result; do not claim or encode a passed boolean yourself.',
    'If you change source files after a check passes, that evidence becomes stale. Re-run whichever checks you still consider necessary after the change.',
    `Current verification state:\n${formatVerificationGate(gate)}`,
    gate.blockers.length ? `Blocking conditions:\n${gate.blockers.map((blocker) => `- ${blocker}`).join('\n')}` : '',
    recentEvidence ? `Recent execution evidence:\n${recentEvidence}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function annotateVerification(
  result: AgentSessionResult,
  gate: VerificationGateResult | null,
  remediationPasses: number,
  state: VerificationState | null,
  plan: LocalPreflightPlan | null,
) {
  if (!gate) return result
  const summary = {
    ...(result.summary || {}),
    verification: {
      ...gate,
      remediationPasses,
    },
    verificationState: state ? snapshotVerificationState(state) : null,
    taskPreflightPlan: plan,
  }
  if (gate.passed) return { ...result, summary }

  return {
    ...result,
    summary,
    todos: [
      ...withoutVerificationTodo(result.todos),
      {
        id: VERIFICATION_GATE_TODO_ID,
        text: `Verification gate: ${gate.blockers.join(' ')}`.slice(0, 1200),
        status: 'in_progress',
      },
    ],
    reply:
      `${String(result.reply || '').trim()}\n\nThe verification gate remains open, so this run is paused rather than marked complete. ${gate.blockers.join(' ')}`.trim(),
  }
}

async function persistOriginalProjectContext(
  input: AgentSessionInput,
  result: AgentSessionResult,
  priorCompacted: string,
) {
  const chatId = projectChatId(input)
  if (!chatId || !isWorkspaceProjectRun(input)) return
  const compacted = buildProjectWorkingContext(input, result, priorCompacted)
  await saveCompacted(chatId, compacted)
}

/** Runs the established project lifecycle, then enforces model-defined verification evidence. */
export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  const taskInput = await withModelTaskContract(input)
  const executionInput = withVerificationState(taskInput)
  const state = activeVerificationState(executionInput)
  let priorCompacted = ''

  if (isWorkspaceProjectRun(executionInput)) {
    try {
      priorCompacted = String((await loadChatContext(projectChatId(executionInput)))?.compacted || '')
    } catch {
      priorCompacted = ''
    }
  }

  let combined = await runLegacyAgentSession(executionInput)
  let gate = state ? evaluateVerificationGate(state) : null
  let remediationPasses = 0

  while (
    gate?.required === true &&
    !gate.passed &&
    remediationPasses < MAX_VERIFICATION_REMEDIATION_PASSES &&
    !executionInput.abortSignal?.aborted
  ) {
    remediationPasses += 1
    executionInput.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary:
        `Verification gate requested remediation pass ${remediationPasses}/${MAX_VERIFICATION_REMEDIATION_PASSES}: ${gate.blockers.join(' ')}`.slice(
          0,
          1000,
        ),
      at: Date.now(),
    })
    const remediationInput: AgentSessionInput = {
      ...executionInput,
      userInput: buildVerificationRemediationPrompt(input.userInput, gate, combined),
      conversation: [...(executionInput.conversation || []), { role: 'assistant', content: combined.reply }].slice(-80),
      todos: withoutVerificationTodo(combined.todos),
    }
    const next = await runLegacyAgentSession(remediationInput)
    combined = mergeAgentResults(combined, next)
    gate = state ? evaluateVerificationGate(state) : null
  }

  const finalResult = annotateVerification(combined, gate, remediationPasses, state, taskPreflightPlan(executionInput))
  if (state) {
    try {
      await persistOriginalProjectContext(executionInput, finalResult, priorCompacted)
    } catch (error) {
      input.onEvent?.({
        type: 'notice',
        level: 'error',
        summary: `Project working context could not be normalized after verification (${cleanLine(error instanceof Error ? error.message : error, 180)}).`,
        at: Date.now(),
      })
    }
  }
  return finalResult
}
