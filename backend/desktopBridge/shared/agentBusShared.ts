/**
 * Shared, environment-neutral helpers for the renderer and desktop-bridge
 * multi-agent buses. This module deliberately contains no transport, storage,
 * model, HTTP, SSE, Electron, or React logic.
 */

interface AgentTaskBase {
  taskId: string
  priority?: string
  context?: Record<string, unknown>
}

interface AgentRosterEntryBase {
  currentTaskId?: string | null
}

export const AGENT_TASK_RESULT_TTL_MS = 5 * 60 * 1000

export const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  PARTIAL: 'partial',
} as const

export type AgentTaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export const AGENT_STATUS = {
  IDLE: 'idle',
  WORKING: 'working',
  SUSPENDED: 'suspended',
} as const

export type AgentWorkerStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS]

/**
 * Add a task using the existing queue ordering rule: high-priority tasks are
 * placed at the front; every other task is appended.
 */
export function enqueueAgentTask<T extends AgentTaskBase>(queue: T[], task: T) {
  if (task.priority === 'high') {
    queue.unshift(task)
  } else {
    queue.push(task)
  }
  return queue.length
}

/**
 * Remove cached results whose recorded timestamp is older than the supplied
 * lifetime. The maps are mutated in place, matching both existing buses.
 */
export function pruneExpiredTaskResults<T>(
  results: Map<string, T>,
  timestamps: Map<string, number>,
  now = Date.now(),
  ttlMs = AGENT_TASK_RESULT_TTL_MS,
) {
  let removed = 0
  for (const [taskId, timestamp] of timestamps) {
    if (now - timestamp > ttlMs) {
      results.delete(taskId)
      timestamps.delete(taskId)
      removed += 1
    }
  }
  return removed
}

/**
 * Find whether a task is queued, running, or unknown. The two buses historically
 * used different precedence only in the impossible/invalid case where a task is
 * both queued and running, so the option preserves each bus's exact behaviour.
 */
export function findActiveTaskStatus<T extends AgentTaskBase, R extends AgentRosterEntryBase>(
  taskId: string,
  queues: Map<unknown, T[]>,
  roster: Map<unknown, R>,
  { preferRunning = false }: { preferRunning?: boolean } = {},
) {
  let queued = false
  for (const queue of queues.values()) {
    if (queue.some((task) => task.taskId === taskId)) {
      queued = true
      break
    }
  }

  let running = false
  for (const entry of roster.values()) {
    if (entry.currentTaskId === taskId) {
      running = true
      break
    }
  }

  if (preferRunning) {
    return running ? TASK_STATUS.RUNNING : queued ? TASK_STATUS.PENDING : 'unknown'
  }

  return queued ? TASK_STATUS.PENDING : running ? TASK_STATUS.RUNNING : 'unknown'
}

/**
 * Apply a broadcast update to every queued task while retaining each task's
 * existing context. Running and completed tasks are intentionally untouched.
 */
export function applyBroadcastToQueuedTasks<T extends AgentTaskBase>(
  queues: Map<unknown, T[]>,
  message: unknown,
  contextUpdate: Record<string, unknown> = {},
) {
  for (const queue of queues.values()) {
    for (const task of queue) {
      task.context = {
        ...(task.context || {}),
        ...contextUpdate,
        broadcast: message,
      }
    }
  }
}
