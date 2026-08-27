import { initializeProject } from '@/platform/agent/projectInitializer'
import { dispatchReadyProjectWork } from '@/platform/agent/projectOrchestrator'
import { evaluateProject } from '@/platform/agent/projectEvaluator'
import {
  loadProjectLedger,
  mutateProjectLedger,
  projectLedgerComplete,
  projectLedgerSummary,
  upsertProjectWorkItems,
} from '@/platform/agent/projectLedger'
import {
  applyProjectWatchdogStrategy,
  evaluateProjectProgress,
  snapshotProjectProgress,
  type ProjectProgressSnapshot,
} from '@/platform/agent/projectProgressWatchdog'
import {
  createProjectCheckpoint,
  projectGitAvailable,
} from '@/platform/agent/projectWorkspaceManager'
import { runAgentSession as runProjectSegment } from '@/platform/projectAgentRuntime'
import type { AgentSessionInput, AgentSessionResult } from '@/platform/agentRuntimeLegacy'

const MAX_STALL_GENERATIONS = 6
const MAX_REPAIR_ITEMS_PER_WAVE = 24

function projectChatId(input: AgentSessionInput) {
  const session = input.settings?.chat_session
  if (!session || typeof session !== 'object' || Array.isArray(session)) return ''
  return String((session as Record<string, unknown>).id || '').trim()
}

function workspaceRoot(input: AgentSessionInput) {
  return String(input.settings?.agent_working_dir || '').trim()
}

function mergeResults(previous: AgentSessionResult | null, next: AgentSessionResult): AgentSessionResult {
  if (!previous) return next
  const artifacts = new Map<string, Record<string, unknown>>()
  for (const artifact of [...(previous.artifacts || []), ...(next.artifacts || [])]) {
    const key = String(artifact.id || artifact.artifactId || artifact.path || artifact.filename || JSON.stringify(artifact))
    artifacts.set(key, artifact)
  }
  return {
    ...next,
    timeline: [...(previous.timeline || []), ...(next.timeline || [])].slice(-500),
    stepHistory: [...(previous.stepHistory || []), ...(next.stepHistory || [])].slice(-500),
    artifacts: [...artifacts.values()],
    steps: Number(previous.steps || 0) + Number(next.steps || 0),
    summary: { ...(previous.summary || {}), ...(next.summary || {}) },
  }
}

async function checkpointProject(input: AgentSessionInput, chatId: string, label: string) {
  const root = workspaceRoot(input)
  if (!root) return null
  try {
    if (!(await projectGitAvailable(root))) return null
    const ledger = loadProjectLedger(chatId)
    if (!ledger) return null
    const checkpoint = await createProjectCheckpoint(chatId, ledger.goal, root, label)
    input.onEvent?.({
      type: 'notice',
      level: 'info',
      summary: checkpoint.ref
        ? `Project checkpoint ${label} recorded at generation ${checkpoint.generation}.`
        : `Project checkpoint ${label} recorded; workspace had no snapshot-worthy diff.`,
      at: Date.now(),
    } as any)
    return checkpoint
  } catch (error) {
    input.onEvent?.({
      type: 'notice',
      level: 'warning',
      summary: `Project checkpoint skipped: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700),
      at: Date.now(),
    } as any)
    return null
  }
}

function compactProjectState(chatId: string) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return ''
  const openRequirements = ledger.requirements
    .filter((item) => item.status !== 'verified')
    .slice(0, 40)
    .map((item) => `- ${item.id} [${item.status}]: ${item.text}`)
    .join('\n')
  const activeWork = ledger.workItems
    .filter((item) => !['done', 'cancelled'].includes(item.status))
    .slice(0, 30)
    .map((item) => `- ${item.id} [${item.status}/${item.role}]: ${item.title}${item.blockers.length ? ` — ${item.blockers.join('; ')}` : ''}`)
    .join('\n')
  const findings = ledger.evaluatorFindings
    .filter((item) => item.status === 'open')
    .slice(-20)
    .map((item) => `- ${item.severity.toUpperCase()} ${item.requirementId}: ${item.summary}`)
    .join('\n')

  return [
    '# Durable project ledger',
    `Generation: ${ledger.generation}; strategy: ${ledger.strategyGeneration}`,
    `Current strategy: ${ledger.currentStrategy || 'continue requirements'}`,
    openRequirements ? `## Unverified requirements\n${openRequirements}` : '## Requirements\nAll requirements currently verified.',
    activeWork ? `## Active work\n${activeWork}` : '',
    findings ? `## Open evaluator findings\n${findings}` : '',
    `## Last progress\n${ledger.lastProgressSummary || 'none recorded'}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 12_000)
}

function segmentInput(input: AgentSessionInput, reason: string): AgentSessionInput {
  const chatId = projectChatId(input)
  return {
    ...input,
    userInput: [
      input.userInput,
      compactProjectState(chatId),
      `# Current orchestration directive\n${reason}`,
      'Continue autonomously. Work from live files and the durable ledger. Do not declare the overall project complete unless requirements and evaluator state support it.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    settings: {
      ...input.settings,
      agent_bounded_automatic: false,
    },
  }
}

function materializeEvaluatorRepairs(chatId: string) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return ledger
  const existing = new Set(ledger.workItems.map((item) => item.id))
  const repairs = ledger.evaluatorFindings
    .filter((finding) => finding.status === 'open' && finding.severity === 'error')
    .slice(0, MAX_REPAIR_ITEMS_PER_WAVE)
    .map((finding, index) => {
      const id = `repair-${finding.id || index + 1}`
      if (existing.has(id)) return null
      return {
        id,
        title: `Resolve evaluator finding: ${finding.summary.slice(0, 160)}`,
        description: finding.summary,
        role: 'executor' as const,
        requirementIds: finding.requirementId ? [finding.requirementId] : [],
        dependsOn: [],
        status: 'ready' as const,
      }
    })
    .filter(Boolean) as any[]
  if (!repairs.length) return ledger
  return upsertProjectWorkItems(chatId, ledger.goal, repairs)
}

function markCompletedWorkImplemented(chatId: string) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return null
  return mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const completedRequirementIds = new Set(
      draft.workItems
        .filter((item) => item.status === 'done' && item.role === 'executor')
        .flatMap((item) => item.requirementIds),
    )
    draft.requirements = draft.requirements.map((requirement) =>
      completedRequirementIds.has(requirement.id) && requirement.status === 'pending'
        ? { ...requirement, status: 'implemented', updatedAt: Date.now() }
        : requirement,
    )
  })
}

function retryFailedWork(chatId: string, escalate = false) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return null
  return mutateProjectLedger(chatId, ledger.goal, (draft) => {
    draft.workItems = draft.workItems.map((item) => {
      if (item.status !== 'failed') return item
      const retryLimit = escalate ? 6 : 4
      return item.attempts < retryLimit
        ? { ...item, status: 'ready', taskId: '', blockers: [], updatedAt: Date.now() }
        : { ...item, status: 'blocked', updatedAt: Date.now() }
    })
  })
}

export async function runLongRunningProject(input: AgentSessionInput): Promise<AgentSessionResult> {
  const chatId = projectChatId(input)
  if (!chatId || !workspaceRoot(input)) return runProjectSegment(input)

  const initialized = await initializeProject(chatId, input.userInput, input.settings || {}, input.abortSignal)
  input.onEvent?.({ type: 'notice', level: 'info', summary: initialized.summary, at: Date.now() } as any)
  await checkpointProject(input, chatId, 'project-start')

  let combined: AgentSessionResult | null = null
  let stallGenerations = 0
  let wave = 0
  let previousProgress: ProjectProgressSnapshot | null = initialized.ledger
    ? snapshotProjectProgress(initialized.ledger)
    : null

  while (!input.abortSignal?.aborted) {
    wave += 1
    let ledger = loadProjectLedger(chatId)
    if (!ledger) throw new Error('Long-running project lost its durable ledger.')
    if (projectLedgerComplete(ledger)) break

    let dispatched = 0
    let completed = 0

    try {
      const dispatch = await dispatchReadyProjectWork(chatId, input.settings || {}, {
        maxParallel: 4,
        timeoutMs: 70 * 60_000,
        signal: input.abortSignal,
      })
      dispatched = dispatch.dispatched
      completed = dispatch.completed
      ledger = dispatch.ledger
    } catch (error) {
      input.onEvent?.({
        type: 'notice',
        level: 'warning',
        summary: `Delegated work wave failed; orchestrator will recover: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700),
        at: Date.now(),
      } as any)
    }

    markCompletedWorkImplemented(chatId)
    if (completed > 0) await checkpointProject(input, chatId, `wave-${wave}-integrated`)

    if (!dispatched || !completed) {
      const segment = await runProjectSegment(
        segmentInput(
          input,
          `Project wave ${wave}. Resolve the highest-value unverified requirement or unblock failed work. If implementation is needed, make concrete changes and verify them.`,
        ),
      )
      combined = mergeResults(combined, segment)
      mutateProjectLedger(chatId, input.userInput, (draft) => {
        draft.lastProgressAt = Date.now()
        draft.lastProgressSummary = String(segment.reply || 'Orchestrator segment completed.').slice(0, 5000)
      })
      await checkpointProject(input, chatId, `wave-${wave}-orchestrator`)
    }

    try {
      const evaluation = await evaluateProject(
        chatId,
        input.settings || {},
        {
          verification: combined?.summary?.verification,
          diagnostics: combined?.summary?.workspaceDiagnostics,
          notes: [String(combined?.reply || '').slice(0, 5000)],
        },
        input.abortSignal,
      )
      if (evaluation.accepted) {
        await checkpointProject(input, chatId, `wave-${wave}-accepted`)
        break
      }
      materializeEvaluatorRepairs(chatId)
    } catch (error) {
      input.onEvent?.({
        type: 'notice',
        level: 'warning',
        summary: `Independent evaluation unavailable this wave: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700),
        at: Date.now(),
      } as any)
    }

    ledger = loadProjectLedger(chatId)
    if (!ledger) throw new Error('Long-running project lost its ledger after evaluation.')
    const verdict = evaluateProjectProgress(ledger, previousProgress, stallGenerations)
    previousProgress = verdict.snapshot

    if (verdict.state === 'progressing') stallGenerations = 0
    else if (verdict.state !== 'complete') stallGenerations += 1

    if (verdict.strategyChangeRecommended || stallGenerations >= 2) {
      applyProjectWatchdogStrategy(chatId, {
        ...verdict,
        strategyChangeRecommended: true,
        escalationRecommended: verdict.escalationRecommended || stallGenerations >= 4,
      })
      retryFailedWork(chatId, stallGenerations >= 4)
      await checkpointProject(input, chatId, `wave-${wave}-strategy-reset`)
      input.onEvent?.({
        type: 'notice',
        level: 'warning',
        summary: `Project watchdog changed strategy after ${stallGenerations} stalled wave${stallGenerations === 1 ? '' : 's'}: ${verdict.reasons.join(' ')}`.slice(0, 800),
        at: Date.now(),
      } as any)
    }

    if (stallGenerations >= MAX_STALL_GENERATIONS || verdict.state === 'deep_stall') {
      await checkpointProject(input, chatId, `wave-${wave}-stalled`)
      const stalled = loadProjectLedger(chatId)
      const summary = stalled ? projectLedgerSummary(stalled) : null
      return {
        ...(combined || ({ reply: '', timeline: [], stepHistory: [], artifacts: [], steps: 0, todos: [] } as any)),
        reply: `${String(combined?.reply || '').trim()}\n\nAutonomous project execution paused after sustained lack of durable progress. The project ledger and failed strategy evidence are preserved for resume.`.trim(),
        summary: {
          ...(combined?.summary || {}),
          longRunningProject: summary,
          watchdog: verdict,
          stallGenerations,
          wave,
        },
      }
    }
  }

  const ledger = loadProjectLedger(chatId)
  const complete = Boolean(ledger && projectLedgerComplete(ledger))
  const base = combined || (await runProjectSegment(segmentInput(input, 'Finalize the completed project and report the delivered result.')))
  return {
    ...base,
    reply: complete
      ? `${String(base.reply || '').trim()}\n\nAll durable project requirements are verified.`.trim()
      : String(base.reply || '').trim(),
    summary: {
      ...(base.summary || {}),
      longRunningProject: ledger ? projectLedgerSummary(ledger) : null,
      waves: wave,
      complete,
    },
  }
}
