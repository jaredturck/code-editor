export type VerificationStatus = 'passed' | 'failed' | 'unknown'

export interface VerificationCandidate {
  id: string
  sourceTool: string
  source: string
  status: VerificationStatus
  epoch: number
  createdAt: number
  detail: string
}

export interface VerificationEvidenceRecord {
  requirement: string
  candidateId: string
  epoch: number
  recordedAt: number
}

export interface VerificationState {
  version: 1
  contractKey: string
  required: boolean
  mutationEpoch: number
  nextCandidate: number
  requirements: string[]
  candidates: Record<string, VerificationCandidate>
  evidence: Record<string, VerificationEvidenceRecord>
}

export interface VerificationGateResult {
  required: boolean
  configured: boolean
  passed: boolean
  mutationEpoch: number
  requirements: Array<{
    requirement: string
    status: VerificationStatus | 'missing' | 'stale'
    candidateId: string | null
    sourceTool: string | null
    source: string | null
    detail: string | null
  }>
  blockers: string[]
}

function compactText(value: unknown, maxChars = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function uniqueRequirements(values: unknown) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => compactText(value, 80)).filter(Boolean))].slice(0, 20)
}

function sourceForTool(toolName: string, args: Record<string, unknown>) {
  if (toolName === 'terminal.exec') return compactText(args.command, 500)
  if (toolName === 'launch.run') return compactText(args.name || args.command, 500)
  if (toolName === 'browser.inspect') return compactText(args.url, 500)
  if (toolName === 'diagnostics.check') return compactText(args.path, 500)
  if (toolName === 'agent.review') return compactText(args.focus || args.scope || 'independent peer review', 500)
  return ''
}

function evaluateCandidateStatus(toolName: string, result: Record<string, unknown>) {
  if (toolName === 'terminal.exec' || toolName === 'launch.run') {
    const exitCode = Number(result.exitCode)
    if (!Number.isFinite(exitCode)) return 'unknown' as const
    return exitCode === 0 ? 'passed' as const : 'failed' as const
  }

  if (toolName === 'browser.inspect') {
    if (result.ok === true) return 'passed' as const
    if (result.ok === false) return 'failed' as const
    return 'unknown' as const
  }

  if (toolName === 'diagnostics.check') {
    if (result.supported !== true) return 'unknown' as const
    if (result.ok === true) return 'passed' as const
    if (result.ok === false) return 'failed' as const
    return 'unknown' as const
  }

  if (toolName === 'agent.review') {
    if (result.reviewed !== true) return 'unknown' as const
    const verdict = String(result.overallVerdict || '').trim().toLowerCase()
    if (verdict === 'approved') return 'passed' as const
    if (verdict === 'changes_requested' || verdict === 'mixed' || verdict === 'rejected') return 'failed' as const
    return 'unknown' as const
  }

  return 'unknown' as const
}

function candidateDetail(toolName: string, result: Record<string, unknown>) {
  if (toolName === 'terminal.exec' || toolName === 'launch.run') {
    return Number.isFinite(Number(result.exitCode))
      ? `exitCode=${Number(result.exitCode)}`
      : 'No exit code was returned.'
  }
  if (toolName === 'browser.inspect') {
    return result.ok === true
      ? 'Browser runtime inspection passed.'
      : result.ok === false
        ? 'Browser runtime inspection reported a failure.'
        : 'Browser runtime inspection did not return a definitive status.'
  }
  if (toolName === 'diagnostics.check') {
    if (result.supported !== true) return 'Diagnostics are unsupported for this file.'
    return result.ok === true
      ? 'Editor diagnostics reported no errors.'
      : result.ok === false
        ? 'Editor diagnostics reported one or more errors.'
        : 'Diagnostics did not return a definitive status.'
  }
  if (toolName === 'agent.review') {
    if (result.reviewed !== true) return 'Independent review did not complete successfully.'
    const verdict = String(result.overallVerdict || 'unknown').trim() || 'unknown'
    const findings = Array.isArray(result.findings) ? result.findings.length : 0
    return `Independent review verdict=${verdict}; findings=${findings}.`
  }
  return 'Verification status is unknown.'
}

export function buildVerificationContractKey(plan: Record<string, unknown> | null | undefined) {
  if (!plan) return 'none'
  const payload = JSON.stringify({
    taskType: plan.taskType || '',
    developmentTask: plan.developmentTask === true,
    workspaceMutationExpected: plan.workspaceMutationExpected === true,
    verificationRequired: plan.verificationRequired === true,
    successCriteria: Array.isArray(plan.successCriteria) ? plan.successCriteria : [],
    verificationChecks: Array.isArray(plan.verificationChecks) ? plan.verificationChecks : [],
  })
  return stableHash(payload)
}

export function createVerificationState(contractKey: string, required: boolean): VerificationState {
  return {
    version: 1,
    contractKey: contractKey,
    required,
    mutationEpoch: 0,
    nextCandidate: 1,
    requirements: [],
    candidates: {},
    evidence: {},
  }
}

export function ensureVerificationState(
  value: unknown,
  contractKey: string,
  required: boolean,
): VerificationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createVerificationState(contractKey, required)
  }

  const state = value as VerificationState
  if (state.version !== 1 || state.contractKey !== contractKey) {
    return createVerificationState(contractKey, required)
  }

  state.required = required
  state.mutationEpoch = Math.max(0, Number(state.mutationEpoch) || 0)
  state.nextCandidate = Math.max(1, Number(state.nextCandidate) || 1)
  state.requirements = uniqueRequirements(state.requirements)
  state.candidates = state.candidates && typeof state.candidates === 'object' ? state.candidates : {}
  state.evidence = state.evidence && typeof state.evidence === 'object' ? state.evidence : {}
  return state
}

export function declareVerificationRequirements(
  state: VerificationState,
  values: unknown,
  mode = 'replace',
) {
  const next = uniqueRequirements(values)
  if (!next.length) throw new Error('verification.require needs at least one model-chosen requirement.')

  state.requirements = mode === 'add'
    ? uniqueRequirements([...state.requirements, ...next])
    : next

  for (const requirement of Object.keys(state.evidence)) {
    if (!state.requirements.includes(requirement)) delete state.evidence[requirement]
  }

  return evaluateVerificationGate(state)
}

export function addVerificationCandidate(
  state: VerificationState,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  if (!['terminal.exec', 'launch.run', 'browser.inspect', 'diagnostics.check', 'agent.review'].includes(toolName)) {
    return null
  }

  const id = `verification-${state.contractKey}-${state.mutationEpoch}-${state.nextCandidate}`
  state.nextCandidate += 1
  const status = evaluateCandidateStatus(toolName, result)
  const candidate: VerificationCandidate = {
    id,
    sourceTool: toolName,
    source: sourceForTool(toolName, args),
    status,
    epoch: state.mutationEpoch,
    createdAt: Date.now(),
    detail: candidateDetail(toolName, result),
  }
  state.candidates[id] = candidate
  return candidate
}

export function recordVerificationEvidence(
  state: VerificationState,
  requirement: unknown,
  candidateId: unknown,
) {
  const requirementId = compactText(requirement, 80)
  const candidateKey = String(candidateId || '').trim()
  if (!state.requirements.includes(requirementId)) {
    throw new Error(`Verification requirement is not declared: ${requirementId || '(empty)'}`)
  }

  const candidate = state.candidates[candidateKey]
  if (!candidate) throw new Error(`Unknown verification candidate: ${candidateKey || '(empty)'}`)

  state.evidence[requirementId] = {
    requirement: requirementId,
    candidateId: candidate.id,
    epoch: candidate.epoch,
    recordedAt: Date.now(),
  }

  return evaluateVerificationGate(state)
}

export function markVerificationMutation(state: VerificationState) {
  state.mutationEpoch += 1
  return state.mutationEpoch
}

export function evaluateVerificationGate(state: VerificationState): VerificationGateResult {
  if (!state.required) {
    return {
      required: false,
      configured: true,
      passed: true,
      mutationEpoch: state.mutationEpoch,
      requirements: [],
      blockers: [],
    }
  }

  if (!state.requirements.length) {
    return {
      required: true,
      configured: false,
      passed: false,
      mutationEpoch: state.mutationEpoch,
      requirements: [],
      blockers: ['The model has not declared the verification checks it considers necessary.'],
    }
  }

  const requirements = state.requirements.map((requirement) => {
    const evidence = state.evidence[requirement]
    const candidate = evidence ? state.candidates[evidence.candidateId] : null
    let status: VerificationStatus | 'missing' | 'stale' = 'missing'
    if (candidate && evidence) {
      status = evidence.epoch === state.mutationEpoch && candidate.epoch === state.mutationEpoch
        ? candidate.status
        : 'stale'
    }
    return {
      requirement,
      status,
      candidateId: candidate?.id || null,
      sourceTool: candidate?.sourceTool || null,
      source: candidate?.source || null,
      detail: candidate?.detail || null,
    }
  })

  const blockers = requirements
    .filter((item) => item.status !== 'passed')
    .map((item) => {
      if (item.status === 'missing') return `${item.requirement}: no evidence has been recorded.`
      if (item.status === 'stale') return `${item.requirement}: evidence is stale after a later workspace mutation.`
      if (item.status === 'failed') return `${item.requirement}: the recorded verification failed.`
      return `${item.requirement}: the recorded verification result is inconclusive.`
    })

  return {
    required: true,
    configured: true,
    passed: blockers.length === 0,
    mutationEpoch: state.mutationEpoch,
    requirements,
    blockers,
  }
}
