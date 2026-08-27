import { advanceProjectStrategy, loadProjectLedger, mutateProjectLedger, type ProjectLedger } from '@/platform/agent/projectLedger'

export interface ProjectProgressSnapshot {
  at: number
  generation: number
  strategyGeneration: number
  verifiedRequirements: number
  implementedRequirements: number
  blockedRequirements: number
  completedWorkItems: number
  failedWorkItems: number
  openErrorFindings: number
  activeWorkItems: number
  failureSignature: string
  progressSignature: string
}

export interface ProjectWatchdogVerdict {
  state: 'progressing' | 'idle' | 'stalled' | 'deep_stall' | 'complete'
  score: number
  reasons: string[]
  strategyChangeRecommended: boolean
  escalationRecommended: boolean
  snapshot: ProjectProgressSnapshot
}

function failureSignature(ledger: ProjectLedger) {
  return [
    ...ledger.workItems
      .filter((item) => item.status === 'failed' || item.status === 'blocked')
      .map((item) => `${item.id}:${item.blockers.join('|')}`),
    ...ledger.evaluatorFindings
      .filter((finding) => finding.status === 'open' && finding.severity === 'error')
      .map((finding) => `${finding.requirementId}:${finding.summary}`),
  ]
    .sort()
    .join('||')
    .slice(0, 12_000)
}

export function snapshotProjectProgress(ledger: ProjectLedger): ProjectProgressSnapshot {
  const verifiedRequirements = ledger.requirements.filter((item) => item.status === 'verified').length
  const implementedRequirements = ledger.requirements.filter((item) => item.status === 'implemented').length
  const blockedRequirements = ledger.requirements.filter((item) => item.status === 'blocked').length
  const completedWorkItems = ledger.workItems.filter((item) => item.status === 'done').length
  const failedWorkItems = ledger.workItems.filter((item) => item.status === 'failed').length
  const openErrorFindings = ledger.evaluatorFindings.filter(
    (item) => item.status === 'open' && item.severity === 'error',
  ).length
  const activeWorkItems = ledger.workItems.filter((item) => ['ready', 'running', 'pending'].includes(item.status)).length
  const failures = failureSignature(ledger)
  const progressSignature = [
    ledger.generation,
    ledger.strategyGeneration,
    verifiedRequirements,
    implementedRequirements,
    blockedRequirements,
    completedWorkItems,
    failedWorkItems,
    openErrorFindings,
    activeWorkItems,
    failures,
  ].join('::')

  return {
    at: Date.now(),
    generation: ledger.generation,
    strategyGeneration: ledger.strategyGeneration,
    verifiedRequirements,
    implementedRequirements,
    blockedRequirements,
    completedWorkItems,
    failedWorkItems,
    openErrorFindings,
    activeWorkItems,
    failureSignature: failures,
    progressSignature,
  }
}

function delta(current: number, previous: number) {
  return Number(current || 0) - Number(previous || 0)
}

export function evaluateProjectProgress(
  ledger: ProjectLedger,
  previous: ProjectProgressSnapshot | null,
  stalledWaves = 0,
): ProjectWatchdogVerdict {
  const snapshot = snapshotProjectProgress(ledger)
  const reasons: string[] = []
  let score = 0

  if (ledger.requirements.length > 0 && ledger.requirements.every((item) => item.status === 'verified')) {
    return {
      state: snapshot.openErrorFindings ? 'idle' : 'complete',
      score: 100,
      reasons: snapshot.openErrorFindings ? ['Requirements verified but evaluator errors remain open.'] : ['All requirements verified.'],
      strategyChangeRecommended: false,
      escalationRecommended: false,
      snapshot,
    }
  }

  if (!previous) {
    return {
      state: 'idle',
      score: 0,
      reasons: ['Baseline project progress snapshot created.'],
      strategyChangeRecommended: false,
      escalationRecommended: false,
      snapshot,
    }
  }

  const verifiedDelta = delta(snapshot.verifiedRequirements, previous.verifiedRequirements)
  const implementedDelta = delta(snapshot.implementedRequirements, previous.implementedRequirements)
  const completedWorkDelta = delta(snapshot.completedWorkItems, previous.completedWorkItems)
  const generationDelta = delta(snapshot.generation, previous.generation)
  const errorDelta = delta(previous.openErrorFindings, snapshot.openErrorFindings)
  const failureChanged = snapshot.failureSignature !== previous.failureSignature
  const strategyChanged = snapshot.strategyGeneration !== previous.strategyGeneration

  if (verifiedDelta > 0) {
    score += verifiedDelta * 12
    reasons.push(`${verifiedDelta} requirement${verifiedDelta === 1 ? '' : 's'} newly verified.`)
  }
  if (implementedDelta > 0) {
    score += implementedDelta * 7
    reasons.push(`${implementedDelta} requirement${implementedDelta === 1 ? '' : 's'} newly implemented.`)
  }
  if (completedWorkDelta > 0) {
    score += completedWorkDelta * 5
    reasons.push(`${completedWorkDelta} work item${completedWorkDelta === 1 ? '' : 's'} completed.`)
  }
  if (generationDelta > 0) {
    score += generationDelta * 3
    reasons.push('Project code generation advanced.')
  }
  if (errorDelta > 0) {
    score += errorDelta * 8
    reasons.push(`${errorDelta} evaluator error${errorDelta === 1 ? '' : 's'} resolved.`)
  }
  if (failureChanged) {
    score += 2
    reasons.push('Failure/evaluator signature changed, indicating a different state or hypothesis.')
  }
  if (strategyChanged) {
    score += 1
    reasons.push('Orchestrator strategy changed.')
  }

  const progressing = score > 0
  if (progressing) {
    return {
      state: 'progressing',
      score,
      reasons,
      strategyChangeRecommended: false,
      escalationRecommended: false,
      snapshot,
    }
  }

  reasons.push('No durable requirement, code-generation, work-item, or evaluator progress was recorded.')
  if (!failureChanged) reasons.push('Failure signature is unchanged.')
  if (stalledWaves >= 5) {
    return {
      state: 'deep_stall',
      score: 0,
      reasons,
      strategyChangeRecommended: true,
      escalationRecommended: true,
      snapshot,
    }
  }
  if (stalledWaves >= 2) {
    return {
      state: 'stalled',
      score: 0,
      reasons,
      strategyChangeRecommended: true,
      escalationRecommended: stalledWaves >= 4,
      snapshot,
    }
  }
  return {
    state: 'idle',
    score: 0,
    reasons,
    strategyChangeRecommended: false,
    escalationRecommended: false,
    snapshot,
  }
}

export function applyProjectWatchdogStrategy(chatId: string, verdict: ProjectWatchdogVerdict) {
  const ledger = loadProjectLedger(chatId)
  if (!ledger || !verdict.strategyChangeRecommended) return ledger
  const strategy = [
    `Progress watchdog: ${verdict.state}.`,
    ...verdict.reasons,
    verdict.escalationRecommended
      ? 'Escalate to a stronger/different specialist or split the blocked work into smaller independently verifiable tasks.'
      : 'Choose a materially different hypothesis or work decomposition before repeating evidence collection.',
  ].join(' ')
  let updated = advanceProjectStrategy(chatId, ledger.goal, strategy)
  updated = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    draft.failedApproaches.push({
      id: `watchdog-${Date.now().toString(36)}`,
      workItemId: '',
      summary: strategy.slice(0, 4000),
      failureSignature: verdict.snapshot.failureSignature,
      files: [],
      createdAt: Date.now(),
    })
    draft.failedApproaches = draft.failedApproaches.slice(-300)
  })
  return updated
}
