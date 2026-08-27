import { resolveAgentIdentity } from '@/platform/agent/agentIdentity'
import {
  loadProjectLedger,
  mutateProjectLedger,
  type ProjectAgentRole,
  type ProjectAgentTaskState,
  type ProjectLedger,
  type ProjectWorkItem,
} from '@/platform/agent/projectLedger'
import { buildSTP, type STPTask, type STPTaskType } from '@/platform/stpBuilder'
import { postTaskBatch, waitForAllTasks } from '@/platform/subAgentRuntime'

export interface ProjectDispatchOptions {
  maxParallel?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProjectDispatchResult {
  dispatched: number
  completed: number
  failed: number
  ledger: ProjectLedger
  taskIds: string[]
}

function roleForRuntime(role: ProjectAgentRole) {
  if (role === 'planner') return 'orchestrator'
  if (role === 'evaluator') return 'overwatcher'
  return role
}

function stpType(role: ProjectAgentRole): STPTaskType {
  if (role === 'scout') return 'discover'
  if (role === 'evaluator') return 'verify'
  return 'execute'
}

function toolsForRole(role: ProjectAgentRole) {
  if (role === 'scout') {
    return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'search.web', 'web.fetch']
  }
  if (role === 'evaluator') {
    return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'terminal.exec', 'diagnostics.check', 'browser.inspect']
  }
  if (role === 'planner' || role === 'orchestrator') {
    return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'terminal.exec', 'diagnostics.check']
  }
  return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'files.write', 'files.edit', 'files.patch', 'terminal.exec', 'diagnostics.check', 'browser.inspect']
}

function dependenciesComplete(item: ProjectWorkItem, ledger: ProjectLedger) {
  if (!item.dependsOn.length) return true
  const byId = new Map(ledger.workItems.map((candidate) => [candidate.id, candidate]))
  return item.dependsOn.every((dependency) => byId.get(dependency)?.status === 'done')
}

function requirementContext(item: ProjectWorkItem, ledger: ProjectLedger) {
  const ids = new Set(item.requirementIds)
  return ledger.requirements
    .filter((requirement) => ids.has(requirement.id))
    .map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptanceCriteria,
      evidence: requirement.evidence.slice(-5),
    }))
}

function resultText(result: any) {
  if (!result) return ''
  if (typeof result.output === 'string') return result.output
  if (typeof result.summary === 'string') return result.summary
  if (typeof result.result === 'string') return result.result
  if (result.output && typeof result.output === 'object') return JSON.stringify(result.output)
  return JSON.stringify(result)
}

function availableWork(ledger: ProjectLedger, maxParallel: number) {
  return ledger.workItems
    .filter((item) => ['pending', 'ready'].includes(item.status))
    .filter((item) => dependenciesComplete(item, ledger))
    .sort((left, right) => {
      const roleRank = (role: ProjectAgentRole) => (role === 'scout' ? 0 : role === 'executor' ? 1 : role === 'orchestrator' ? 2 : 3)
      return roleRank(left.role) - roleRank(right.role) || left.createdAt - right.createdAt
    })
    .slice(0, Math.max(1, maxParallel))
}

function buildTask(item: ProjectWorkItem, ledger: ProjectLedger, settings: Record<string, any>): STPTask {
  const runtimeRole = roleForRuntime(item.role)
  const identity = resolveAgentIdentity(runtimeRole, settings)
  const readOnly = item.role === 'scout' || item.role === 'evaluator'
  return buildSTP({
    type: stpType(item.role),
    goal: item.description || item.title,
    scope: ledger.architectureSummary || ledger.goal,
    constraints: [
      `Work item: ${item.id}`,
      `Project generation: ${ledger.generation}`,
      readOnly ? 'Do not mutate project files.' : 'Make the requested implementation changes in the assigned workspace.',
      'Do not redo work already recorded as complete.',
      'Return concrete evidence, changed files, failures, and remaining blockers.',
    ],
    tools: { available: toolsForRole(item.role), preferred: item.role === 'scout' ? ['search.ripgrep', 'files.read'] : ['files.read', 'files.edit', 'terminal.exec'] },
    budget: {
      // Task contexts stay finite even though the project lifecycle is unbounded.
      maxSteps: item.role === 'scout' ? 16 : 28,
      maxTokens: item.role === 'scout' ? 12000 : 24000,
      timeoutMs: item.role === 'scout' ? 10 * 60_000 : 30 * 60_000,
      maxOutputChars: 12000,
    },
    context: {
      projectId: ledger.projectId,
      workItemId: item.id,
      generation: ledger.generation,
      strategyGeneration: ledger.strategyGeneration,
      requirements: requirementContext(item, ledger),
      recentDecisions: ledger.decisions.slice(-12),
      failedApproaches: ledger.failedApproaches.filter((failed) => failed.workItemId === item.id).slice(-6),
      currentStrategy: ledger.currentStrategy,
      workspaceId: item.workspaceId,
    },
    priority: 'normal',
    toAgent: runtimeRole,
    agentIdentity: identity,
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary'],
    },
  })
}

export async function dispatchReadyProjectWork(
  chatId: string,
  settings: Record<string, any>,
  options: ProjectDispatchOptions = {},
): Promise<ProjectDispatchResult> {
  const initial = loadProjectLedger(chatId)
  if (!initial) throw new Error('Project orchestration requires an initialized ledger.')
  if (options.signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError')

  const items = availableWork(initial, options.maxParallel ?? 4)
  if (!items.length) return { dispatched: 0, completed: 0, failed: 0, ledger: initial, taskIds: [] }

  const tasks = items.map((item) => buildTask(item, initial, settings))
  const taskIds = tasks.map((task) => task.taskId)
  const taskByWork = new Map(items.map((item, index) => [item.id, tasks[index]]))

  let ledger = mutateProjectLedger(chatId, initial.goal, (draft) => {
    const timestamp = Date.now()
    draft.workItems = draft.workItems.map((item) => {
      const task = taskByWork.get(item.id)
      if (!task) return item
      return { ...item, status: 'running', taskId: task.taskId, attempts: item.attempts + 1, updatedAt: timestamp }
    })
    const nextStates: ProjectAgentTaskState[] = items.map((item, index) => {
      const task = tasks[index]
      const runtimeRole = roleForRuntime(item.role)
      const identity = resolveAgentIdentity(runtimeRole, settings)
      return {
        id: task.taskId,
        role: item.role,
        model: identity.model,
        provider: identity.provider,
        status: 'running',
        workItemId: item.id,
        workspaceId: item.workspaceId,
        outputPath: '',
        attempts: item.attempts + 1,
        error: '',
        updatedAt: timestamp,
      }
    })
    draft.agentTasks = [...draft.agentTasks.filter((state) => !taskIds.includes(state.id)), ...nextStates].slice(-500)
  })

  postTaskBatch(tasks)
  const results = await waitForAllTasks(taskIds, options.timeoutMs ?? 35 * 60_000)
  let completed = 0
  let failed = 0

  ledger = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const timestamp = Date.now()
    const resultByTask = new Map(results.map((result: any) => [String(result.taskId || ''), result]))

    draft.workItems = draft.workItems.map((item) => {
      if (!item.taskId || !taskIds.includes(item.taskId)) return item
      const result: any = resultByTask.get(item.taskId)
      const ok = result && ['done', 'success', 'completed'].includes(String(result.status || '').toLowerCase())
      if (ok) completed += 1
      else failed += 1
      return {
        ...item,
        status: ok ? 'done' : 'failed',
        resultSummary: resultText(result).slice(0, 5000),
        blockers: ok ? [] : [String(result?.error || 'Delegated task failed.').slice(0, 1500)],
        updatedAt: timestamp,
      }
    })

    draft.agentTasks = draft.agentTasks.map((state) => {
      if (!taskIds.includes(state.id)) return state
      const result: any = resultByTask.get(state.id)
      const ok = result && ['done', 'success', 'completed'].includes(String(result.status || '').toLowerCase())
      return {
        ...state,
        status: ok ? 'done' : 'failed',
        outputPath: String(result?.outputPath || ''),
        error: ok ? '' : String(result?.error || 'Delegated task failed.').slice(0, 2000),
        updatedAt: timestamp,
      }
    })

    if (completed > 0) {
      draft.lastProgressAt = timestamp
      draft.lastProgressSummary = `${completed} delegated project task${completed === 1 ? '' : 's'} completed.`
    }
  })

  return { dispatched: tasks.length, completed, failed, ledger, taskIds }
}
