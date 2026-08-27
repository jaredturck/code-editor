import { initializeProject } from '@/platform/agent/projectInitializer'
import { dispatchReadyProjectWork } from '@/platform/agent/projectOrchestrator'
import { evaluateProject } from '@/platform/agent/projectEvaluator'
import {
  advanceProjectStrategy,
  loadProjectLedger,
  mutateProjectLedger,
  projectLedgerComplete,
  projectLedgerSummary,
  upsertProjectWorkItems,
} from '@/platform/agent/projectLedger'
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

function progressFingerprint(chatId: string) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return ''
  return JSON.stringify({
    generation: ledger.generation,
    strategyGeneration: ledger.strategyGeneration,
    requirements: ledger.requirements.map((item) => [item.id, item.status, item.evidence.length]),
    work: ledger.workItems.map((item) => [item.id, item.status, item.attempts, item.resultSummary]),
    findings: ledger.evaluatorFindings.map((item) => [item.id, item.status, item.severity]),
  })
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
  const ledgerContext = compactProjectState(chatId)
  return {
    ...input,
    userInput: [
      input.userInput,
      ledgerContext,
      `# Current orchestration directive\n${reason}`,
      'Continue autonomously. Work from live files and the durable ledger. Do not declare the overall project complete unless requirements and evaluator state support it.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    settings: {
      ...input.settings,
      // Project lifetime is unbounded. Individual provider/tool calls retain their own timeout controls.
      agent_session_minutes: 0,
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

function strategyResetWork(chatId: string) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return null
  return mutateProjectLedger(chatId, ledger.goal, (draft) => {
    draft.workItems = draft.workItems.map((item) =>
      item.status === 'failed' && item.attempts < 4
        ? { ...item, status: 'ready', taskId: '', blockers: [], updatedAt: Date.now() }
        : item,
    )
  })
}

/**
 * Outer autonomous lifecycle. The project may span arbitrarily many model contexts.
 * Only abort, completion, or sustained lack of state progress ends the lifecycle.
 */
export async function runLongRunningProject(input: AgentSessionInput): Promise<AgentSessionResult> {
  const chatId = projectChatId(input)
  if (!chatId || !workspaceRoot(input)) return runProjectSegment(input)

  const initialized = await initializeProject(chatId, input.userInput, input.settings || {}, input.abortSignal)
  input.onEvent?.({
    type: 'notice',
    level: 'info',
    summary: initialized.summary,
    at: Date.now(),
  } as any)

  let combined: AgentSessionResult | null = null
  let stallGenerations = 0
  let wave = 0

  while (!input.abortSignal?.aborted) {
    wave += 1
    let ledger = loadProjectLedger(chatId)
    if (!ledger) throw new Error('Long-running project lost its durable ledger.')
    if (projectLedgerComplete(ledger)) break

    const before = progressFingerprint(chatId)
    let dispatched = 0
    let completed = 0

    try {
      const dispatch = await dispatchReadyProjectWork(chatId, input.settings || {}, {
        maxParallel: 4,
        timeoutMs: 35 * 60_000,
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

    // If workers could not make progress, give the primary orchestrator one fresh context to
    // investigate/integrate/replan. This may happen many times across a multi-hour project.
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
    }

    // Semantic acceptance is independent from the implementer. Failure to evaluate should not
    // destroy the project; deterministic verification still exists in the segment runtime.
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
      if (evaluation.accepted) break
      materializeEvaluatorRepairs(chatId)
    } catch (error) {
      input.onEvent?.({
        type: 'notice',
        level: 'warning',
        summary: `Independent evaluation unavailable this wave: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700),
        at: Date.now(),
      } as any)
    }

    const after = progressFingerprint(chatId)
    if (after === before) stallGenerations += 1
    else stallGenerations = 0

    if (stallGenerations >= 2) {
      advanceProjectStrategy(
        chatId,
        input.userInput,
        `Strategy reset after ${stallGenerations} consecutive project waves without durable state progress. Re-localize the blocker, avoid repeated evidence, and choose a materially different approach.`,
      )
      strategyResetWork(chatId)
    }

    if (stallGenerations >= MAX_STALL_GENERATIONS) {
      const stalled = loadProjectLedger(chatId)
      const summary = stalled ? projectLedgerSummary(stalled) : null
      return {
        ...(combined || ({ reply: '', timeline: [], stepHistory: [], artifacts: [], steps: 0, todos: [] } as any)),
        reply: `${String(combined?.reply || '').trim()}\n\nAutonomous project execution paused after sustained lack of durable progress. The project ledger is preserved for resume.`.trim(),
        summary: { ...(combined?.summary || {}), longRunningProject: summary, stallGenerations, wave },
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
