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
  formatWorkspaceDiagnostics,
  getWorkspaceDiagnosticsSnapshot,
  type WorkspaceDiagnosticsSnapshot,
} from '@/platform/agent/workspaceDiagnosticsState'
import {
  buildProjectWorkingContext,
  runAgentSession as runLegacyAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '@/platform/agentRuntimeLegacy'
import { getChatSessionState, loadChatContext, saveCompacted } from '@/platform/chatSessionStore'

const VERIFICATION_GATE_TODO_ID = 'verification-gate'
const DIAGNOSTICS_GATE_TODO_ID = 'diagnostics-gate'
const MAX_ACCEPTANCE_REMEDIATION_PASSES = 2
const STREAM_EVENT_INTERVAL_MS = 80

type AgentRuntimeEvent = Parameters<NonNullable<AgentSessionInput['onEvent']>>[0]

class StreamEventCoalescer {
  private pending: AgentRuntimeEvent | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly on_event: NonNullable<AgentSessionInput['onEvent']>,
    private readonly interval_ms: number,
  ) {}

  emit(event: AgentRuntimeEvent) {
    const record = event as unknown as Record<string, unknown>
    if (String(record.type || '').toLowerCase() !== 'stream') {
      this.flush()
      this.on_event(event)
      return
    }

    const step = String(record.step ?? '')
    const pending_record = this.pending as unknown as Record<string, unknown> | null
    const pending_step = pending_record ? String(pending_record.step ?? '') : ''
    if (this.pending && step !== pending_step) this.flush()

    const current_record = this.pending as unknown as Record<string, unknown> | null
    const delta = `${String(current_record?.delta || '')}${String(record.delta || '')}`
    this.pending = {
      ...(current_record || {}),
      ...record,
      delta,
    } as unknown as AgentRuntimeEvent

    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.interval_ms)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const pending = this.pending
    this.pending = null
    if (pending) this.on_event(pending)
  }
}

export function withThrottledStreamEvents(input: AgentSessionInput, interval_ms = STREAM_EVENT_INTERVAL_MS) {
  if (typeof input.onEvent !== 'function') {
    return {
      input,
      flush: () => undefined,
    }
  }

  const coalescer = new StreamEventCoalescer(input.onEvent, Math.max(16, Math.round(interval_ms)))
  return {
    input: {
      ...input,
      onEvent: (event: AgentRuntimeEvent) => coalescer.emit(event),
    },
    flush: () => coalescer.flush(),
  }
}

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

function persistedProjectRun(input: AgentSessionInput) {
  if (!isWorkspaceProjectRun(input)) return null
  return getChatSessionState(projectChatId(input))?.projectRun || null
}

function persistedProjectSummary(input: AgentSessionInput) {
  const projectRun = persistedProjectRun(input)
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

export function persistedTaskMatchesInput(input: AgentSessionInput) {
  const persistedGoal = String(persistedProjectRun(input)?.goal || '').trim()
  const currentRequest = String(input.userInput || '').trim()
  return Boolean(persistedGoal && currentRequest.includes(persistedGoal))
}

async function withModelTaskContract(input: AgentSessionInput): Promise<AgentSessionInput> {
  if (taskPreflightPlan(input) || !String(input.userInput || '').trim()) return input

  const persistedPlan = persistedTaskMatchesInput(input) ? persistedTaskPreflightPlan(input) : null
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

export function withAutomaticApprovalPolicy(input: AgentSessionInput): AgentSessionInput {
  if (String(input.settings?.agent_project_run_mode || 'automatic') === 'plan_first') return input

  const originalApprovalRequest = input.onApprovalRequest
  return {
    ...input,
    onApprovalRequest: async (request) => {
      const record = request && typeof request === 'object' ? (request as Record<string, unknown>) : {}
      const requestType = String(record.requestType || '').toLowerCase()
      const requestedAction = String(record.requestedAction || '').toLowerCase()

      if (requestType === 'limit') {
        return {
          approved: true,
          decision: 'unlimited',
        }
      }

      if (requestType === 'question') {
        if (record.planText) {
          return {
            approved: true,
            decision: 'approve',
            answer: 'Approve',
          }
        }
        if (requestedAction === 'continue the long-running task') {
          return {
            approved: true,
            decision: 'continue',
            answer: 'Continue',
          }
        }
        return {
          approved: true,
          decision: 'autonomous',
          answer: 'Proceed using your best reasonable judgment from the existing project context.',
        }
      }

      if (typeof originalApprovalRequest === 'function') return originalApprovalRequest(request)
      return {
        approved: false,
        decision: 'deny',
      }
    },
  }
}

function activeVerificationState(input: AgentSessionInput): VerificationState | null {
  const state = input.settings?.agent_verification_state
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  return state as unknown as VerificationState
}

function withoutAcceptanceTodos(todos: Array<Record<string, unknown>> | undefined) {
  return (Array.isArray(todos) ? todos : []).filter((todo) => {
    const id = String(todo.id || '')
    return id !== VERIFICATION_GATE_TODO_ID && id !== DIAGNOSTICS_GATE_TODO_ID
  })
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

async function currentWorkspaceDiagnostics(input: AgentSessionInput) {
  const plan = taskPreflightPlan(input)
  if (plan?.developmentTask !== true || !isWorkspaceProjectRun(input)) return null

  try {
    return await getWorkspaceDiagnosticsSnapshot(String(input.settings?.agent_working_dir || ''))
  } catch {
    return null
  }
}

function diagnosticsErrors(snapshot: WorkspaceDiagnosticsSnapshot | null) {
  return Math.max(0, Number(snapshot?.counts.errors || 0))
}

function acceptanceBlockers(gate: VerificationGateResult | null, diagnostics: WorkspaceDiagnosticsSnapshot | null) {
  const blockers: string[] = []
  if (gate?.required === true && !gate.passed) blockers.push(...gate.blockers)
  const errors = diagnosticsErrors(diagnostics)
  if (errors > 0) blockers.push(`Workspace diagnostics still report ${errors} error${errors === 1 ? '' : 's'}.`)
  return blockers
}

function buildAcceptanceRemediationPrompt(
  originalRequest: string,
  gate: VerificationGateResult | null,
  diagnostics: WorkspaceDiagnosticsSnapshot | null,
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
  const verificationBlocked = gate?.required === true && !gate.passed
  const errorCount = diagnosticsErrors(diagnostics)

  return [
    `Continue the original development request:\n${originalRequest}`,
    'PROJECT ACCEPTANCE REMEDIATION: The runtime cannot accept this development task yet. Fix the blocking evidence below rather than re-declaring completion.',
    errorCount > 0
      ? 'LIVE WORKSPACE DIAGNOSTICS ARE A HARD COMPLETION GATE. Every severity=error finding must be fixed before completion. Do not relabel editor errors as cosmetic, validator preferences, false positives, or non-blocking merely because the browser still renders. If a diagnostic rule or configuration is genuinely wrong for this project, correct that configuration so the live error count reaches zero.'
      : '',
    errorCount > 0 && diagnostics ? formatWorkspaceDiagnostics(diagnostics) : '',
    errorCount > 0
      ? 'Prioritize source/configuration changes that reduce the diagnostics above. Repeating browser inspection, builds, status checks, memory updates, or the same verification command without a relevant mutation does not remediate these errors.'
      : '',
    verificationBlocked
      ? 'The model-defined verification gate is also incomplete, stale, failed, or inconclusive. Use verification.require only when the set of checks genuinely needs revision. Real terminal.exec, launch.run, browser.inspect, diagnostics.check, and agent.review results return verificationCandidateId values; bind the appropriate fresh result with verification.record. The runtime derives pass/fail from real results.'
      : '',
    verificationBlocked && gate ? `Current verification state:\n${formatVerificationGate(gate)}` : '',
    verificationBlocked && gate?.blockers.length
      ? `Verification blockers:\n${gate.blockers.map((blocker) => `- ${blocker}`).join('\n')}`
      : '',
    'If you change source files after a verification check passes, that evidence becomes stale. Re-run only the checks that are necessary after the change.',
    recentEvidence ? `Recent execution evidence:\n${recentEvidence}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function annotateAcceptance(
  result: AgentSessionResult,
  gate: VerificationGateResult | null,
  diagnostics: WorkspaceDiagnosticsSnapshot | null,
  remediationPasses: number,
  state: VerificationState | null,
  plan: LocalPreflightPlan | null,
) {
  const blockers = acceptanceBlockers(gate, diagnostics)
  const summary = {
    ...(result.summary || {}),
    ...(gate
      ? {
          verification: {
            ...gate,
            remediationPasses,
          },
        }
      : {}),
    verificationState: state ? snapshotVerificationState(state) : null,
    taskPreflightPlan: plan,
    workspaceDiagnostics: diagnostics
      ? {
          refreshedAt: diagnostics.refreshed_at,
          analyzedFiles: diagnostics.analyzed_files,
          complete: diagnostics.complete,
          counts: { ...diagnostics.counts },
        }
      : null,
  }

  if (!blockers.length) return { ...result, summary }

  const todos = [...withoutAcceptanceTodos(result.todos)]
  if (gate?.required === true && !gate.passed) {
    todos.push({
      id: VERIFICATION_GATE_TODO_ID,
      text: `Verification gate: ${gate.blockers.join(' ')}`.slice(0, 1200),
      status: 'in_progress',
    })
  }
  const errors = diagnosticsErrors(diagnostics)
  if (errors > 0) {
    todos.push({
      id: DIAGNOSTICS_GATE_TODO_ID,
      text: `Diagnostics gate: ${errors} editor error${errors === 1 ? '' : 's'} remain.`.slice(0, 1200),
      status: 'in_progress',
    })
  }

  return {
    ...result,
    summary,
    todos,
    reply:
      `${String(result.reply || '').trim()}\n\nThe project acceptance gate remains open, so this run is paused rather than marked complete. ${blockers.join(' ')}`.trim(),
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

/** Runs the established project lifecycle, then enforces verification and live editor diagnostics. */
export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  const taskInput = await withModelTaskContract(input)
  const stream_events = withThrottledStreamEvents(withAutomaticApprovalPolicy(withVerificationState(taskInput)))
  const executionInput = stream_events.input
  const state = activeVerificationState(executionInput)
  let priorCompacted = ''

  if (isWorkspaceProjectRun(executionInput)) {
    try {
      priorCompacted = String((await loadChatContext(projectChatId(executionInput)))?.compacted || '')
    } catch {
      priorCompacted = ''
    }
  }

  let combined: AgentSessionResult
  try {
    combined = await runLegacyAgentSession(executionInput)
  } finally {
    stream_events.flush()
  }

  let gate = state ? evaluateVerificationGate(state) : null
  let diagnostics = await currentWorkspaceDiagnostics(executionInput)
  let blockers = acceptanceBlockers(gate, diagnostics)
  let remediationPasses = 0

  while (
    blockers.length > 0 &&
    remediationPasses < MAX_ACCEPTANCE_REMEDIATION_PASSES &&
    !executionInput.abortSignal?.aborted
  ) {
    remediationPasses += 1
    executionInput.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary:
        `Project acceptance requested remediation pass ${remediationPasses}/${MAX_ACCEPTANCE_REMEDIATION_PASSES}: ${blockers.join(' ')}`.slice(
          0,
          1000,
        ),
      at: Date.now(),
    })
    const remediationInput: AgentSessionInput = {
      ...executionInput,
      userInput: buildAcceptanceRemediationPrompt(input.userInput, gate, diagnostics, combined),
      conversation: [...(executionInput.conversation || []), { role: 'assistant', content: combined.reply }].slice(-80),
      todos: withoutAcceptanceTodos(combined.todos),
    }
    let next: AgentSessionResult
    try {
      next = await runLegacyAgentSession(remediationInput)
    } finally {
      stream_events.flush()
    }
    combined = mergeAgentResults(combined, next)
    gate = state ? evaluateVerificationGate(state) : null
    diagnostics = await currentWorkspaceDiagnostics(executionInput)
    blockers = acceptanceBlockers(gate, diagnostics)
  }

  const finalResult = annotateAcceptance(
    combined,
    gate,
    diagnostics,
    remediationPasses,
    state,
    taskPreflightPlan(executionInput),
  )
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
