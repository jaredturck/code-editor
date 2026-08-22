import { getChatSessionState, saveChatSessionState } from '@/platform/chatSessionStore'
import type { AgentUsageSummary } from '@/types/editor'

export type ProjectRunStatus =
  | 'starting'
  | 'planning'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_user'
  | 'paused'
  | 'interrupted'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ProjectRunMode = 'automatic' | 'plan_first'

export interface ProjectRunTodo {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  dependsOn: string[]
}

export interface ProjectRunState {
  id: string
  chat_id: string
  goal: string
  mode: ProjectRunMode
  status: ProjectRunStatus
  provider: string
  model: string
  started_at: number
  updated_at: number
  checkpoint_at: number
  checkpoint_count: number
  elapsed_ms: number
  segment_started_at: number
  todos: ProjectRunTodo[]
  steps: number
  summary: string
  runtime_summary: Record<string, unknown> | null
  usage: AgentUsageSummary | null
  last_activity: string
  error: string
}

interface BeginProjectRunInput {
  id: string
  chat_id: string
  goal: string
  mode: ProjectRunMode
  provider: string
  model: string
  todos?: unknown
}

interface ProjectRunPatch {
  todos?: unknown
  steps?: unknown
  summary?: unknown
  last_activity?: unknown
  error?: unknown
  provider?: unknown
  model?: unknown
}

type Listener = (state: ProjectRunState | null) => void

const active_statuses = new Set<ProjectRunStatus>([
  'starting',
  'planning',
  'running',
  'waiting_for_approval',
  'waiting_for_user',
  'finalizing',
])

const resumable_statuses = new Set<ProjectRunStatus>(['paused', 'interrupted'])
const terminal_statuses = new Set<ProjectRunStatus>(['completed', 'failed', 'cancelled'])

let current_state: ProjectRunState | null = null
let abort_controller: AbortController | null = null
let pause_requested = false
const listeners = new Set<Listener>()

const MAX_RUN_ID_LENGTH = 200
const MAX_GOAL_LENGTH = 20_000
const MAX_PROVIDER_LENGTH = 200
const MAX_MODEL_LENGTH = 300
const MAX_TODO_ID_LENGTH = 200
const MAX_TODO_TEXT_LENGTH = 1_000
const MAX_TODO_DEPENDENCIES = 30
const MAX_RUNTIME_SUMMARY_LENGTH = 128_000
const runtime_summary_keys = ['verificationState', 'taskPreflightPlan', 'verification'] as const

function normalize_todo_status(value: unknown): ProjectRunTodo['status'] {
  const status = String(value || '').toLowerCase()
  if (status === 'in_progress' || status === 'done' || status === 'blocked') {
    return status
  }
  return 'pending'
}

function normalize_project_run_usage(value: unknown): AgentUsageSummary | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  return {
    provider: String(source.provider || ''),
    model: String(source.model || ''),
    promptTokens: Math.max(0, Number(source.promptTokens) || 0),
    completionTokens: Math.max(0, Number(source.completionTokens) || 0),
    totalTokens: Math.max(0, Number(source.totalTokens) || 0),
    requests: Math.max(0, Number(source.requests) || 0),
    contextWindow: Math.max(0, Number(source.contextWindow) || 0),
    contextRemaining: Math.max(0, Number(source.contextRemaining) || 0),
    contextUsedPct: Math.max(0, Math.min(100, Number(source.contextUsedPct) || 0)),
    estimatedCalls: Math.max(0, Number(source.estimatedCalls) || 0),
    providerReportedCalls: Math.max(0, Number(source.providerReportedCalls) || 0),
    estimatedOnly: source.estimatedOnly === true,
    cacheReadTokens: Math.max(0, Number(source.cacheReadTokens) || 0),
    cacheWriteTokens: Math.max(0, Number(source.cacheWriteTokens) || 0),
    cacheHitRatio: Math.max(0, Math.min(1, Number(source.cacheHitRatio) || 0)),
    nativeSteps: Math.max(0, Number(source.nativeSteps) || 0),
    jsonSteps: Math.max(0, Number(source.jsonSteps) || 0),
    nativeToolAdoption: Math.max(0, Math.min(1, Number(source.nativeToolAdoption) || 0)),
  }
}

function normalize_project_run_runtime_summary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const runtime_summary: Record<string, unknown> = {}

  for (const key of runtime_summary_keys) {
    const candidate = source[key]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    runtime_summary[key] = candidate
  }

  if (!Object.keys(runtime_summary).length) return null
  const serialized = JSON.stringify(runtime_summary)
  if (serialized.length > MAX_RUNTIME_SUMMARY_LENGTH) return null
  return JSON.parse(serialized) as Record<string, unknown>
}

export function normalize_project_run_todos(value: unknown): ProjectRunTodo[] {
  if (!Array.isArray(value)) return []

  return value.slice(0, 100).map((todo, index) => {
    const source = todo && typeof todo === 'object' ? (todo as Record<string, unknown>) : {}
    const dependsOn = (Array.isArray(source.dependsOn)
      ? source.dependsOn
      : Array.isArray(source.depends_on)
        ? source.depends_on
        : []
    )
      .slice(0, MAX_TODO_DEPENDENCIES)
      .map((item) => String(item || '').slice(0, MAX_TODO_ID_LENGTH))
      .filter(Boolean)

    return {
      id: String(source.id ?? index + 1).slice(0, MAX_TODO_ID_LENGTH),
      text:
        String(source.text || 'Untitled task').trim().slice(0, MAX_TODO_TEXT_LENGTH) ||
        'Untitled task',
      status: normalize_todo_status(source.status),
      dependsOn,
    }
  })
}

export function is_active_project_run_status(status: ProjectRunStatus) {
  return active_statuses.has(status)
}

export function is_resumable_project_run_status(status: ProjectRunStatus) {
  return resumable_statuses.has(status)
}

export function is_terminal_project_run_status(status: ProjectRunStatus) {
  return terminal_statuses.has(status)
}

export function project_run_elapsed_ms(state: ProjectRunState | null, now = Date.now()) {
  if (!state) return 0
  if (!is_active_project_run_status(state.status) || !state.segment_started_at) {
    return state.elapsed_ms
  }
  return state.elapsed_ms + Math.max(0, now - state.segment_started_at)
}

export function project_run_progress(todos: ProjectRunTodo[]) {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === 'done').length
  const blocked = todos.filter((todo) => todo.status === 'blocked').length
  const active = todos.filter((todo) => todo.status === 'in_progress').length
  return { total, done, blocked, active }
}

export function normalize_project_run_state(value: unknown): ProjectRunState | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const status = String(source.status || '') as ProjectRunStatus
  const mode = String(source.mode || 'automatic') as ProjectRunMode

  if (
    !source.id ||
    !source.chat_id ||
    (!active_statuses.has(status) &&
      !resumable_statuses.has(status) &&
      !terminal_statuses.has(status))
  ) {
    return null
  }

  return {
    id: String(source.id).slice(0, MAX_RUN_ID_LENGTH),
    chat_id: String(source.chat_id).slice(0, MAX_RUN_ID_LENGTH),
    goal: String(source.goal || '').slice(0, MAX_GOAL_LENGTH),
    mode: mode === 'plan_first' ? 'plan_first' : 'automatic',
    status,
    provider: String(source.provider || '').slice(0, MAX_PROVIDER_LENGTH),
    model: String(source.model || '').slice(0, MAX_MODEL_LENGTH),
    started_at: Number(source.started_at) || Date.now(),
    updated_at: Number(source.updated_at) || Date.now(),
    checkpoint_at: Number(source.checkpoint_at) || 0,
    checkpoint_count: Math.max(0, Number(source.checkpoint_count) || 0),
    elapsed_ms: Math.max(0, Number(source.elapsed_ms) || 0),
    segment_started_at: Math.max(0, Number(source.segment_started_at) || 0),
    todos: normalize_project_run_todos(source.todos),
    steps: Math.max(0, Number(source.steps) || 0),
    summary: typeof source.summary === 'string' ? source.summary.slice(0, 4000) : '',
    runtime_summary: normalize_project_run_runtime_summary(source.runtime_summary),
    usage: normalize_project_run_usage(source.usage),
    last_activity: String(source.last_activity || '').slice(0, 300),
    error: String(source.error || '').slice(0, 1000),
  }
}

function emit() {
  const snapshot = current_state ? { ...current_state, todos: [...current_state.todos] } : null
  for (const listener of listeners) {
    listener(snapshot)
  }
}

function persist() {
  if (!current_state?.chat_id) return
  saveChatSessionState(current_state.chat_id, { projectRun: current_state })
}

function apply_patch(state: ProjectRunState, patch: ProjectRunPatch) {
  if (Object.hasOwn(patch, 'todos')) {
    state.todos = normalize_project_run_todos(patch.todos)
  }
  if (Object.hasOwn(patch, 'steps')) {
    state.steps = Math.max(0, Number(patch.steps) || 0)
  }
  if (Object.hasOwn(patch, 'summary')) {
    const summary = patch.summary && typeof patch.summary === 'object'
      ? patch.summary as Record<string, unknown>
      : null
    state.summary = typeof patch.summary === 'string' ? patch.summary.slice(0, 4000) : state.summary
    state.runtime_summary = normalize_project_run_runtime_summary(summary)
    state.usage = normalize_project_run_usage(summary?.usage)
  }
  if (Object.hasOwn(patch, 'last_activity')) {
    state.last_activity = String(patch.last_activity || '').slice(0, 300)
  }
  if (Object.hasOwn(patch, 'error')) {
    state.error = String(patch.error || '').slice(0, 1000)
  }
  if (Object.hasOwn(patch, 'provider')) {
    state.provider = String(patch.provider || '').slice(0, MAX_PROVIDER_LENGTH)
  }
  if (Object.hasOwn(patch, 'model')) {
    state.model = String(patch.model || '').slice(0, MAX_MODEL_LENGTH)
  }
}

function transition(status: ProjectRunStatus, patch: ProjectRunPatch = {}, now = Date.now()) {
  if (!current_state) return null
  const was_active = is_active_project_run_status(current_state.status)
  const next_active = is_active_project_run_status(status)

  if (was_active && !next_active && current_state.segment_started_at) {
    current_state.elapsed_ms += Math.max(0, now - current_state.segment_started_at)
    current_state.segment_started_at = 0
  } else if (!was_active && next_active) {
    current_state.segment_started_at = now
  }

  current_state.status = status
  current_state.updated_at = now
  apply_patch(current_state, patch)
  persist()
  emit()
  return current_state
}

function checkpoint(patch: ProjectRunPatch = {}) {
  if (!current_state) return null
  const now = Date.now()
  current_state.updated_at = now
  current_state.checkpoint_at = now
  current_state.checkpoint_count += 1
  apply_patch(current_state, patch)
  persist()
  emit()
  return current_state
}

function restore(chat_id: string) {
  const stored = normalize_project_run_state(getChatSessionState(chat_id)?.projectRun)
  if (!stored) {
    current_state = null
    abort_controller = null
    pause_requested = false
    emit()
    return null
  }

  if (is_active_project_run_status(stored.status)) {
    const stop_at = stored.updated_at || Date.now()
    if (stored.segment_started_at) {
      stored.elapsed_ms += Math.max(0, stop_at - stored.segment_started_at)
    }
    stored.segment_started_at = 0
    stored.status = 'interrupted'
    stored.updated_at = Date.now()
    stored.error = 'The previous execution was interrupted before it reached a terminal state.'
    current_state = stored
    abort_controller = null
    pause_requested = false
    persist()
    emit()
    return stored
  }

  current_state = stored
  abort_controller = null
  pause_requested = false
  emit()
  return stored
}

function begin(input: BeginProjectRunInput) {
  const now = Date.now()
  abort_controller = new AbortController()
  pause_requested = false
  current_state = {
    id: String(input.id).slice(0, MAX_RUN_ID_LENGTH),
    chat_id: String(input.chat_id).slice(0, MAX_RUN_ID_LENGTH),
    goal: String(input.goal).slice(0, MAX_GOAL_LENGTH),
    mode: input.mode,
    status: input.mode === 'plan_first' ? 'planning' : 'starting',
    provider: String(input.provider).slice(0, MAX_PROVIDER_LENGTH),
    model: String(input.model).slice(0, MAX_MODEL_LENGTH),
    started_at: now,
    updated_at: now,
    checkpoint_at: now,
    checkpoint_count: 1,
    elapsed_ms: 0,
    segment_started_at: now,
    todos: normalize_project_run_todos(input.todos),
    steps: 0,
    summary: '',
    runtime_summary: null,
    usage: null,
    last_activity: input.mode === 'plan_first' ? 'Planning project run' : 'Starting project run',
    error: '',
  }
  persist()
  emit()
  return { state: current_state, signal: abort_controller.signal }
}

function resume(provider = '', model = '') {
  if (!current_state || !is_resumable_project_run_status(current_state.status)) return null
  abort_controller = new AbortController()
  pause_requested = false
  transition(
    current_state.mode === 'plan_first' && current_state.todos.length === 0
      ? 'planning'
      : 'running',
    {
      error: '',
      last_activity: 'Resuming project run',
      provider: provider || current_state.provider,
      model: model || current_state.model,
    },
  )
  return { state: current_state, signal: abort_controller.signal }
}

function request_pause() {
  if (!current_state || !is_active_project_run_status(current_state.status)) return false
  pause_requested = true
  transition('paused', { last_activity: 'Paused by user' })
  abort_controller?.abort()
  return true
}

function request_cancel(reason = 'Cancelled by user') {
  pause_requested = false
  if (current_state && !is_terminal_project_run_status(current_state.status)) {
    transition('cancelled', { last_activity: reason, error: '' })
  }
  abort_controller?.abort()
}

function complete(patch: ProjectRunPatch = {}) {
  pause_requested = false
  transition('completed', patch)
  abort_controller = null
}

function fail(error: unknown, patch: ProjectRunPatch = {}) {
  pause_requested = false
  transition('failed', { ...patch, error: String(error || 'Project run failed.') })
  abort_controller = null
}

function finish_segment() {
  abort_controller = null
  pause_requested = false
}

function clear(chat_id: string) {
  if (current_state?.chat_id === chat_id) {
    abort_controller?.abort()
    current_state = null
    abort_controller = null
    pause_requested = false
    emit()
  }
  saveChatSessionState(chat_id, { projectRun: null })
}

export const projectRunController = {
  begin,
  checkpoint,
  clear,
  complete,
  fail,
  finish_segment,
  get_signal: () => abort_controller?.signal || null,
  get_state: () => current_state,
  is_pause_requested: () => pause_requested,
  request_cancel,
  request_pause,
  restore,
  resume,
  set_status: transition,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
