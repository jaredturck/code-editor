import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import {
  advanceProjectStrategy,
  loadProjectLedger,
  mutateProjectLedger,
  upsertProjectWorkItems,
  type ProjectAgentRole,
  type ProjectLedger,
} from '@/platform/agent/projectLedger'

const REPLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    strategy: { type: 'string' },
    cancelWorkItemIds: { type: 'array', items: { type: 'string' }, maxItems: 80 },
    workItems: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string', enum: ['scout', 'executor', 'orchestrator', 'evaluator'] },
          requirementIds: { type: 'array', items: { type: 'string' }, maxItems: 30 },
          dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 30 },
        },
        required: ['id', 'title', 'description', 'role', 'requirementIds', 'dependsOn'],
      },
    },
  },
  required: ['summary', 'strategy', 'cancelWorkItemIds', 'workItems'],
} as const

function parseJson(value: string): Record<string, any> | null {
  const raw = String(value || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, any>
  } catch {
    return null
  }
}

function compactLedger(ledger: ProjectLedger) {
  return {
    goal: ledger.goal,
    architectureSummary: ledger.architectureSummary,
    currentStrategy: ledger.currentStrategy,
    generation: ledger.generation,
    strategyGeneration: ledger.strategyGeneration,
    requirements: ledger.requirements.map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status,
      acceptanceCriteria: item.acceptanceCriteria,
      evidence: item.evidence.slice(-6),
    })),
    workItems: ledger.workItems.slice(-120).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      role: item.role,
      status: item.status,
      attempts: item.attempts,
      requirementIds: item.requirementIds,
      dependsOn: item.dependsOn,
      blockers: item.blockers,
      resultSummary: item.resultSummary,
    })),
    findings: ledger.evaluatorFindings.filter((item) => item.status === 'open').slice(-60),
    failedApproaches: ledger.failedApproaches.slice(-40),
    lastProgressSummary: ledger.lastProgressSummary,
  }
}

export interface ProjectReplanResult {
  replanned: boolean
  summary: string
  ledger: ProjectLedger
  createdWorkItems: string[]
  cancelledWorkItems: string[]
}

/**
 * Ask a fresh orchestrator context to change decomposition/strategy after a stall. The replanner
 * cannot mutate code; it only edits the durable work graph. Existing verified requirements remain
 * authoritative and completed work is preserved unless explicitly superseded by a new task.
 */
export async function replanProject(
  chatId: string,
  settings: Record<string, any>,
  reasons: string[] = [],
  signal?: AbortSignal,
): Promise<ProjectReplanResult> {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) throw new Error('Project replanning requires a durable project ledger.')

  const response = await runBoundedRoleTask({
    settings,
    preferredRoles: ['orchestrator', 'scout'],
    maxAttempts: 2,
    maxOutputTokens: 3000,
    reasoningEffort: 'medium',
    signal,
    taskLabel: 'project replanning',
    responseSchema: { name: 'project_replan', schema: REPLAN_SCHEMA },
    messages: [
      {
        role: 'system',
        content:
          'Replan a stalled autonomous software project. Preserve verified requirements and useful completed work. Change the approach materially: split oversized tasks, add scout investigation before uncertain implementation, replace failed strategies, or add targeted evaluator work. Do not mutate code and do not invent new product requirements.',
      },
      {
        role: 'user',
        content: JSON.stringify({ project: compactLedger(ledger), stallReasons: reasons }, null, 2).slice(0, 70_000),
      },
    ],
  })

  const parsed = parseJson(response.text)
  if (!parsed) throw new Error('Project replanner returned no parseable plan.')

  const cancelIds = new Set(
    (Array.isArray(parsed.cancelWorkItemIds) ? parsed.cancelWorkItemIds : []).map((item: unknown) => String(item || '').trim()).filter(Boolean),
  )
  let updated = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    draft.workItems = draft.workItems.map((item) =>
      cancelIds.has(item.id) && !['done', 'cancelled'].includes(item.status)
        ? { ...item, status: 'cancelled', taskId: '', blockers: [], updatedAt: Date.now() }
        : item,
    )
  })

  const created: string[] = []
  const workItems = (Array.isArray(parsed.workItems) ? parsed.workItems : []).map((item: any, index: number) => {
    const id = String(item.id || `replan-${updated.strategyGeneration + 1}-${index + 1}`)
    created.push(id)
    return {
      id,
      title: String(item.title || `Replanned work ${index + 1}`),
      description: String(item.description || ''),
      role: (['scout', 'executor', 'orchestrator', 'evaluator'].includes(String(item.role))
        ? item.role
        : 'executor') as ProjectAgentRole,
      requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds : [],
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
      status: Array.isArray(item.dependsOn) && item.dependsOn.length ? 'pending' : 'ready',
    }
  })
  if (workItems.length) updated = upsertProjectWorkItems(chatId, updated.goal, workItems)

  updated = advanceProjectStrategy(
    chatId,
    updated.goal,
    String(parsed.strategy || parsed.summary || 'Replanned stalled project work.').slice(0, 8000),
  )

  return {
    replanned: true,
    summary: String(parsed.summary || 'Project work graph replanned.').slice(0, 5000),
    ledger: updated,
    createdWorkItems: created,
    cancelledWorkItems: [...cancelIds],
  }
}
