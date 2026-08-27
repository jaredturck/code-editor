import { getChatSessionState, saveChatSessionState } from '@/platform/chatSessionStore'

export type ProjectRequirementStatus = 'pending' | 'in_progress' | 'implemented' | 'verified' | 'blocked'
export type ProjectWorkItemStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled'
export type ProjectAgentRole = 'orchestrator' | 'planner' | 'scout' | 'executor' | 'evaluator'

export interface ProjectRequirement {
  id: string
  text: string
  status: ProjectRequirementStatus
  acceptanceCriteria: string[]
  dependsOn: string[]
  evidence: string[]
  notes: string[]
  updatedAt: number
}

export interface ProjectWorkItem {
  id: string
  title: string
  description: string
  status: ProjectWorkItemStatus
  role: ProjectAgentRole
  requirementIds: string[]
  dependsOn: string[]
  workspaceId: string
  taskId: string
  attempts: number
  blockers: string[]
  resultSummary: string
  createdAt: number
  updatedAt: number
}

export interface ProjectDecision {
  id: string
  summary: string
  rationale: string
  files: string[]
  createdAt: number
}

export interface ProjectFailedApproach {
  id: string
  workItemId: string
  summary: string
  failureSignature: string
  files: string[]
  createdAt: number
}

export interface ProjectEvaluatorFinding {
  id: string
  requirementId: string
  severity: 'info' | 'warning' | 'error'
  status: 'open' | 'resolved' | 'dismissed'
  summary: string
  evidence: string[]
  createdAt: number
  updatedAt: number
}

export interface ProjectManagedProcess {
  id: string
  kind: 'dev-server' | 'database' | 'worker' | 'test-watcher' | 'other'
  command: string
  cwd: string
  pid: number | null
  port: number | null
  status: 'starting' | 'running' | 'stopped' | 'failed' | 'unknown'
  logPath: string
  ownerWorkItemId: string
  updatedAt: number
}

export interface ProjectVerificationRecord {
  id: string
  generation: number
  kind: string
  command: string
  ok: boolean
  summary: string
  files: string[]
  createdAt: number
}

export interface ProjectCheckpoint {
  id: string
  generation: number
  label: string
  ref: string
  summary: string
  createdAt: number
}

export interface ProjectAgentTaskState {
  id: string
  role: ProjectAgentRole
  model: string
  provider: string
  status: ProjectWorkItemStatus
  workItemId: string
  workspaceId: string
  outputPath: string
  attempts: number
  error: string
  updatedAt: number
}

export interface ProjectLedger {
  version: 1
  projectId: string
  chatId: string
  goal: string
  generation: number
  strategyGeneration: number
  createdAt: number
  updatedAt: number
  requirements: ProjectRequirement[]
  workItems: ProjectWorkItem[]
  decisions: ProjectDecision[]
  failedApproaches: ProjectFailedApproach[]
  evaluatorFindings: ProjectEvaluatorFinding[]
  processes: ProjectManagedProcess[]
  verification: ProjectVerificationRecord[]
  checkpoints: ProjectCheckpoint[]
  agentTasks: ProjectAgentTaskState[]
  architectureSummary: string
  currentStrategy: string
  lastProgressAt: number
  lastProgressSummary: string
}

const MAX_REQUIREMENTS = 250
const MAX_WORK_ITEMS = 500
const MAX_HISTORY = 300
const MAX_TEXT = 4000

function now() {
  return Date.now()
}

function text(value: unknown, max = MAX_TEXT) {
  return String(value || '').trim().slice(0, max)
}

function strings(value: unknown, limit = 40, max = 1000) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => text(item, max)).filter(Boolean))).slice(0, limit)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function requirementStatus(value: unknown): ProjectRequirementStatus {
  const status = String(value || '')
  return ['pending', 'in_progress', 'implemented', 'verified', 'blocked'].includes(status)
    ? (status as ProjectRequirementStatus)
    : 'pending'
}

function workStatus(value: unknown): ProjectWorkItemStatus {
  const status = String(value || '')
  return ['pending', 'ready', 'running', 'blocked', 'done', 'failed', 'cancelled'].includes(status)
    ? (status as ProjectWorkItemStatus)
    : 'pending'
}

function role(value: unknown): ProjectAgentRole {
  const candidate = String(value || '')
  return ['orchestrator', 'planner', 'scout', 'executor', 'evaluator'].includes(candidate)
    ? (candidate as ProjectAgentRole)
    : 'executor'
}

function normalizeRequirement(value: unknown, index: number): ProjectRequirement {
  const source = record(value)
  return {
    id: text(source.id, 200) || `req-${index + 1}`,
    text: text(source.text || source.description, 5000),
    status: requirementStatus(source.status),
    acceptanceCriteria: strings(source.acceptanceCriteria || source.acceptance_criteria, 30, 1500),
    dependsOn: strings(source.dependsOn || source.depends_on, 30, 200),
    evidence: strings(source.evidence, 60, 2000),
    notes: strings(source.notes, 30, 1500),
    updatedAt: Math.max(0, Number(source.updatedAt || source.updated_at) || now()),
  }
}

function normalizeWorkItem(value: unknown, index: number): ProjectWorkItem {
  const source = record(value)
  const timestamp = now()
  return {
    id: text(source.id, 200) || `work-${index + 1}`,
    title: text(source.title, 1000),
    description: text(source.description, 5000),
    status: workStatus(source.status),
    role: role(source.role),
    requirementIds: strings(source.requirementIds || source.requirement_ids, 80, 200),
    dependsOn: strings(source.dependsOn || source.depends_on, 80, 200),
    workspaceId: text(source.workspaceId || source.workspace_id, 500),
    taskId: text(source.taskId || source.task_id, 500),
    attempts: Math.max(0, Number(source.attempts) || 0),
    blockers: strings(source.blockers, 40, 1500),
    resultSummary: text(source.resultSummary || source.result_summary, 5000),
    createdAt: Math.max(0, Number(source.createdAt || source.created_at) || timestamp),
    updatedAt: Math.max(0, Number(source.updatedAt || source.updated_at) || timestamp),
  }
}

export function normalizeProjectLedger(value: unknown, fallback: { chatId?: string; projectId?: string; goal?: string } = {}): ProjectLedger {
  const source = record(value)
  const timestamp = now()
  return {
    version: 1,
    projectId: text(source.projectId || fallback.projectId, 300) || id('project'),
    chatId: text(source.chatId || fallback.chatId, 300),
    goal: text(source.goal || fallback.goal, 20_000),
    generation: Math.max(0, Number(source.generation) || 0),
    strategyGeneration: Math.max(0, Number(source.strategyGeneration) || 0),
    createdAt: Math.max(0, Number(source.createdAt) || timestamp),
    updatedAt: Math.max(0, Number(source.updatedAt) || timestamp),
    requirements: (Array.isArray(source.requirements) ? source.requirements : []).slice(0, MAX_REQUIREMENTS).map(normalizeRequirement),
    workItems: (Array.isArray(source.workItems) ? source.workItems : []).slice(0, MAX_WORK_ITEMS).map(normalizeWorkItem),
    decisions: (Array.isArray(source.decisions) ? source.decisions : []).slice(-MAX_HISTORY) as ProjectDecision[],
    failedApproaches: (Array.isArray(source.failedApproaches) ? source.failedApproaches : []).slice(-MAX_HISTORY) as ProjectFailedApproach[],
    evaluatorFindings: (Array.isArray(source.evaluatorFindings) ? source.evaluatorFindings : []).slice(-MAX_HISTORY) as ProjectEvaluatorFinding[],
    processes: (Array.isArray(source.processes) ? source.processes : []).slice(0, 100) as ProjectManagedProcess[],
    verification: (Array.isArray(source.verification) ? source.verification : []).slice(-MAX_HISTORY) as ProjectVerificationRecord[],
    checkpoints: (Array.isArray(source.checkpoints) ? source.checkpoints : []).slice(-MAX_HISTORY) as ProjectCheckpoint[],
    agentTasks: (Array.isArray(source.agentTasks) ? source.agentTasks : []).slice(-MAX_WORK_ITEMS) as ProjectAgentTaskState[],
    architectureSummary: text(source.architectureSummary, 12_000),
    currentStrategy: text(source.currentStrategy, 8000),
    lastProgressAt: Math.max(0, Number(source.lastProgressAt) || timestamp),
    lastProgressSummary: text(source.lastProgressSummary, 5000),
  }
}

function legacyRunMetadata(chatId: string) {
  return record(getChatSessionState(chatId)?.projectRun)
}

export function loadProjectLedger(chatId: string): ProjectLedger | null {
  if (!chatId) return null
  const session = getChatSessionState(chatId)
  const run = record(session?.projectRun)
  const source = session?.projectLedger || run.ledger
  if (!source) return null
  const ledger = normalizeProjectLedger(source, {
    chatId,
    projectId: text(run.id, 300),
    goal: text(run.goal, 20_000),
  })
  if (!session?.projectLedger) saveChatSessionState(chatId, { projectLedger: ledger })
  return ledger
}

export function saveProjectLedger(chatId: string, ledger: ProjectLedger): ProjectLedger {
  const run = legacyRunMetadata(chatId)
  const normalized = normalizeProjectLedger(
    { ...ledger, chatId, updatedAt: now() },
    { chatId, projectId: text(run.id, 300), goal: text(run.goal, 20_000) },
  )
  saveChatSessionState(chatId, { projectLedger: normalized })
  return normalized
}

export function ensureProjectLedger(chatId: string, goal: string, projectId = ''): ProjectLedger {
  const existing = loadProjectLedger(chatId)
  if (existing) {
    if (!existing.goal && goal) existing.goal = text(goal, 20_000)
    return saveProjectLedger(chatId, existing)
  }
  return saveProjectLedger(chatId, normalizeProjectLedger(null, { chatId, goal, projectId }))
}

export function mutateProjectLedger(chatId: string, goal: string, mutate: (ledger: ProjectLedger) => void): ProjectLedger {
  const ledger = ensureProjectLedger(chatId, goal)
  mutate(ledger)
  ledger.updatedAt = now()
  return saveProjectLedger(chatId, ledger)
}

export function replaceProjectRequirements(chatId: string, goal: string, requirements: Array<Partial<ProjectRequirement>>): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    ledger.requirements = requirements.slice(0, MAX_REQUIREMENTS).map((item, index) => normalizeRequirement(item, index))
    ledger.lastProgressAt = now()
    ledger.lastProgressSummary = 'Initialized project requirements.'
  })
}

/** Add or revise requirements without replacing already verified project state. */
export function upsertProjectRequirements(chatId: string, goal: string, requirements: Array<Partial<ProjectRequirement>>): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    const byId = new Map(ledger.requirements.map((item) => [item.id, item]))
    for (const raw of requirements.slice(0, MAX_REQUIREMENTS)) {
      const normalized = normalizeRequirement(raw, byId.size)
      const previous = byId.get(normalized.id)
      if (previous) {
        byId.set(normalized.id, {
          ...previous,
          ...normalized,
          status: previous.status === 'verified' ? 'verified' : normalized.status,
          evidence: Array.from(new Set([...previous.evidence, ...normalized.evidence])).slice(-60),
          notes: Array.from(new Set([...previous.notes, ...normalized.notes])).slice(-30),
          updatedAt: now(),
        })
      } else {
        byId.set(normalized.id, normalized)
      }
    }
    ledger.requirements = [...byId.values()].slice(0, MAX_REQUIREMENTS)
    ledger.lastProgressAt = now()
    ledger.lastProgressSummary = `${requirements.length} requirement${requirements.length === 1 ? '' : 's'} added or refreshed.`
  })
}

export function upsertProjectWorkItems(chatId: string, goal: string, items: Array<Partial<ProjectWorkItem>>): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    const byId = new Map(ledger.workItems.map((item) => [item.id, item]))
    for (const raw of items) {
      const normalized = normalizeWorkItem(raw, byId.size)
      const previous = byId.get(normalized.id)
      byId.set(normalized.id, previous ? { ...previous, ...normalized, createdAt: previous.createdAt, updatedAt: now() } : normalized)
    }
    ledger.workItems = [...byId.values()].slice(0, MAX_WORK_ITEMS)
  })
}

export function markProjectProgress(chatId: string, goal: string, summary: string, mutation = false): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    if (mutation) ledger.generation += 1
    ledger.lastProgressAt = now()
    ledger.lastProgressSummary = text(summary, 5000)
  })
}

export function advanceProjectStrategy(chatId: string, goal: string, strategy: string): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    ledger.strategyGeneration += 1
    ledger.currentStrategy = text(strategy, 8000)
    ledger.lastProgressAt = now()
    ledger.lastProgressSummary = `Strategy ${ledger.strategyGeneration} selected.`
  })
}

export function addEvaluatorFindings(chatId: string, goal: string, findings: Array<Partial<ProjectEvaluatorFinding>>): ProjectLedger {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    const timestamp = now()
    for (const raw of findings) {
      ledger.evaluatorFindings.push({
        id: text(raw.id, 200) || id('finding'),
        requirementId: text(raw.requirementId, 200),
        severity: raw.severity === 'error' || raw.severity === 'warning' ? raw.severity : 'info',
        status: raw.status === 'resolved' || raw.status === 'dismissed' ? raw.status : 'open',
        summary: text(raw.summary, 4000),
        evidence: strings(raw.evidence, 30, 2000),
        createdAt: Number(raw.createdAt) || timestamp,
        updatedAt: timestamp,
      })
    }
    ledger.evaluatorFindings = ledger.evaluatorFindings.slice(-MAX_HISTORY)
  })
}

export function projectLedgerComplete(ledger: ProjectLedger): boolean {
  if (!ledger.requirements.length) return false
  const requirementsComplete = ledger.requirements.every((requirement) => requirement.status === 'verified')
  const openFindings = ledger.evaluatorFindings.some((finding) => finding.status === 'open' && finding.severity === 'error')
  const activeWork = ledger.workItems.some((item) => ['ready', 'running', 'pending'].includes(item.status))
  return requirementsComplete && !openFindings && !activeWork
}

export function projectLedgerSummary(ledger: ProjectLedger) {
  const verified = ledger.requirements.filter((requirement) => requirement.status === 'verified').length
  const blocked = ledger.requirements.filter((requirement) => requirement.status === 'blocked').length
  const openFindings = ledger.evaluatorFindings.filter((finding) => finding.status === 'open').length
  const activeWork = ledger.workItems.filter((item) => ['ready', 'running'].includes(item.status)).length
  return {
    projectId: ledger.projectId,
    generation: ledger.generation,
    strategyGeneration: ledger.strategyGeneration,
    requirements: ledger.requirements.length,
    verified,
    blocked,
    openFindings,
    activeWork,
    complete: projectLedgerComplete(ledger),
    lastProgressAt: ledger.lastProgressAt,
    lastProgressSummary: ledger.lastProgressSummary,
  }
}
