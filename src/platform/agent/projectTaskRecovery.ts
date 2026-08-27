import { loadProjectLedger, mutateProjectLedger, type ProjectLedger } from '@/platform/agent/projectLedger'

export interface ProjectRecoveryResult {
  recovered: boolean
  recoveredWorkItems: string[]
  recoveredAgentTasks: string[]
  ledger: ProjectLedger | null
}

/**
 * Reconciles durable orchestration state after renderer/process restart. In-memory waiter/queue
 * state is intentionally not trusted across restart; running tasks become ready for redispatch
 * while completed/failed durable records remain historical evidence.
 */
export function recoverInterruptedProjectTasks(chatId: string): ProjectRecoveryResult {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) return { recovered: false, recoveredWorkItems: [], recoveredAgentTasks: [], ledger: null }

  const recoveredWorkItems: string[] = []
  const recoveredAgentTasks: string[] = []
  const activeTaskIds = new Set(
    ledger.agentTasks.filter((task) => task.status === 'running').map((task) => task.id),
  )

  if (!activeTaskIds.size && !ledger.workItems.some((item) => item.status === 'running')) {
    return { recovered: false, recoveredWorkItems, recoveredAgentTasks, ledger }
  }

  const updated = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const timestamp = Date.now()
    draft.agentTasks = draft.agentTasks.map((task) => {
      if (task.status !== 'running') return task
      recoveredAgentTasks.push(task.id)
      return {
        ...task,
        status: 'failed',
        error: 'Execution process restarted before this task produced a durable terminal result.',
        updatedAt: timestamp,
      }
    })

    draft.workItems = draft.workItems.map((item) => {
      if (item.status !== 'running') return item
      recoveredWorkItems.push(item.id)
      return {
        ...item,
        status: item.attempts >= 6 ? 'blocked' : 'ready',
        taskId: '',
        blockers:
          item.attempts >= 6
            ? [...item.blockers, 'Repeated interrupted attempts require orchestrator strategy change.'].slice(-20)
            : [],
        updatedAt: timestamp,
      }
    })

    draft.lastProgressSummary = recoveredWorkItems.length
      ? `Recovered ${recoveredWorkItems.length} interrupted work item${recoveredWorkItems.length === 1 ? '' : 's'} after runtime restart.`
      : draft.lastProgressSummary
    draft.updatedAt = timestamp
  })

  return { recovered: true, recoveredWorkItems, recoveredAgentTasks, ledger: updated }
}
