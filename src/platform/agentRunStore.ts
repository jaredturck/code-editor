/**
 * Stores compact agent-run summaries for replay, inspection, evaluation, and
 * training-oriented views while bounding retained history.
 */

import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore'
import { durableStoreSet } from '@/platform/desktopBridge'
import { durableStoreGetMany } from '@/platform/secureDurableStore'

type UnknownRecord = Record<string, unknown>

export interface AgentRunEventChart {
  kind: string
  label: string
  value: number
  max: number
  linesRead?: number
  charsRead?: number
  status: string
  url: string
  index?: number
  total?: number
}

export interface AgentRunUsageSummary {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requests: number
  contextWindow: number
  contextRemaining: number
  contextUsedPct: number
  estimatedCalls: number
  providerReportedCalls: number
  estimatedOnly: boolean
}

export interface AgentRunTimelineEvent {
  id: number
  at: number
  type: string
  name: string
  summary: string
  op: string
  text: string
  tool: string
  module: string
  argsPreview: string
  outputPreview: string
  status: string
  step?: number
  durationMs?: number
  exitCode?: number
  chart: AgentRunEventChart | null
  taskId: string
  toAgent: string
  delegationStatus: string
  provider: string
  model: string
  purpose: string
  reason: string
  requestNumber?: number
  requestLimit?: number
}

export type AgentRunTodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface AgentRunTodo {
  id: number
  text: string
  status: AgentRunTodoStatus
}

export interface AgentRunSkillSummary {
  id: string
  title: string
}

export interface AgentRunSkills {
  profile: string
  active: AgentRunSkillSummary[]
}

export interface AgentRunSummary {
  durationMs: number
  stepsAttempted: number
  toolCalls: number
  toolSuccesses: number
  toolFailures: number
  todoUpdates: number
  thinkingEvents: number
  skillsProfile: string
  activeSkills: number
  safetyProfile: string
  networkCommandsAllowed: boolean
  sudoBlocked: boolean
  stepBudget: number
  usage: AgentRunUsageSummary | null
  delegationsPosted: number
  delegationsSatisfied: number
  escalations: number
  escalationRate: number
  agentMode: string
}

export interface AgentRunSafety {
  profile: string
  blockSudo: boolean
  allowNetworkCommands: boolean
  maxSteps: number
}

export interface AgentRun {
  id: string
  createdAt: number
  userInput: string
  reply: string
  steps: number
  timeline: AgentRunTimelineEvent[]
  todos: AgentRunTodo[]
  summary: AgentRunSummary | null
  skills: AgentRunSkills
  safety: AgentRunSafety | null
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const AGENT_RUNS_STORAGE_KEY = 'iris_agent_runs'
const AGENT_RUNS_FULL_KEY = 'iris_agent_runs_full'
const MAX_RUNS_HARD_LIMIT = 120
const MAX_RUNS_DURABLE_LIMIT = 2000 // encrypted long-term history beyond the compact UI list
const MAX_TIMELINE_EVENTS = 320
const MAX_TODOS = 120

// ── Agent state constants (mirrors subAgentRuntime for UI consumption) ─────────
export const AGENT_STATES = {
  IDLE: 'idle',
  RUNNING: 'running',
  DELEGATED_PAUSE: 'delegated_pause', // Waiting for a sub-agent result
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETE: 'complete',
  FAILED: 'failed',
} as const

export type AgentState = (typeof AGENT_STATES)[keyof typeof AGENT_STATES]

export const DELEGATION_STATUS = {
  POSTED: 'posted',
  PENDING: 'pending',
  RUNNING: 'running',
  SATISFIED: 'satisfied',
  FAILED: 'failed',
  ESCALATED: 'escalated',
} as const

export type DelegationStatus = (typeof DELEGATION_STATUS)[keyof typeof DELEGATION_STATUS]

// Clamps number to the supported bounds.
function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, Math.round(number)))
}

function toSafeText(value: unknown, maxLength = 4000): string {
  return String(value ?? '').slice(0, Math.max(1, maxLength))
}

// Converts event chart into the canonical representation expected by later code.
function normalizeEventChart(chart: unknown): AgentRunEventChart | null {
  if (!isRecord(chart)) return null

  const value = Number(chart?.value)
  const max = Number(chart?.max)

  return {
    kind: toSafeText(chart?.kind || 'metric', 60),
    label: toSafeText(chart?.label || '', 220),
    value: Number.isFinite(value) ? value : 0,
    max: Number.isFinite(max) && max > 0 ? max : 1,
    linesRead: Number.isFinite(Number(chart?.linesRead)) ? Number(chart.linesRead) : undefined,
    charsRead: Number.isFinite(Number(chart?.charsRead)) ? Number(chart.charsRead) : undefined,
    status: toSafeText(chart?.status || '', 40),
    url: toSafeText(chart?.url || '', 320),
    index: Number.isFinite(Number(chart?.index)) ? Number(chart.index) : undefined,
    total: Number.isFinite(Number(chart?.total)) ? Number(chart.total) : undefined,
  }
}

/**
 * Reduces historical provider usage fields to the bounded token, cache, and estimated
 * values stored with an agent run. Normalization keeps old and new run records readable by
 * the same usage views.
 */

function normalizeUsageSummary(usage: unknown): AgentRunUsageSummary | null {
  if (!isRecord(usage)) return null

  return {
    provider: toSafeText(usage.provider || '', 80),
    model: toSafeText(usage.model || '', 120),
    promptTokens: Number.isFinite(Number(usage.promptTokens)) ? Number(usage.promptTokens) : 0,
    completionTokens: Number.isFinite(Number(usage.completionTokens)) ? Number(usage.completionTokens) : 0,
    totalTokens: Number.isFinite(Number(usage.totalTokens)) ? Number(usage.totalTokens) : 0,
    requests: Number.isFinite(Number(usage.requests)) ? Number(usage.requests) : 0,
    contextWindow: Number.isFinite(Number(usage.contextWindow)) ? Number(usage.contextWindow) : 0,
    contextRemaining: Number.isFinite(Number(usage.contextRemaining)) ? Number(usage.contextRemaining) : 0,
    contextUsedPct: Number.isFinite(Number(usage.contextUsedPct)) ? Number(usage.contextUsedPct) : 0,
    estimatedCalls: Number.isFinite(Number(usage.estimatedCalls)) ? Number(usage.estimatedCalls) : 0,
    providerReportedCalls: Number.isFinite(Number(usage.providerReportedCalls))
      ? Number(usage.providerReportedCalls)
      : 0,
    estimatedOnly: Boolean(usage.estimatedOnly),
  }
}

/**
 * Sanitizes one persisted timeline event and bounds its nested data before it enters the
 * run history. Event type and visible content are preserved while oversized or
 * unserializable values are reduced to a safe representation.
 */

function normalizeEvent(event: unknown, index: number): AgentRunTimelineEvent {
  const source = isRecord(event) ? event : {}
  return {
    id: Number.isFinite(Number(source.id)) ? Number(source.id) : index + 1,
    at: Number.isFinite(Number(source.at)) ? Number(source.at) : Date.now(),
    type: toSafeText(source.type || 'event', 40),
    name: toSafeText(source.name || '', 80),
    summary: toSafeText(source.summary || '', 1200),
    op: toSafeText(source.op || '', 40),
    text: toSafeText(source.text || '', 600),
    tool: toSafeText(source.tool || '', 120),
    module: toSafeText(source.module || '', 80),
    argsPreview: toSafeText(source.argsPreview || '', 1800),
    outputPreview: toSafeText(source.outputPreview || '', 2400),
    status: toSafeText(source.status || '', 40),
    step: Number.isFinite(Number(source.step)) ? Number(source.step) : undefined,
    durationMs: Number.isFinite(Number(source.durationMs)) ? Number(source.durationMs) : undefined,
    exitCode: Number.isFinite(Number(source.exitCode)) ? Number(source.exitCode) : undefined,
    chart: normalizeEventChart(source.chart),
    // Delegation event fields
    taskId: toSafeText(source.taskId || '', 80),
    toAgent: toSafeText(source.toAgent || '', 40),
    delegationStatus: toSafeText(source.delegationStatus || '', 24),
    provider: toSafeText(source.provider || '', 80),
    model: toSafeText(source.model || '', 160),
    purpose: toSafeText(source.purpose || '', 120),
    reason: toSafeText(source.reason || '', 1000),
    requestNumber: Number.isFinite(Number(source.requestNumber)) ? Number(source.requestNumber) : undefined,
    requestLimit: Number.isFinite(Number(source.requestLimit)) ? Number(source.requestLimit) : undefined,
  }
}

// Converts todo into the canonical representation expected by later code.
function normalizeTodo(todo: unknown, index: number): AgentRunTodo {
  const source = isRecord(todo) ? todo : {}
  const status = String(source.status || 'pending').toLowerCase()
  const normalizedStatus = ['pending', 'in_progress', 'done', 'blocked'].includes(status)
    ? (status as AgentRunTodoStatus)
    : 'pending'

  return {
    id: Number.isFinite(Number(source.id)) ? Number(source.id) : index + 1,
    text: toSafeText(source.text || 'Task', 500),
    status: normalizedStatus,
  }
}

// Converts skills into the canonical representation expected by later code.
function normalizeSkills(skills: unknown): AgentRunSkills {
  if (!isRecord(skills)) {
    return { profile: '', active: [] }
  }

  return {
    profile: toSafeText(skills.profile || '', 120),
    active: Array.isArray(skills.active)
      ? skills.active.slice(0, 12).map((skill, index) => {
          const source = isRecord(skill) ? skill : {}
          return {
            id: toSafeText(source.id || `skill-${index + 1}`, 120),
            title: toSafeText(source.title || '', 160),
          }
        })
      : [],
  }
}

/**
 * Builds the stable run-summary record used by history, evaluation, and reporting views.
 * Missing values receive neutral defaults so runs written by older versions remain
 * comparable with current sessions.
 */

function normalizeSummary(summary: unknown): AgentRunSummary | null {
  if (!isRecord(summary)) return null

  return {
    durationMs: Number.isFinite(Number(summary.durationMs)) ? Number(summary.durationMs) : 0,
    stepsAttempted: Number.isFinite(Number(summary.stepsAttempted)) ? Number(summary.stepsAttempted) : 0,
    toolCalls: Number.isFinite(Number(summary.toolCalls)) ? Number(summary.toolCalls) : 0,
    toolSuccesses: Number.isFinite(Number(summary.toolSuccesses)) ? Number(summary.toolSuccesses) : 0,
    toolFailures: Number.isFinite(Number(summary.toolFailures)) ? Number(summary.toolFailures) : 0,
    todoUpdates: Number.isFinite(Number(summary.todoUpdates)) ? Number(summary.todoUpdates) : 0,
    thinkingEvents: Number.isFinite(Number(summary.thinkingEvents)) ? Number(summary.thinkingEvents) : 0,
    skillsProfile: toSafeText(summary.skillsProfile || '', 120),
    activeSkills: Number.isFinite(Number(summary.activeSkills)) ? Number(summary.activeSkills) : 0,
    safetyProfile: toSafeText(summary.safetyProfile || '', 40),
    networkCommandsAllowed: Boolean(summary.networkCommandsAllowed),
    sudoBlocked: Boolean(summary.sudoBlocked),
    stepBudget: Number.isFinite(Number(summary.stepBudget)) ? Number(summary.stepBudget) : 0,
    usage: normalizeUsageSummary(summary.usage),
    // Delegation metrics (multi-agent sessions)
    delegationsPosted: Number.isFinite(Number(summary.delegationsPosted)) ? Number(summary.delegationsPosted) : 0,
    delegationsSatisfied: Number.isFinite(Number(summary.delegationsSatisfied))
      ? Number(summary.delegationsSatisfied)
      : 0,
    escalations: Number.isFinite(Number(summary.escalations)) ? Number(summary.escalations) : 0,
    escalationRate: Number.isFinite(Number(summary.escalationRate)) ? Number(summary.escalationRate) : 0,
    agentMode: toSafeText(summary.agentMode || 'solo', 24), // solo | dual | multi
  }
}

// Converts safety into the canonical representation expected by later code.
function normalizeSafety(safety: unknown): AgentRunSafety | null {
  if (!isRecord(safety)) return null

  return {
    profile: toSafeText(safety.profile || '', 40),
    blockSudo: safety.blockSudo !== false,
    allowNetworkCommands: Boolean(safety.allowNetworkCommands),
    maxSteps: Number.isFinite(Number(safety.maxSteps)) ? Number(safety.maxSteps) : 0,
  }
}

/**
 * Converts one stored agent run into the bounded history shape used by the renderer. It
 * normalizes timeline events, todos, usage, skills, and safety metadata while preserving
 * the run's identity and ordering time.
 */

function normalizeRun(run: unknown, index: number): AgentRun {
  const source = isRecord(run) ? run : {}
  const id = toSafeText(source.id || `run-${Date.now()}-${index + 1}`, 80)
  return {
    id,
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
    userInput: toSafeText(source.userInput || '', 1200),
    reply: toSafeText(source.reply || '', 8000),
    steps: Number.isFinite(Number(source.steps)) ? Number(source.steps) : 0,
    timeline: Array.isArray(source.timeline)
      ? source.timeline.slice(0, MAX_TIMELINE_EVENTS).map((event, eventIndex) => normalizeEvent(event, eventIndex))
      : [],
    todos: Array.isArray(source.todos)
      ? source.todos.slice(0, MAX_TODOS).map((todo, todoIndex) => normalizeTodo(todo, todoIndex))
      : [],
    summary: normalizeSummary(source.summary),
    skills: normalizeSkills(source.skills),
    safety: normalizeSafety(source.safety),
  }
}

// Converts runs with limit into the canonical representation expected by later code.
function normalizeRunsWithLimit(runs: unknown, limit: number): AgentRun[] {
  if (!Array.isArray(runs)) return []

  return runs
    .slice(0, limit)
    .map((run, index) => normalizeRun(run, index))
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Converts runs into the canonical representation expected by later code.
function normalizeRuns(runs: unknown): AgentRun[] {
  return normalizeRunsWithLimit(runs, MAX_RUNS_HARD_LIMIT)
}

// Reads agent runs and converts it into the representation used by the agent run store.
export function readAgentRuns(): AgentRun[] {
  const parsed = readStorageJson<unknown>(AGENT_RUNS_STORAGE_KEY, [])
  return normalizeRuns(parsed)
}

// Persists agent runs while preserving the storage and compatibility rules of this module.
export function writeAgentRuns(runs: unknown): AgentRun[] {
  const normalized = normalizeRuns(runs)
  writeStorageJson(AGENT_RUNS_STORAGE_KEY, normalized)
  return normalized
}

// Appends agent run while preserving the storage and size rules owned by the agent run store.
export function appendAgentRun(run: unknown, maxRuns = 40): AgentRun[] {
  const normalizedRun = normalizeRun(run, 0)
  const existingRuns = readAgentRuns().filter((item) => item.id !== normalizedRun.id)
  const cap = clampNumber(maxRuns, 5, MAX_RUNS_HARD_LIMIT)
  return writeAgentRuns([normalizedRun, ...existingRuns].slice(0, cap))
}

// Removes retained agent runs and restores the feature to its empty state.
export function clearAgentRuns(): AgentRun[] {
  try {
    durableStoreSet(AGENT_RUNS_FULL_KEY, JSON.stringify([])).catch(() => {})
  } catch {
    /* best-effort */
  }
  return writeAgentRuns([])
}

// ── Encrypted long-term run history ──────────────────────────────────────────
// The renderer keeps a compact in-memory list for immediate UI reads while the
// encrypted bridge store retains a much larger history.

/**
 * Read the extended run history from encrypted bridge storage, falling back to
 * the compact in-memory list when no extended records exist.
 */
export async function readAgentRunsDurable(): Promise<AgentRun[]> {
  try {
    const values = await durableStoreGetMany([AGENT_RUNS_FULL_KEY, AGENT_RUNS_STORAGE_KEY])
    const raw = values?.[AGENT_RUNS_FULL_KEY] || values?.[AGENT_RUNS_STORAGE_KEY]
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return normalizeRunsWithLimit(parsed, MAX_RUNS_DURABLE_LIMIT)
    }
  } catch {
    /* use the compact encrypted-store-backed UI list */
  }
  return readAgentRuns()
}

/**
 * Append a run to both the compact in-memory UI list and the extended encrypted
 * bridge history. Returns the compact list for an immediate UI update.
 */
export async function appendAgentRunDurable(run: unknown, maxRuns = 40): Promise<AgentRun[]> {
  const normalizedRun = normalizeRun(run, 0)
  let fullList = [normalizedRun]
  try {
    const existingFull = await readAgentRunsDurable()
    fullList = [normalizedRun, ...existingFull.filter((item) => item.id !== normalizedRun.id)].slice(
      0,
      MAX_RUNS_DURABLE_LIMIT,
    )
    await durableStoreSet(AGENT_RUNS_FULL_KEY, JSON.stringify(fullList))
  } catch {
    /* best-effort durable write */
  }
  const cap = clampNumber(maxRuns, 5, MAX_RUNS_HARD_LIMIT)
  return writeAgentRuns(fullList.slice(0, cap))
}

export async function hydrateAgentRunHistory(maxRuns = MAX_RUNS_HARD_LIMIT): Promise<AgentRun[]> {
  const durable = await readAgentRunsDurable()
  const cap = clampNumber(maxRuns, 5, MAX_RUNS_HARD_LIMIT)
  return writeAgentRuns(durable.slice(0, cap))
}

// Formats event label for stable display or serialization without changing its underlying meaning.
function formatEventLabel(event: AgentRunTimelineEvent): string {
  if (event.type === 'phase') return `phase:${event.name || 'session'}`
  if (event.type === 'tool_call') return `tool_call:${event.tool || 'unknown'}`
  if (event.type === 'tool_result') return `tool_result:${event.tool || 'unknown'}:${event.status || 'unknown'}`
  if (event.type === 'todo') return `todo:${event.op || 'update'}`
  if (event.type === 'delegation') return `delegation:${event.toAgent || 'agent'}:${event.delegationStatus || 'posted'}`
  if (event.type === 'cloud_request') return `cloud_request:${event.provider || 'cloud'}:${event.model || 'unknown'}`
  if (event.type === 'cloud_response') return `cloud_response:${event.provider || 'cloud'}:${event.status || 'unknown'}`
  return event.type || 'event'
}

// Formats timestamp for stable display or serialization without changing its underlying meaning.
function formatTimestamp(value: unknown): string {
  if (!Number.isFinite(Number(value))) return '--:--:--'
  const date = new Date(Number(value))
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * Formats a stored agent run as a human-readable Markdown report containing the request,
 * reply, summary, todos, skills, safety state, and timeline. Export formatting remains
 * separate from the normalized record so it cannot alter persisted history.
 */

export function formatAgentRunMarkdown(runInput: unknown): string {
  const run = normalizeRun(runInput, 0)
  const lines: string[] = []

  lines.push(`# Agent Run ${run.id}`)
  lines.push('')
  lines.push(`- Created: ${new Date(run.createdAt).toISOString()}`)
  lines.push(`- Steps: ${run.steps}`)
  lines.push(`- Skills profile: ${run.skills?.profile || 'n/a'}`)
  if (run.safety?.profile) {
    lines.push(
      `- Safety: ${run.safety.profile} (sudo ${run.safety.blockSudo ? 'blocked' : 'allowed'}, network ${run.safety.allowNetworkCommands ? 'allowed' : 'blocked'})`,
    )
  }
  lines.push('')

  if (run.userInput) {
    lines.push('## User Request')
    lines.push('')
    lines.push(run.userInput)
    lines.push('')
  }

  lines.push('## Summary')
  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(run.summary || {}, null, 2))
  lines.push('```')
  lines.push('')

  lines.push('## Timeline')
  lines.push('')
  run.timeline.forEach((event) => {
    const body = event.outputPreview || event.argsPreview || event.summary || event.text || ''
    lines.push(`- [${formatTimestamp(event.at)}] ${formatEventLabel(event)}${body ? ` :: ${body}` : ''}`)
  })
  lines.push('')

  lines.push('## Todos')
  lines.push('')
  run.todos.forEach((todo) => {
    lines.push(`- [${todo.status}] ${todo.text}`)
  })
  lines.push('')

  lines.push('## Assistant Reply')
  lines.push('')
  lines.push(run.reply || '')
  lines.push('')

  return lines.join('\n')
}
