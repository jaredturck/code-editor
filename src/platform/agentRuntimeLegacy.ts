/**
 * Exports the stable renderer-facing agent API while the implementation is split across
 * focused runtime modules. This facade keeps existing imports working as the session
 * runner, policy, tools, and finalization code evolve.
 */

import {
  buildAcceptanceRemediationPrompt,
  evaluateAutonomousAcceptance,
  type AutonomousAcceptanceResult,
} from '@/platform/agent/autonomousAcceptance'
import { getToolDefinitions } from '@/platform/agent/toolCatalog'
import { listAgentWriteLeases } from '@/platform/agent/writeLease'
import { startModelHealthMonitor } from '@/platform/agent/modelHealthMonitor'
import { buildLocalPreflightPlan, type LocalPreflightPlan } from '@/platform/agent/localPlanner'
import { runAgentSession as runAgentSessionImpl } from '@/platform/agent/runtime/sessionRunner'
import { getAgentRoster } from '@/platform/subAgentRuntime'
import { loadChatContext, saveCompacted } from '@/platform/chatSessionStore'

export interface AgentSessionInput {
  userInput: string
  screenContext?: string | null
  conversation?: Array<Record<string, unknown>>
  settings: Record<string, unknown>
  todos?: Array<Record<string, unknown>>
  maxSteps?: number | null
  onCheckpoint?: (checkpoint: Record<string, unknown>) => void
  onEvent?: (event: Record<string, unknown>) => void
  onApprovalRequest?: (request: Record<string, unknown>) => unknown | Promise<unknown>
  abortSignal?: AbortSignal | null
}

export interface AgentSessionResult {
  reply: string
  timeline: Array<Record<string, unknown>>
  todos: Array<Record<string, unknown>>
  steps: number
  stepHistory: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  skills: Record<string, unknown>
  reward: unknown
  safety: Record<string, unknown>
  summary: Record<string, unknown>
  contextCompaction?: string
}

type RunAgentSessionImplementation = (input: AgentSessionInput) => Promise<AgentSessionResult>

const PROJECT_CONTEXT_MARKER = '# Autonomous project working context'
const PROJECT_CONTEXT_MAX_CHARS = 12000
const PROJECT_CONTEXT_PRIOR_CHARS = 4000
const PROJECT_CONTEXT_OUTCOME_CHARS = 2400
const PROJECT_CONTEXT_ACTIONS = 24
const ARTIFACT_TOOL = 'artifact.create'
const CLOUD_CONSULT_TOOL = 'cloud.consult'
const AUTONOMOUS_ACCEPTANCE_TODO_ID = 'autonomous-acceptance'
const MAX_ACCEPTANCE_REMEDIATION_PASSES = 2
const ARTIFACT_GUIDANCE = `DURABLE ARTIFACTS: For large outputs that should survive the chat transcript—especially research reports, test reports, architecture/design reports, migration notes, or other long structured results—use artifact.create instead of flooding chat. Use a meaningful filename and summary. If the output exceeds one tool call, append additional chunks to the same artifact. Keep the chat response concise; durable artifact links are attached automatically after the run.`
const HYBRID_GUIDANCE = `HYBRID MODEL EXECUTION: A local model may perform the working loop while the configured cloud responder is reserved for synthesis. Use cloud.consult only for a focused second opinion that materially improves the task; send the minimum relevant evidence, never the entire workspace by default, and stay within the shared cloud request budget. Model routing and failover may switch providers/models during the run; continue from verified tool/RAG state rather than restarting completed work.`

function cleanLine(value: unknown, maxChars = 500) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= maxChars) return clean
  return `${clean.slice(0, maxChars)}…`
}

function projectChatId(input: AgentSessionInput) {
  const session = input.settings?.chat_session
  if (!session || typeof session !== 'object') return ''
  return String((session as Record<string, unknown>).id || '').trim()
}

function isWorkspaceProjectRun(input: AgentSessionInput) {
  return Boolean(projectChatId(input) && String(input.settings?.agent_working_dir || '').trim())
}

function multiAgentEnabled(input: AgentSessionInput) {
  return Boolean(isWorkspaceProjectRun(input) && input.settings?.agent_multi_enabled === true)
}

function taskPreflightPlan(input: AgentSessionInput): LocalPreflightPlan | null {
  const plan = input.settings?.agent_preflight_plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null
  return plan as unknown as LocalPreflightPlan
}

function withoutAcceptanceTodo(todos: Array<Record<string, unknown>> | undefined) {
  return (Array.isArray(todos) ? todos : []).filter((todo) => String(todo.id || '') !== AUTONOMOUS_ACCEPTANCE_TODO_ID)
}

function hasHybridLocalWorker(settings: Record<string, unknown>) {
  if (String(settings.agent_execution_policy || '').toLowerCase() !== 'hybrid') return false
  if (String(settings.ai_provider || '').toLowerCase() === 'local') return false
  const models = Array.isArray(settings.agent_models) ? settings.agent_models : []
  return models.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const model = entry as Record<string, unknown>
    return String(model.provider || '').toLowerCase() === 'local' && Boolean(String(model.model || '').trim())
  })
}

async function withModelTaskContract(input: AgentSessionInput): Promise<AgentSessionInput> {
  if (taskPreflightPlan(input) || !String(input.userInput || '').trim()) return input

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

export function withAutonomousModelExecution(input: AgentSessionInput): AgentSessionInput {
  if (!projectChatId(input) || !hasHybridLocalWorker(input.settings)) return input

  const configured = Array.isArray(input.settings?.agent_tool_allowlist)
    ? input.settings.agent_tool_allowlist.map((tool) => String(tool || '').trim()).filter(Boolean)
    : []
  const allowlist = configured.includes(CLOUD_CONSULT_TOOL) ? configured : [...configured, CLOUD_CONSULT_TOOL]
  const userInput = String(input.userInput || '')

  return {
    ...input,
    userInput: userInput.includes(HYBRID_GUIDANCE) ? userInput : `${userInput}\n\n${HYBRID_GUIDANCE}`,
    settings: {
      ...input.settings,
      agent_tool_allowlist: allowlist,
    },
  }
}

function startAutonomousModelHealth(input: AgentSessionInput) {
  const failover = String(input.settings?.agent_failover_mode || 'limited').toLowerCase()
  const routing = String(input.settings?.agent_model_routing || 'off').toLowerCase()
  if (failover === 'off' && routing !== 'on') return
  try {
    startModelHealthMonitor(input.settings)
  } catch {
    // Health telemetry is advisory; a session must still start if monitoring is unavailable.
  }
}

export function withAutonomousArtifactCapability(input: AgentSessionInput): AgentSessionInput {
  if (!projectChatId(input)) return input

  const configured = Array.isArray(input.settings?.agent_tool_allowlist)
    ? input.settings.agent_tool_allowlist.map((tool) => String(tool || '').trim()).filter(Boolean)
    : []
  const allowlist = configured.includes(ARTIFACT_TOOL) ? configured : [...configured, ARTIFACT_TOOL]
  const userInput = String(input.userInput || '')

  return {
    ...input,
    userInput: userInput.includes(ARTIFACT_GUIDANCE) ? userInput : `${userInput}\n\n${ARTIFACT_GUIDANCE}`,
    settings: {
      ...input.settings,
      agent_tool_allowlist: allowlist,
    },
  }
}

function artifactLink(record: Record<string, unknown>) {
  const id = String(record.artifactId || record.id || '').trim()
  const ref = String(record.artifactRef || record.path || '').trim()
  const filename = cleanLine(record.filename || record.name || 'Artifact', 160) || 'Artifact'
  const href = id ? `artifact:${encodeURIComponent(id)}` : ref.startsWith('/artifacts/') ? ref : ''
  return href ? `- [${filename}](${href})` : ''
}

export function appendArtifactLinks(reply: string, artifacts: Array<Record<string, unknown>>) {
  const links = artifacts.map(artifactLink).filter(Boolean)
  if (!links.length) return reply
  const unique = [...new Set(links)].filter((link) => !reply.includes(link))
  if (!unique.length) return reply
  return `${reply.trim()}\n\n### Durable artifacts\n${unique.join('\n')}`.trim()
}

function decorateArtifacts(result: AgentSessionResult): AgentSessionResult {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : []
  const reply = appendArtifactLinks(String(result.reply || ''), artifacts)
  return reply === result.reply ? result : { ...result, reply }
}

function artifactIdentity(record: Record<string, unknown>) {
  return String(record.id || record.artifactId || record.path || record.filename || JSON.stringify(record))
}

function mergeAgentResults(previous: AgentSessionResult, next: AgentSessionResult): AgentSessionResult {
  const artifacts = new Map<string, Record<string, unknown>>()
  for (const artifact of [...(previous.artifacts || []), ...(next.artifacts || [])]) {
    artifacts.set(artifactIdentity(artifact), artifact)
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

function expectsWorkspaceMutation(input: AgentSessionInput) {
  return Boolean(isWorkspaceProjectRun(input) && taskPreflightPlan(input)?.workspaceMutationExpected === true)
}

function hasSuccessfulWorkspaceMutation(result: AgentSessionResult) {
  return (Array.isArray(result.stepHistory) ? result.stepHistory : []).some((step) => {
    const tool = String(step.tool || step.requestedTool || '').trim()
    const status = String(step.status || '').toLowerCase()
    return (
      ['files.write', 'files.edit', 'files.patch'].includes(tool) &&
      step.ok !== false &&
      !['error', 'failed'].includes(status)
    )
  })
}

function formatExecutionEvidence(result: AgentSessionResult, limit = 12) {
  const history = Array.isArray(result.stepHistory) ? result.stepHistory : []
  if (!history.length) return '- No tool actions were recorded.'
  return history
    .slice(-limit)
    .map((step, index) => {
      const tool = String(step.tool || step.requestedTool || 'unknown')
      const args = step.args && typeof step.args === 'object' ? (step.args as Record<string, unknown>) : {}
      const target = cleanLine(args.path || args.command || args.query || step.path || '', 240)
      const outcome =
        step.ok === false
          ? `FAILED: ${cleanLine(step.error || step.summary || 'unknown error', 500)}`
          : `OK: ${cleanLine(step.summary || 'completed', 500)}`
      return `${index + 1}. ${tool}${target ? ` (${target})` : ''} — ${outcome}`
    })
    .join('\n')
}

function formatSuccessCriteria(plan: LocalPreflightPlan | null) {
  if (!plan?.successCriteria?.length) return ''
  return plan.successCriteria.map((criterion) => `- ${cleanLine(criterion, 400)}`).join('\n')
}

function buildRecoveryContinuation(
  originalRequest: string,
  result: AgentSessionResult,
  plan: LocalPreflightPlan | null,
) {
  const successCriteria = formatSuccessCriteria(plan)
  return [
    'Continue the original request from the evidence already gathered. The model-defined task contract says the requested workspace change is still required.',
    'Diagnose why progress stalled using the exact tool outcomes below, then decide the next action yourself. Do not blindly repeat an unchanged failed action; retry only when you have a concrete reason the outcome may now differ.',
    'Reconcile any stale TODOs if the evidence invalidated an earlier assumption. Do not claim success unless the requested workspace work actually completes.',
    `Original request:\n${originalRequest}`,
    successCriteria ? `Model-defined success criteria:\n${successCriteria}` : '',
    `Execution evidence from the previous attempt:\n${formatExecutionEvidence(result)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildDevelopmentCompletionCheckpoint(
  originalRequest: string,
  result: AgentSessionResult,
  plan: LocalPreflightPlan | null,
) {
  const todos = formatTodoState(Array.isArray(result.todos) ? result.todos : [])
  const successCriteria = formatSuccessCriteria(plan)
  return [
    'SOFTWARE DEVELOPMENT COMPLETION CHECKPOINT: Reassess the work before this project run is allowed to finish.',
    'Use your own software-engineering judgment. Decide whether the requested implementation is genuinely complete and adequately verified in the project that actually exists. Do not assume a language, framework, package manager, test command, or environment from this instruction.',
    'If verification is missing or weak, continue working now: inspect the current project/environment as needed, choose the appropriate run/build/test/lint/import or other validation for this ecosystem, and execute it. If validation fails, reason from the exact failure, choose and implement the most appropriate fix, then verify again. The next action and any fix must come from your reasoning, not from a hard-coded recovery recipe.',
    'If the evidence already demonstrates that the requested work is complete and sufficiently verified, do not redo completed work; return a concise final summary grounded in that evidence.',
    `Original request:\n${originalRequest}`,
    successCriteria ? `Model-defined success criteria:\n${successCriteria}` : '',
    todos ? `Current TODO state:\n${todos}` : '',
    `Execution evidence so far:\n${formatExecutionEvidence(result, 24)}`,
    `Previous completion summary:\n${cleanLine(result.reply, 1800)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function shouldRunDevelopmentCompletionCheckpoint(input: AgentSessionInput, result: AgentSessionResult) {
  const plan = taskPreflightPlan(input)
  if (!plan || !isWorkspaceProjectRun(input) || input.abortSignal?.aborted) return false
  if (plan.developmentTask !== true || plan.verificationRequired !== true) return false
  if (plan.workspaceMutationExpected === true && !hasSuccessfulWorkspaceMutation(result)) return false
  return true
}

function shouldRequireIndependentReview(input: AgentSessionInput, result: AgentSessionResult) {
  const mode = String(input.settings?.agent_peer_review || 'off').toLowerCase()
  if (mode === 'always') return true
  if (mode !== 'suggested') return false

  const mutationPaths = new Set(
    (Array.isArray(result.stepHistory) ? result.stepHistory : [])
      .filter((step) =>
        ['files.write', 'files.edit', 'files.patch'].includes(String(step.tool || step.requestedTool || '')),
      )
      .filter((step) => step.ok !== false && !['error', 'failed'].includes(String(step.status || '').toLowerCase()))
      .map((step) => {
        const args = step.args && typeof step.args === 'object' ? (step.args as Record<string, unknown>) : {}
        return String(args.path || step.path || '').trim()
      })
      .filter(Boolean),
  )
  const delegated = (Array.isArray(result.stepHistory) ? result.stepHistory : []).some((step) =>
    ['agent.delegate', 'agent.recall', 'agent.recallAll'].includes(String(step.tool || step.requestedTool || '')),
  )

  return delegated || mutationPaths.size > 1
}

function evaluateResultAcceptance(input: AgentSessionInput, result: AgentSessionResult) {
  return evaluateAutonomousAcceptance({
    multi_agent_enabled: multiAgentEnabled(input),
    require_independent_review: shouldRequireIndependentReview(input, result),
    todos: Array.isArray(result.todos) ? result.todos : [],
    step_history: Array.isArray(result.stepHistory) ? result.stepHistory : [],
    timeline: Array.isArray(result.timeline) ? result.timeline : [],
    active_agents: getAgentRoster() as unknown as Array<Record<string, unknown>>,
    write_leases: listAgentWriteLeases(),
  })
}

function annotateAcceptance(
  result: AgentSessionResult,
  acceptance: AutonomousAcceptanceResult,
  remediation_passes: number,
) {
  const summary = {
    ...(result.summary || {}),
    acceptance: {
      ...acceptance,
      remediationPasses: remediation_passes,
    },
  }
  if (acceptance.accepted) return { ...result, summary }

  const existing = withoutAcceptanceTodo(result.todos)
  return {
    ...result,
    summary,
    todos: [
      ...existing,
      {
        id: AUTONOMOUS_ACCEPTANCE_TODO_ID,
        text: `Autonomous acceptance gate: ${acceptance.blockers.join(' ')}`.slice(0, 1200),
        status: 'in_progress',
      },
    ],
    reply:
      `${String(result.reply || '').trim()}\n\nThe autonomous acceptance gate remains open, so this run is paused rather than marked complete. ${acceptance.blockers.join(' ')}`.trim(),
  }
}

async function runWithAutonomousAcceptance(input: AgentSessionInput): Promise<AgentSessionResult> {
  const clean_input = {
    ...input,
    todos: withoutAcceptanceTodo(input.todos),
  }
  let current_input = clean_input
  let combined = await (runAgentSessionImpl as RunAgentSessionImplementation)(current_input)

  if (
    expectsWorkspaceMutation(clean_input) &&
    !hasSuccessfulWorkspaceMutation(combined) &&
    !clean_input.abortSignal?.aborted
  ) {
    const correctionInput: AgentSessionInput = {
      ...clean_input,
      userInput: buildRecoveryContinuation(clean_input.userInput, combined, taskPreflightPlan(clean_input)),
      conversation: [...(clean_input.conversation || []), { role: 'assistant', content: combined.reply }].slice(-80),
      todos: withoutAcceptanceTodo(combined.todos),
    }
    const corrected = await (runAgentSessionImpl as RunAgentSessionImplementation)(correctionInput)
    combined = mergeAgentResults(combined, corrected)

    if (!hasSuccessfulWorkspaceMutation(combined)) {
      combined = {
        ...combined,
        reply:
          'I did not make the workspace change that the AI task preflight identified as required because no file mutation completed successfully.',
      }
    }
  }

  if (shouldRunDevelopmentCompletionCheckpoint(clean_input, combined)) {
    clean_input.onEvent?.({
      type: 'notice',
      level: 'info',
      summary: 'Reviewing implementation and verification evidence against the AI-defined task contract.',
      at: Date.now(),
    })
    const checkpointInput: AgentSessionInput = {
      ...clean_input,
      userInput: buildDevelopmentCompletionCheckpoint(clean_input.userInput, combined, taskPreflightPlan(clean_input)),
      conversation: [...(clean_input.conversation || []), { role: 'assistant', content: combined.reply }].slice(-80),
      todos: withoutAcceptanceTodo(combined.todos),
    }
    const checked = await (runAgentSessionImpl as RunAgentSessionImplementation)(checkpointInput)
    combined = mergeAgentResults(combined, checked)
  }

  if (!multiAgentEnabled(clean_input) || clean_input.abortSignal?.aborted) {
    return combined
  }

  let conversation = [...(clean_input.conversation || [])]
  let remediation_passes = 0

  while (remediation_passes < MAX_ACCEPTANCE_REMEDIATION_PASSES) {
    const acceptance = evaluateResultAcceptance(clean_input, combined)
    if (acceptance.accepted || clean_input.abortSignal?.aborted) {
      return annotateAcceptance(combined, acceptance, remediation_passes)
    }

    remediation_passes += 1
    const remediation = `${buildAcceptanceRemediationPrompt(acceptance)}\n\nExecution evidence from earlier attempts:\n${formatExecutionEvidence(combined)}\n\nUse this evidence to reason about what remains. Reconcile stale TODOs or assumptions as needed instead of repeating failed actions without a reason.`
    clean_input.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary:
        `Autonomous acceptance gate requested remediation pass ${remediation_passes}/${MAX_ACCEPTANCE_REMEDIATION_PASSES}: ${acceptance.blockers.join(' ')}`.slice(
          0,
          1000,
        ),
      at: Date.now(),
    })

    conversation = [
      ...conversation,
      { role: 'user', content: current_input.userInput },
      { role: 'assistant', content: combined.reply },
    ].slice(-80)
    current_input = {
      ...clean_input,
      userInput: remediation,
      conversation,
      todos: withoutAcceptanceTodo(combined.todos),
    }
    const next = await (runAgentSessionImpl as RunAgentSessionImplementation)(current_input)
    combined = mergeAgentResults(combined, next)
  }

  return annotateAcceptance(combined, evaluateResultAcceptance(clean_input, combined), remediation_passes)
}

export function isProjectWorkingContext(value: unknown) {
  return String(value || '')
    .trimStart()
    .startsWith(PROJECT_CONTEXT_MARKER)
}

function previousProjectContext(value: unknown) {
  const clean = String(value || '').trim()
  if (!clean) return ''
  const withoutMarker = isProjectWorkingContext(clean) ? clean.slice(clean.indexOf('\n') + 1).trim() : clean
  if (withoutMarker.length <= PROJECT_CONTEXT_PRIOR_CHARS) return withoutMarker
  return withoutMarker.slice(-PROJECT_CONTEXT_PRIOR_CHARS)
}

function formatTodoState(todos: Array<Record<string, unknown>>) {
  return todos
    .slice(0, 30)
    .map((todo) => {
      const status = cleanLine(todo.status || 'pending', 40)
      const text = cleanLine(todo.text || todo.title || '', 300)
      return text ? `- [${status}] ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function formatRecentActions(stepHistory: Array<Record<string, unknown>>) {
  return stepHistory
    .slice(-PROJECT_CONTEXT_ACTIONS)
    .map((step) => {
      const status = step.ok === false ? 'error' : 'ok'
      const tool = cleanLine(step.tool || step.requestedTool || 'action', 80)
      const detail = cleanLine(step.summary || step.error || '', 520)
      return `- [${status}] ${tool}${detail ? ` — ${detail}` : ''}`
    })
    .join('\n')
}

export function buildProjectWorkingContext(input: AgentSessionInput, result: AgentSessionResult, priorCompacted = '') {
  const prior = previousProjectContext(priorCompacted)
  const todos = formatTodoState(Array.isArray(result.todos) ? result.todos : [])
  const actions = formatRecentActions(Array.isArray(result.stepHistory) ? result.stepHistory : [])
  const outcome = String(result.reply || '')
    .trim()
    .slice(0, PROJECT_CONTEXT_OUTCOME_CHARS)
  const runSummary =
    result.summary && typeof result.summary === 'object' ? JSON.stringify(result.summary).slice(0, 1800) : ''

  const sections = [
    PROJECT_CONTEXT_MARKER,
    `Goal: ${cleanLine(input.userInput, 1600) || '(not recorded)'}`,
    prior ? `\n## Prior carried context\n${prior}` : '',
    todos ? `\n## Current TODO state\n${todos}` : '',
    actions ? `\n## Recent verified actions\n${actions}` : '',
    runSummary ? `\n## Runtime checkpoint\n${runSummary}` : '',
    outcome ? `\n## Latest outcome\n${outcome}` : '',
    '\nThis context is an automatic checkpoint from the autonomous project run. Treat newer live-file reads, RAG evidence, diagnostics, and explicit user instructions as authoritative when they conflict with it.',
  ].filter(Boolean)

  return sections.join('\n').slice(0, PROJECT_CONTEXT_MAX_CHARS)
}

function conversationHasProjectContext(conversation: Array<Record<string, unknown>>) {
  return conversation.some((message) => String(message?.content || '').includes(PROJECT_CONTEXT_MARKER))
}

function injectProjectWorkingContext(conversation: Array<Record<string, unknown>>, compacted: string) {
  if (!isProjectWorkingContext(compacted) || conversationHasProjectContext(conversation)) {
    return conversation
  }
  return [
    {
      role: 'user',
      content: `[AUTONOMOUS PROJECT CONTEXT]\n\n${compacted}\n\nContinue the current project from this checkpoint. Refresh stale details with rag.retrieve or live file reads before acting.`,
      _injected: true,
    },
    {
      role: 'assistant',
      content:
        'Understood. I will continue from the project checkpoint and verify live evidence before making changes.',
      _injected: true,
    },
    ...conversation,
  ]
}

async function loadProjectWorkingContext(input: AgentSessionInput) {
  const chatId = projectChatId(input)
  if (!chatId) return ''
  const context = await loadChatContext(chatId)
  return String(context?.compacted || '')
}

async function persistProjectWorkingContext(
  input: AgentSessionInput,
  result: AgentSessionResult,
  priorCompacted: string,
) {
  const chatId = projectChatId(input)
  if (!chatId || !isWorkspaceProjectRun(input)) return ''
  const compacted = buildProjectWorkingContext(input, result, priorCompacted)
  await saveCompacted(chatId, compacted)
  return compacted
}

// Runs one complete agent session, including model calls, tool execution, approvals, limits,
// persistence, finalization, and the multi-agent acceptance/remediation gate.
export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  const taskInput = await withModelTaskContract(input)
  const executionInput = withAutonomousModelExecution(taskInput)
  const artifactInput = withAutonomousArtifactCapability(executionInput)
  startAutonomousModelHealth(artifactInput)
  let priorCompacted = ''
  let sessionInput = artifactInput

  if (isWorkspaceProjectRun(artifactInput)) {
    try {
      priorCompacted = await loadProjectWorkingContext(artifactInput)
      if (isProjectWorkingContext(priorCompacted)) {
        sessionInput = {
          ...artifactInput,
          conversation: injectProjectWorkingContext(artifactInput.conversation || [], priorCompacted),
        }
      }
    } catch (error) {
      input.onEvent?.({
        type: 'notice',
        level: 'error',
        summary: `Project working context could not be restored; continuing from chat history and persisted TODO state (${cleanLine(error instanceof Error ? error.message : error, 180)}).`,
        at: Date.now(),
      })
    }
  }

  const result = decorateArtifacts(await runWithAutonomousAcceptance(sessionInput))

  if (!isWorkspaceProjectRun(artifactInput)) return result

  try {
    const contextCompaction = await persistProjectWorkingContext(artifactInput, result, priorCompacted)
    return contextCompaction ? { ...result, contextCompaction } : result
  } catch (error) {
    input.onEvent?.({
      type: 'notice',
      level: 'error',
      summary: `Project working context could not be checkpointed; the encrypted transcript and TODO state remain available (${cleanLine(error instanceof Error ? error.message : error, 180)}).`,
      at: Date.now(),
    })
    return result
  }
}

// Returns agent tool definitions without requiring callers to know where or how it is stored.
export function getAgentToolDefinitions() {
  return getToolDefinitions()
}
