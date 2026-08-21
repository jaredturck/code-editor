/**
 * Defines generous safety rails for agent queues, task registries, event histories,
 * streams, launches, and other in-memory workloads. The helpers bound retained state and
 * report saturation without imposing CPU or memory quotas on individual tasks.
 */

export const WORKLOAD_LIMITS = Object.freeze({
  agentRoster: 32,
  agentQueuePerAgent: 100,
  agentQueueGlobal: 300,
  agentResults: 500,
  agentSsePerAgent: 4,
  agentSseGlobal: 16,
  trainingHistory: 500,
  trainingInbox: 100,
  trainingProposals: 100,
  trainingSse: 8,
});

export class WorkloadLimitError extends Error {
  statusCode: number;
  retryAfterMs: number;

  // Initializes the instance state required by workload limit error.
  constructor(message: string, retryAfterMs = 1000) {
    super(message);
    this.name = 'WorkloadLimitError';
    this.statusCode = 429;
    this.retryAfterMs = retryAfterMs;
  }
}

// Rejects new bridge work when the selected workload counter has reached its configured limit.
export function assertBelowLimit(current: number, limit: number, label: string): void {
  if (current >= limit) {
    throw new WorkloadLimitError(`${label} limit reached`);
  }
}

// Bounds history push before it is retained or returned.
export function boundedHistoryPush<T>(items: T[], item: T, limit: number): number {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
  return items.length;
}

// Counts queued agent tasks across every registered agent.
export function totalQueuedTasks(queues: Map<unknown, unknown[]>): number {
  let total = 0;
  for (const queue of queues.values()) total += Array.isArray(queue) ? queue.length : 0;
  return total;
}

// Counts active agent SSE clients across every registered agent.
export function totalSseClients(clientSets: Map<unknown, Set<unknown>>): number {
  let total = 0;
  for (const clients of clientSets.values()) total += clients?.size || 0;
  return total;
}

// Evaluates whether has queued task for the supplied value and current runtime state.
export function hasQueuedTask(
  queues: Map<unknown, Array<{ taskId?: unknown }>>,
  taskId: string,
): boolean {
  for (const queue of queues.values()) {
    if (queue.some((task) => String(task?.taskId || '') === taskId)) return true;
  }
  return false;
}

// Removes expired or excess oldest map entries so retained in-memory state remains bounded.
export function pruneOldestMapEntries<K, V>(items: Map<K, V>, limit: number): number {
  let removed = 0;
  while (items.size > limit) {
    const oldest = items.keys().next();
    if (oldest.done) break;
    items.delete(oldest.value);
    removed += 1;
  }
  return removed;
}

// Builds the stable bridge response returned when workload bounds are exceeded.
export function workloadErrorResponse(error: unknown): {
  statusCode: number;
  message: string;
  retryAfterMs?: number;
} {
  if (error instanceof WorkloadLimitError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    };
  }
  return { statusCode: 500, message: error instanceof Error ? error.message : 'Workload error' };
}
