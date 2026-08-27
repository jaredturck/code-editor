import {
  loadProjectLedger,
  mutateProjectLedger,
  type ProjectFailedApproach,
  type ProjectLedger,
  type ProjectWorkItem,
} from '@/platform/agent/projectLedger'

const TERMINAL_DEPENDENCY_STATES = new Set(['failed', 'blocked', 'cancelled'])

function dependencyBlocker(item: ProjectWorkItem, ledger: ProjectLedger) {
  const byId = new Map(ledger.workItems.map((candidate) => [candidate.id, candidate]))
  for (const dependencyId of item.dependsOn) {
    const dependency = byId.get(dependencyId)
    if (!dependency) return `Dependency ${dependencyId} is missing from the project work graph.`
    if (TERMINAL_DEPENDENCY_STATES.has(dependency.status)) {
      return `Dependency ${dependencyId} is ${dependency.status}.`
    }
  }
  return ''
}

function dependenciesDone(item: ProjectWorkItem, ledger: ProjectLedger) {
  if (!item.dependsOn.length) return true
  const byId = new Map(ledger.workItems.map((candidate) => [candidate.id, candidate]))
  return item.dependsOn.every((dependencyId) => byId.get(dependencyId)?.status === 'done')
}

function dependencyOnlyBlockers(item: ProjectWorkItem) {
  return item.blockers.length > 0 && item.blockers.every((blocker) => /^Dependency\s+/i.test(blocker))
}

function failureSignature(item: ProjectWorkItem) {
  const source = [item.blockers.join(' | '), item.resultSummary].filter(Boolean).join(' :: ').trim()
  return source.toLowerCase().replace(/\s+/g, ' ').slice(0, 1000)
}

function failedApproach(item: ProjectWorkItem): ProjectFailedApproach | null {
  const signature = failureSignature(item)
  if (!signature) return null
  return {
    id: `failed-${item.id}-${Date.now().toString(36)}`,
    workItemId: item.id,
    summary: [item.title, item.blockers.join('; '), item.resultSummary].filter(Boolean).join(' — ').slice(0, 5000),
    failureSignature: signature,
    files: [],
    createdAt: Date.now(),
  }
}

/**
 * Normalize dependency state before each orchestration wave. This prevents pending tasks from
 * becoming immortal when a prerequisite permanently fails and promotes dependency-ready work
 * without asking a model to maintain queue state.
 */
export function normalizeProjectWorkGraph(chatId: string): ProjectLedger | null {
  const current = loadProjectLedger(chatId)
  if (!current) return null

  return mutateProjectLedger(chatId, current.goal, (draft) => {
    const snapshot: ProjectLedger = { ...draft, workItems: [...draft.workItems] }
    draft.workItems = draft.workItems.map((item) => {
      if (item.status === 'done' || item.status === 'cancelled' || item.status === 'running' || item.status === 'failed') {
        return item
      }

      const blocker = dependencyBlocker(item, snapshot)
      if (blocker) {
        return {
          ...item,
          status: 'blocked',
          blockers: Array.from(new Set([...item.blockers.filter((value) => !/^Dependency\s+/i.test(value)), blocker])).slice(0, 20),
          updatedAt: Date.now(),
        }
      }

      if (dependenciesDone(item, snapshot)) {
        if (item.status === 'pending' || (item.status === 'blocked' && dependencyOnlyBlockers(item))) {
          return {
            ...item,
            status: 'ready',
            blockers: item.blockers.filter((value) => !/^Dependency\s+/i.test(value)),
            updatedAt: Date.now(),
          }
        }
      }
      return item
    })

    const knownFailures = new Set(draft.failedApproaches.map((item) => `${item.workItemId}:${item.failureSignature}`))
    for (const item of draft.workItems) {
      if (item.status !== 'failed' && item.status !== 'blocked') continue
      const failure = failedApproach(item)
      if (!failure) continue
      const key = `${failure.workItemId}:${failure.failureSignature}`
      if (knownFailures.has(key)) continue
      knownFailures.add(key)
      draft.failedApproaches.push(failure)
    }
    draft.failedApproaches = draft.failedApproaches.slice(-300)
  })
}

export function projectWorkGraphStats(ledger: ProjectLedger) {
  const counts: Record<string, number> = {}
  for (const item of ledger.workItems) counts[item.status] = (counts[item.status] || 0) + 1
  return {
    total: ledger.workItems.length,
    counts,
    ready: counts.ready || 0,
    running: counts.running || 0,
    blocked: counts.blocked || 0,
    failed: counts.failed || 0,
    done: counts.done || 0,
  }
}
