import {
  runForcedPlanning,
  type ForcedPlanningArtifact,
  type ForcedPlanningResult,
} from '@/platform/agent/forcedPlanning'
import { buildLocalPreflightPlan, type LocalPreflightPlan } from '@/platform/agent/localPlanner'
import { terminalCommandLikelyMutatesSource } from '@/platform/agent/repetitionAdvisory'
import { runAgentSession as runCoreAgentSession } from '@/platform/agent/runtime/sessionRunner'
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
  runAgentSession as runLegacyAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '@/platform/agentRuntimeLegacy'
import { getChatSessionState, loadChatContext, saveChatSessionState, saveCompacted } from '@/platform/chatSessionStore'
import { waitForProjectImages } from '@/platform/imageGenerationBridge'

const runNativeAgentSession = runCoreAgentSession as unknown as (
  input: AgentSessionInput,
) => Promise<AgentSessionResult>

const VERIFICATION_GATE_TODO_ID = 'verification-gate'
const DIAGNOSTICS_GATE_TODO_ID = 'diagnostics-gate'
const MUTATION_GATE_TODO_ID = 'mutation-gate'
const IMAGE_GATE_TODO_ID = 'image-generation-gate'
const STREAM_EVENT_INTERVAL_MS = 80
const PROJECT_CONTEXT_MAX_CHARS = 4200
const PROJECT_CONTEXT_ACTIONS = 8
const PROJECT_TIMELINE_LIMIT = 240
const PROJECT_PLANNING_LIMIT = 8

type AgentRuntimeEvent = Parameters<NonNullable<AgentSessionInput['onEvent']>>[0]

interface ProjectImageBarrier {
  waited: number
  completed: Array<Record<string, unknown>>
  failed: Array<Record<string, unknown>>
  error?: string
}

class StreamEventCoalescer {
  private pending: AgentRuntimeEvent | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onEvent: NonNullable<AgentSessionInput['onEvent']>,
    private readonly intervalMs: number,
  ) {}

  emit(event: AgentRuntimeEvent) {
    const record = event as unknown as Record<string, unknown>
    if (String(record.type || '').toLowerCase() !== 'stream') {
      this.flush()
      this.onEvent(event)
      return
    }

    const current = this.pending as unknown as Record<string, unknown> | null
    if (this.pending && String(record.step ?? '') !== String(current?.step ?? '')) this.flush()
    const pending = this.pending as unknown as Record<string, unknown> | null
    this.pending = {
      ...(pending || {}),
      ...record,
      delta: `${String(pending?.delta || '')}${String(record.delta || '')}`,
    } as unknown as AgentRuntimeEvent
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const pending = this.pending
    this.pending = null
    if (pending) this.onEvent(pending)
  }
}

export function withThrottledStreamEvents(input: AgentSessionInput, intervalMs = STREAM_EVENT_INTERVAL_MS) {
  if (typeof input.onEvent !== 'function') return { input, flush: () => undefined }
  const coalescer = new StreamEventCoalescer(input.onEvent, Math.max(16, Math.round(intervalMs)))
  return {
    input: { ...input, onEvent: (event: AgentRuntimeEvent) => coalescer.emit(event) },
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
  if (!session || typeof session !== 'object' || Array.isArray(session)) return ''
  return String((session as Record<string, unknown>).id || '').trim()
}

function isWorkspaceProjectRun(input: AgentSessionInput) {
  return Boolean(projectChatId(input) && String(input.settings?.agent_working_dir || '').trim())
}

function taskPreflightPlan(input: AgentSessionInput): LocalPreflightPlan | null {
  const plan = input.settings?.agent_preflight_plan
  return plan && typeof plan === 'object' && !Array.isArray(plan) ? (plan as unknown as LocalPreflightPlan) : null
}

function persistedProjectRun(input: AgentSessionInput) {
  return isWorkspaceProjectRun(input) ? getChatSessionState(projectChatId(input))?.projectRun || null : null
}

function persistedProjectSummary(input: AgentSessionInput) {
  const run = persistedProjectRun(input)
  const summary = run?.runtime_summary || run?.summary
  return summary && typeof summary === 'object' && !Array.isArray(summary) ? (summary as Record<string, unknown>) : null
}

function projectGoal(input: AgentSessionInput) {
  return String(persistedProjectRun(input)?.goal || input.userInput || '').trim()
}

function isResumeProjectRun(input: AgentSessionInput) {
  return /^Resume this project goal from the current files and persisted project ledger\./.test(
    String(input.userInput || '').trim(),
  )
}

export function persistedTaskMatchesInput(input: AgentSessionInput) {
  const goal = String(persistedProjectRun(input)?.goal || '').trim()
  return Boolean(goal && String(input.userInput || '').includes(goal))
}

async function withTaskContract(input: AgentSessionInput): Promise<AgentSessionInput> {
  if (taskPreflightPlan(input) || !String(input.userInput || '').trim()) return input

  const persisted = persistedTaskMatchesInput(input) ? persistedProjectSummary(input)?.taskPreflightPlan : null
  if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
    return { ...input, settings: { ...input.settings, agent_preflight_plan: persisted } }
  }

  try {
    const conversation = (input.conversation || []).map((message) => ({
      role: typeof message.role === 'string' ? message.role : undefined,
      content: message.content,
    }))
    const plan = await buildLocalPreflightPlan(input.userInput, conversation, input.settings, input.abortSignal)
    return plan ? { ...input, settings: { ...input.settings, agent_preflight_plan: plan } } : input
  } catch (error) {
    input.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `Task preflight unavailable; continuing directly (${cleanLine(error instanceof Error ? error.message : error, 160)}).`,
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
  const persisted = input.settings?.agent_verification_state || persistedProjectSummary(input)?.verificationState
  const state = ensureVerificationState(persisted, contractKey, required)
  return { ...input, settings: { ...input.settings, agent_verification_state: state } }
}

export function withAutomaticApprovalPolicy(input: AgentSessionInput): AgentSessionInput {
  if (String(input.settings?.agent_project_run_mode || 'automatic') === 'plan_first') return input
  const original = input.onApprovalRequest
  const bounded = input.settings?.agent_bounded_automatic === true

  return {
    ...input,
    onApprovalRequest: async (request) => {
      const record = request && typeof request === 'object' ? (request as Record<string, unknown>) : {}
      const requestType = String(record.requestType || '').toLowerCase()
      const requestedAction = String(record.requestedAction || '').toLowerCase()

      if (requestType === 'limit') {
        return bounded ? { approved: true, decision: 'continue' } : { approved: true, decision: 'unlimited' }
      }
      if (requestType === 'question' && requestedAction === 'continue the long-running task') {
        return bounded
          ? { approved: false, decision: 'deny', answer: 'Halt', stopped: true }
          : { approved: true, decision: 'continue', answer: 'Continue' }
      }
      if (requestType === 'question' && record.planText) {
        return { approved: true, decision: 'approve', answer: 'Approve' }
      }
      if (requestType === 'question') {
        return { approved: true, decision: 'autonomous', answer: 'Proceed using the current project evidence.' }
      }
      if (typeof original === 'function') return original(request)
      return { approved: false, decision: 'deny' }
    },
  }
}

function activeVerificationState(input: AgentSessionInput): VerificationState | null {
  const state = input.settings?.agent_verification_state
  return state && typeof state === 'object' && !Array.isArray(state) ? (state as unknown as VerificationState) : null
}

function withoutGateTodos(todos: Array<Record<string, unknown>> | undefined) {
  return (Array.isArray(todos) ? todos : []).filter((todo) => {
    const id = String(todo.id || '')
    return ![
      VERIFICATION_GATE_TODO_ID,
      DIAGNOSTICS_GATE_TODO_ID,
      MUTATION_GATE_TODO_ID,
      IMAGE_GATE_TODO_ID,
    ].includes(id)
  })
}

function stepMutatedWorkspace(step: Record<string, unknown>) {
  if (step.ok === false || ['error', 'failed'].includes(String(step.status || '').toLowerCase())) return false
  const tool = String(step.tool || step.requestedTool || '')
  if (['files.write', 'files.edit', 'files.patch', 'image.generate'].includes(tool)) return true
  if (tool !== 'terminal.exec') return false
  const args =
    step.args && typeof step.args === 'object' && !Array.isArray(step.args)
      ? (step.args as Record<string, unknown>)
      : {}
  return terminalCommandLikelyMutatesSource(args.command)
}

function hasSuccessfulMutation(result: AgentSessionResult) {
  return (result.stepHistory || []).some((step) => stepMutatedWorkspace(step))
}

function preservePlanningTimeline(value: Array<Record<string, unknown>>, limit = PROJECT_TIMELINE_LIMIT) {
  const planning = value.filter((event) => String(event.type || '') === 'planning').slice(-PROJECT_PLANNING_LIMIT)
  const activity = value
    .filter((event) => String(event.type || '') !== 'planning')
    .slice(-Math.max(0, limit - planning.length))
  return [...planning, ...activity]
}

function mergeResults(previous: AgentSessionResult, next: AgentSessionResult): AgentSessionResult {
  const artifacts = new Map<string, Record<string, unknown>>()
  for (const artifact of [...(previous.artifacts || []), ...(next.artifacts || [])]) {
    const key = String(
      artifact.id || artifact.artifactId || artifact.path || artifact.filename || JSON.stringify(artifact),
    )
    artifacts.set(key, artifact)
  }
  return {
    ...next,
    timeline: preservePlanningTimeline([...(previous.timeline || []), ...(next.timeline || [])]),
    stepHistory: [...(previous.stepHistory || []), ...(next.stepHistory || [])].slice(-240),
    artifacts: [...artifacts.values()],
    steps: Number(previous.steps || 0) + Number(next.steps || 0),
    todos: Array.isArray(next.todos) ? next.todos : previous.todos,
  }
}

function normalizeStoredPlanningArtifact(value: unknown): ForcedPlanningArtifact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = String(source.id || '').trim()
  const label = String(source.label || '').trim()
  const content = String(source.content || '').trim()
  return id && label && content ? { id, label, content } : null
}

function persistedForcedPlanning(input: AgentSessionInput): ForcedPlanningResult | null {
  const stored = getChatSessionState(projectChatId(input))?.projectPlanning
  if (!stored || String(stored.goal || '').trim() !== projectGoal(input)) return null
  const artifacts = (Array.isArray(stored.artifacts) ? stored.artifacts : [])
    .map(normalizeStoredPlanningArtifact)
    .filter((artifact): artifact is ForcedPlanningArtifact => Boolean(artifact))
  const context = String(stored.context || '').trim()
  if (artifacts.length < 4 || !context) return null
  const at = Number(stored.completedAt) || Date.now()
  return {
    artifacts,
    context,
    timeline: artifacts.map((artifact) => ({
      type: 'planning',
      stage: artifact.id,
      name: artifact.label,
      label: artifact.label,
      summary: artifact.content,
      at,
    })),
  }
}

function persistForcedPlanning(input: AgentSessionInput, planning: ForcedPlanningResult) {
  saveChatSessionState(projectChatId(input), {
    projectPlanning: {
      goal: projectGoal(input),
      artifacts: planning.artifacts.map((artifact) => ({ ...artifact })),
      context: planning.context,
      completedAt: Date.now(),
    },
  })
}

function emitForcedPlanning(input: AgentSessionInput, planning: ForcedPlanningResult) {
  for (const event of planning.timeline) input.onEvent?.({ ...event, at: Date.now() })
}

function withForcedPlanningContext(input: AgentSessionInput, planning: ForcedPlanningResult): AgentSessionInput {
  return {
    ...input,
    conversation: [...(input.conversation || []), { role: 'user', content: planning.context, _injected: true }].slice(
      -50,
    ),
  }
}

function withForcedPlanningResult(result: AgentSessionResult, planning: ForcedPlanningResult): AgentSessionResult {
  return {
    ...result,
    timeline: preservePlanningTimeline([...planning.timeline, ...(result.timeline || [])]),
    summary: {
      ...(result.summary || {}),
      planning: {
        forced: true,
        completed: true,
        stages: planning.artifacts.map((artifact) => ({ ...artifact })),
      },
    },
  }
}

async function currentDiagnostics(input: AgentSessionInput) {
  if (taskPreflightPlan(input)?.developmentTask !== true || !isWorkspaceProjectRun(input)) return null
  try {
    return await getWorkspaceDiagnosticsSnapshot(String(input.settings?.agent_working_dir || ''))
  } catch {
    return null
  }
}

function diagnosticsErrors(snapshot: WorkspaceDiagnosticsSnapshot | null) {
  return Math.max(0, Number(snapshot?.counts.errors || 0))
}

function imageJobKey(job: Record<string, unknown>) {
  return String(job.relativePath || job.path || job.jobId || '').trim()
}

function mergeImageBarriers(previous: ProjectImageBarrier, next: ProjectImageBarrier): ProjectImageBarrier {
  const completed = new Map<string, Record<string, unknown>>()
  const failed = new Map<string, Record<string, unknown>>()

  for (const job of previous.completed) completed.set(imageJobKey(job), job)
  for (const job of previous.failed) failed.set(imageJobKey(job), job)
  for (const job of next.completed) {
    const key = imageJobKey(job)
    completed.set(key, job)
    failed.delete(key)
  }
  for (const job of next.failed) {
    const key = imageJobKey(job)
    failed.set(key, job)
    completed.delete(key)
  }

  return {
    waited: previous.waited + next.waited,
    completed: [...completed.values()],
    failed: [...failed.values()],
    ...(next.error || previous.error ? { error: next.error || previous.error } : {}),
  }
}

async function settleProjectImages(input: AgentSessionInput): Promise<ProjectImageBarrier> {
  const workspaceRoot = String(input.settings?.agent_working_dir || '').trim()
  if (!workspaceRoot) return { waited: 0, completed: [], failed: [] }
  try {
    const result = await waitForProjectImages(workspaceRoot)
    const barrier = {
      waited: Math.max(0, Number(result.waited) || 0),
      completed: Array.isArray(result.completed)
        ? result.completed.map((job) => ({ ...(job as unknown as Record<string, unknown>) }))
        : [],
      failed: Array.isArray(result.failed)
        ? result.failed.map((job) => ({ ...(job as unknown as Record<string, unknown>) }))
        : [],
    }
    if (barrier.waited > 0) {
      input.onEvent?.({
        type: 'notice',
        level: barrier.failed.length ? 'warning' : 'info',
        summary: barrier.failed.length
          ? `Queued image generation finished with ${barrier.failed.length} failed asset${barrier.failed.length === 1 ? '' : 's'}.`
          : `Queued image generation finished: ${barrier.completed.length} asset${barrier.completed.length === 1 ? '' : 's'} saved.`,
        at: Date.now(),
      })
    }
    return barrier
  } catch (error) {
    const message = cleanLine(error instanceof Error ? error.message : error, 300)
    input.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `Queued image generation could not be finalized (${message}).`,
      at: Date.now(),
    })
    return { waited: 0, completed: [], failed: [], error: message }
  }
}

function imageBarrierBlockers(barrier: ProjectImageBarrier) {
  const blockers: string[] = []
  if (barrier.error) blockers.push(`Queued image generation could not be finalized: ${barrier.error}`)
  for (const job of barrier.failed) {
    const target = cleanLine(job.relativePath || job.path || 'queued image asset', 160)
    const error = cleanLine(job.error || 'generation failed', 240)
    blockers.push(`Image generation failed for ${target}: ${error}`)
  }
  return blockers
}

function acceptanceBlockers(
  input: AgentSessionInput,
  result: AgentSessionResult,
  gate: VerificationGateResult | null,
  diagnostics: WorkspaceDiagnosticsSnapshot | null,
  imageBarrier: ProjectImageBarrier,
) {
  const blockers: string[] = []
  const plan = taskPreflightPlan(input)
  if (plan?.workspaceMutationExpected === true && !hasSuccessfulMutation(result)) {
    blockers.push('The required workspace change did not complete.')
  }
  if (gate?.required === true && !gate.passed) blockers.push(...gate.blockers)
  blockers.push(...imageBarrierBlockers(imageBarrier))
  const errors = diagnosticsErrors(diagnostics)
  if (errors > 0) blockers.push(`Workspace diagnostics report ${errors} error${errors === 1 ? '' : 's'}.`)
  return [...new Set(blockers)]
}

function remediationPrompt(
  originalRequest: string,
  input: AgentSessionInput,
  result: AgentSessionResult,
  gate: VerificationGateResult | null,
  diagnostics: WorkspaceDiagnosticsSnapshot | null,
  imageBarrier: ProjectImageBarrier,
) {
  const blockers = acceptanceBlockers(input, result, gate, diagnostics, imageBarrier)
  const parts = [originalRequest, `Fix these blockers:\n${blockers.map((blocker) => `- ${blocker}`).join('\n')}`]
  if (diagnosticsErrors(diagnostics) > 0 && diagnostics) parts.push(formatWorkspaceDiagnostics(diagnostics))
  parts.push('Make the necessary change and verify the affected result.')
  return parts.join('\n\n')
}

function runHitBudget(result: AgentSessionResult) {
  return /time budget|stopped after|halted at the \d+-minute|long-running task.*halt/i.test(String(result.reply || ''))
}

function annotateAcceptance(
  input: AgentSessionInput,
  result: AgentSessionResult,
  gate: VerificationGateResult | null,
  diagnostics: WorkspaceDiagnosticsSnapshot | null,
  imageBarrier: ProjectImageBarrier,
  remediationPasses: number,
  state: VerificationState | null,
) {
  const blockers = acceptanceBlockers(input, result, gate, diagnostics, imageBarrier)
  const plan = taskPreflightPlan(input)
  const summary = {
    ...(result.summary || {}),
    projectRuntime: 'direct-v3',
    taskPreflightPlan: plan,
    verificationState: state ? snapshotVerificationState(state) : null,
    imageGeneration: {
      waited: imageBarrier.waited,
      completed: imageBarrier.completed,
      failed: imageBarrier.failed,
      ...(imageBarrier.error ? { error: imageBarrier.error } : {}),
    },
    ...(gate ? { verification: { ...gate, remediationPasses } } : {}),
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

  const todos = withoutGateTodos(result.todos)
  const errors = diagnosticsErrors(diagnostics)
  if (plan?.workspaceMutationExpected === true && !hasSuccessfulMutation(result)) {
    todos.push({
      id: MUTATION_GATE_TODO_ID,
      text: 'Required workspace change has not completed.',
      status: 'in_progress',
    })
  }
  if (gate?.required === true && !gate.passed) {
    todos.push({
      id: VERIFICATION_GATE_TODO_ID,
      text: `Verification gate: ${gate.blockers.join(' ')}`.slice(0, 1000),
      status: 'in_progress',
    })
  }
  if (imageBarrier.failed.length || imageBarrier.error) {
    todos.push({
      id: IMAGE_GATE_TODO_ID,
      text: `Image generation gate: ${imageBarrierBlockers(imageBarrier).join(' ')}`.slice(0, 1000),
      status: 'in_progress',
    })
  }
  if (errors > 0) {
    todos.push({
      id: DIAGNOSTICS_GATE_TODO_ID,
      text: `Diagnostics gate: ${errors} editor error${errors === 1 ? '' : 's'} remain.`.slice(0, 1000),
      status: 'in_progress',
    })
  }

  return {
    ...result,
    summary,
    todos,
    reply: `${String(result.reply || '').trim()}\n\nProject acceptance is still blocked: ${blockers.join(' ')}`.trim(),
  }
}

function buildProjectContext(input: AgentSessionInput, result: AgentSessionResult) {
  const openTodos = (result.todos || [])
    .filter((todo) => String(todo.status || '').toLowerCase() !== 'done')
    .slice(0, 10)
    .map((todo) => `- ${cleanLine(todo.text || todo.title || '', 180)}`)
    .join('\n')
  const actions = (result.stepHistory || [])
    .slice(-PROJECT_CONTEXT_ACTIONS)
    .map((step) => {
      const tool = String(step.tool || step.requestedTool || 'action')
      const summary = cleanLine(step.summary || step.error || '', 180)
      return `- ${tool}${summary ? `: ${summary}` : ''}`
    })
    .join('\n')

  return [
    '# Project state',
    `Goal: ${cleanLine(input.userInput, 900)}`,
    openTodos ? `## Open\n${openTodos}` : '',
    actions ? `## Recent\n${actions}` : '',
    `## Last result\n${cleanLine(result.reply, 900)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, PROJECT_CONTEXT_MAX_CHARS)
}

function injectPriorContext(input: AgentSessionInput, compacted: string): AgentSessionInput {
  const context = String(compacted || '').trim()
  if (!context || !persistedTaskMatchesInput(input)) return input
  return {
    ...input,
    conversation: [
      { role: 'user', content: `[PROJECT STATE]\n${context.slice(-2600)}`, _injected: true },
      ...(input.conversation || []),
    ].slice(-50),
  }
}

async function runCore(input: AgentSessionInput, flush: () => void): Promise<AgentSessionResult> {
  try {
    return await runNativeAgentSession(input)
  } finally {
    flush()
  }
}

/** One core session plus at most one objective repair session. */
export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  if (!isWorkspaceProjectRun(input)) return runLegacyAgentSession(input)

  const contracted = await withTaskContract(input)
  const verified = withVerificationState(contracted)
  const throttled = withThrottledStreamEvents(withAutomaticApprovalPolicy(verified))
  let executionInput = throttled.input
  const state = activeVerificationState(executionInput)

  try {
    const compacted = String((await loadChatContext(projectChatId(executionInput)))?.compacted || '')
    executionInput = injectPriorContext(executionInput, compacted)
  } catch {
    // Persisted continuity is optional; live project state remains authoritative.
  }

  const resume = isResumeProjectRun(executionInput)
  let planning = resume ? persistedForcedPlanning(executionInput) : null
  if (!planning) {
    if (!resume) saveChatSessionState(projectChatId(executionInput), { projectPlanning: null })
    planning = await runForcedPlanning({
      request: projectGoal(executionInput),
      conversation: (executionInput.conversation || []).map((message) => ({
        role: String(message.role || ''),
        content: message.content,
      })),
      settings: executionInput.settings,
      signal: executionInput.abortSignal,
      onEvent: executionInput.onEvent as ((event: Record<string, unknown>) => void) | undefined,
    })
    persistForcedPlanning(executionInput, planning)
  } else {
    emitForcedPlanning(executionInput, planning)
  }
  executionInput = withForcedPlanningContext(executionInput, planning)

  let combined = withForcedPlanningResult(await runCore(executionInput, throttled.flush), planning)
  let imageBarrier = await settleProjectImages(executionInput)
  let gate = state ? evaluateVerificationGate(state) : null
  let diagnostics = await currentDiagnostics(executionInput)
  let blockers = acceptanceBlockers(executionInput, combined, gate, diagnostics, imageBarrier)
  let remediationPasses = 0

  if (blockers.length && !executionInput.abortSignal?.aborted && !runHitBudget(combined)) {
    remediationPasses = 1
    executionInput.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `Repairing project acceptance: ${blockers.join(' ')}`.slice(0, 600),
      at: Date.now(),
    })

    const remediationInput: AgentSessionInput = {
      ...executionInput,
      userInput: remediationPrompt(input.userInput, executionInput, combined, gate, diagnostics, imageBarrier),
      conversation: [...(executionInput.conversation || []), { role: 'assistant', content: combined.reply }].slice(-40),
      todos: withoutGateTodos(combined.todos),
      settings: {
        ...executionInput.settings,
        agent_tool_repeat_cap: 2,
      },
    }

    const repaired = await runCore(remediationInput, throttled.flush)
    combined = mergeResults(combined, repaired)
    imageBarrier = mergeImageBarriers(imageBarrier, await settleProjectImages(executionInput))
    gate = state ? evaluateVerificationGate(state) : null
    diagnostics = await currentDiagnostics(executionInput)
    blockers = acceptanceBlockers(executionInput, combined, gate, diagnostics, imageBarrier)
  }

  const finalResult = annotateAcceptance(
    executionInput,
    combined,
    gate,
    diagnostics,
    imageBarrier,
    remediationPasses,
    state,
  )
  try {
    await saveCompacted(projectChatId(executionInput), buildProjectContext(executionInput, finalResult))
  } catch (error) {
    executionInput.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `Project checkpoint could not be saved (${cleanLine(error instanceof Error ? error.message : error, 160)}).`,
      at: Date.now(),
    })
  }
  return finalResult
}
