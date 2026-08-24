/**
 * Sub-Agent Runtime
 *
 * Simplified execution loop for DeepSeek (executor) and local (scout) agents.
 * Polls the orchestration bus for STP tasks, executes them within tool/budget
 * constraints, and posts structured results back.
 *
 * Key differences from the full agentRuntime:
 *  - Receives STP task objects, not prose
 *  - Tool access capped to stp.tools.available[]
 *  - Duration and repetition guards instead of a fixed reasoning-step ceiling
 *  - Returns structured JSON matching stp.output.schema
 *  - Forbidden tools cause immediate errors, not fallback loops
 *  - Reports tokensUsed, stepsUsed, satisfactionHint back to orchestrator
 */

import { callAIWithMeta } from '@/platform/aiService'
import type { AIMessage } from '@/platform/providers/types'
import {
  listDirectory,
  findFiles,
  readTextFile,
  writeTextFile,
  editTextFile,
  executeTerminalCommand,
  listSkillDefinitions,
  subagentWriteOutput,
  powerDiff,
  powerPatch,
  powerWebFetch,
  launchLocalCommand,
} from '@/platform/desktopBridge'
import { readNotes } from '@/platform/notesStorage'
import { runWebResearchTask } from '@/platform/agent/webResearchTask'
import { lookupTrustedSources } from '@/platform/trustedSources'
import { resolveLauncherEntry } from '@/platform/launcherCatalog'
import { buildSTPSystemPrompt, validateSTPResult, summariseSTP } from '@/platform/stpBuilder'
import type { STPTask } from '@/platform/stpBuilder'
import { skillMatchesRole } from '@/platform/agent/agentSkillEngine'
import { supportsNativeTools, isReasoningModel } from '@/platform/modelProfiles'
import { buildJsonSchemaTools } from '@/platform/agent/toolSchema'
import type { JsonSchemaTool } from '@/platform/agent/types'
import { applyAgentIdentityToSettings, resolveLegacyAgentId } from '@/platform/agent/agentIdentity'
import { deriveModelTags } from '@/platform/agent/modelTags'
import { isMeshEnabled } from '@/platform/agent/meshConductor'
import { releaseTaskWriteLeases } from '@/platform/agent/writeLease'
import {
  recordModelFailure,
  recordModelSuccess,
  pickFailoverModel,
  resolveFailoverPolicy,
} from '@/platform/agent/modelHealth'

// Peer tools any tier may call (advisory, no files/terminal). Dispatched via a lazy import of
// meshClient to avoid an import cycle (meshClient imports executeSTP from this module).
const SUB_AGENT_PEER_TOOLS = ['agent.find', 'agent.consult', 'agent.review']
const SUB_AGENT_MAX_MESH_CALLS = 3
const subAgentMeshCalls = new WeakMap<STPTask, number>()
import type {
  ExplicitStepResult,
  SubAgentEvent,
  SubAgentEventEmitter,
  SubAgentEventListener,
  SubAgentLoopHandle,
  SubAgentRegistryEntry,
  SubAgentRosterEntry,
  SubAgentSettings,
  SubAgentTaskResult,
  SubAgentTaskWaiter,
} from '@/platform/agent/subAgentTypes'
import {
  PERMISSION_TIER,
  getSubAgentMinTier,
  getSubAgentNativeToolDefinitions,
  listSubAgentNativeToolNames,
} from '@/platform/agent/toolCatalog'
import {
  AGENT_STATUS,
  AGENT_TASK_RESULT_TTL_MS,
  TASK_STATUS,
  applyBroadcastToQueuedTasks,
  enqueueAgentTask,
  findActiveTaskStatus,
  pruneExpiredTaskResults,
} from '@/platform/agent/agentBusShared'

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_AGENT_POLL_INTERVAL_MS = 500
// Per model call — capped so one slow call can't eat the whole task budget, but
// generous enough for real (often reasoning/aggregated) models. The old 30s cap
// fired on legitimately slow calls once connections actually completed.
const SUB_AGENT_MODEL_CALL_TIMEOUT_MS = 60000
const SUB_AGENT_REASONING_CALL_TIMEOUT_MS = 120000 // Reasoning models deliberate longer before responding
const SUB_AGENT_DEADLINE_RATIO = 0.85 // Return a partial result before the orchestrator's recall times out
const SUB_AGENT_MAX_TOOL_RESULT_CHARS = 8000 // Sub-agents get more context per result than orchestrator
const SUB_AGENT_MAX_REGISTERED_AGENTS = 16
const SUB_AGENT_MAX_QUEUE_PER_AGENT = 100
const SUB_AGENT_MAX_QUEUE_GLOBAL = 300
const SUB_AGENT_MAX_RESULTS = 500
const SUB_AGENT_MAX_WAITERS_PER_TASK = 16
const SUB_AGENT_MAX_EVENT_LISTENERS = 32
const SUB_AGENT_MAX_BATCH_SIZE = 16
// ── Agent registry (in-memory, tab-local) ─────────────────────────────────────

const agentRegistry = new Map<string, SubAgentRegistryEntry>()
const taskQueue = new Map<string, STPTask[]>()
const taskResults = new Map<string, SubAgentTaskResult>()
const taskResultTimestamps = new Map<string, number>()
const taskWaiters = new Map<string, Set<SubAgentTaskWaiter>>()

// ── Sub-agent live event bus ───────────────────────────────────────────────────
// Sub-agents run in their own polling loop, decoupled from the orchestrator's
// onEvent. This module-level emitter lets the active chat session subscribe and
// surface sub-agent thinking/tool activity in the timeline (tagged with role).

const subAgentListeners = new Set<SubAgentEventListener>()

// Registers a listener for sub agent events and returns the lifecycle needed to stop receiving
// events.
export function subscribeSubAgentEvents(listener: unknown): () => void {
  if (typeof listener !== 'function') return () => {}
  if (subAgentListeners.size >= SUB_AGENT_MAX_EVENT_LISTENERS) {
    throw new Error('Sub-agent event listener limit reached')
  }
  const typedListener = listener as SubAgentEventListener
  subAgentListeners.add(typedListener)
  return () => subAgentListeners.delete(typedListener)
}

// Publishes sub agent event to the listeners or interface that observe this subsystem.
function emitSubAgentEvent(event: SubAgentEvent | null | undefined): void {
  if (!event || !subAgentListeners.size) return
  const enriched: SubAgentEvent = {
    source: 'subagent',
    at: Date.now(),
    ...event,
  }
  for (const listener of subAgentListeners) {
    try {
      listener(enriched)
    } catch {
      /* listener errors are non-fatal */
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown, fallback = 'unknown error'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function trimOutput(value: unknown, maxChars = SUB_AGENT_MAX_TOOL_RESULT_CHARS): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Runs with timeout from initialization through completion, including its cleanup behavior.
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message || `Timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Some OpenAI-compatible aggregators (notably OpenRouter) route a model whose
// underlying endpoint does NOT support function-calling, even when our capability
// registry marks the family native-tool capable — the call then fails with e.g.
// "No endpoints found that support tool use". Detect that class of error so the
// runtime can retry the step on the JSON-in-text protocol instead of failing the
// whole task.
function isToolSupportError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : '').toLowerCase()
  return (
    /tool|function[\s_-]*call/.test(msg) &&
    /(support|not supported|no endpoints|unsupported|cannot|does not|invalid|no allowed)/.test(msg)
  )
}

// Removes expired or excess stale results so retained in-memory state remains bounded.
function pruneStaleResults(): void {
  pruneExpiredTaskResults(taskResults, taskResultTimestamps, Date.now(), AGENT_TASK_RESULT_TTL_MS)
  while (taskResults.size > SUB_AGENT_MAX_RESULTS) {
    const oldestTaskId = taskResultTimestamps.keys().next().value
    if (!oldestTaskId) break
    taskResults.delete(oldestTaskId)
    taskResultTimestamps.delete(oldestTaskId)
  }
}

// Counts all tasks currently waiting across the in-process sub-agent queues.
function totalQueuedTasks(): number {
  let total = 0
  for (const queue of taskQueue.values()) total += queue.length
  return total
}

// Determines whether the task already exists for the sub-agent runtime.
function taskAlreadyExists(taskId: string): boolean {
  if (taskResults.has(taskId)) return true
  for (const queue of taskQueue.values()) {
    if (queue.some((task) => task.taskId === taskId)) return true
  }
  for (const entry of agentRegistry.values()) {
    if (entry.currentTaskId === taskId) return true
  }
  return false
}

// Settle a task (Phase E — notify-on-done). Store the result, then resolve any
// orchestrator waiters IMMEDIATELY and emit a settle event, instead of leaving the
// orchestrator to poll and guess a wait time. The single completion path so both
// the success and error branches notify identically.
function settleTask(taskId: string, result: SubAgentTaskResult): void {
  releaseTaskWriteLeases(taskId)
  taskResults.set(taskId, result)
  taskResultTimestamps.set(taskId, Date.now())
  pruneStaleResults()
  const waiters = taskWaiters.get(taskId)
  if (waiters) {
    taskWaiters.delete(taskId)
    for (const notify of waiters) {
      try {
        notify(result)
      } catch {
        /* non-fatal */
      }
    }
  }
  emitSubAgentEvent({
    type: 'task_settled',
    taskId,
    status: result?.status,
    agentId: result?.agentId,
    outputPath: result?.outputPath || '',
  })
}

// ── Agent identity resolution ─────────────────────────────────────────────────

/**
 * Compatibility resolver for the historical provider/model-derived agent id.
 * New orchestration code should route by role; this export remains stable for
 * existing callers and persisted identifiers.
 *
 * @param {object} settings
 * @returns {'claude'|'deepseek'|'local'|'openai'|'gemini'|'unknown'}
 */
export function resolveAgentId(settings: SubAgentSettings | null | undefined): string {
  return resolveLegacyAgentId(settings)
}

// ── Registry helpers ──────────────────────────────────────────────────────────

function ensureAgentEntry(agentId: string): SubAgentRegistryEntry {
  if (!agentRegistry.has(agentId)) {
    if (agentRegistry.size >= SUB_AGENT_MAX_REGISTERED_AGENTS) {
      throw new Error('Sub-agent registry limit reached')
    }
    agentRegistry.set(agentId, {
      status: AGENT_STATUS.IDLE,
      currentTaskId: null,
      lastSeen: Date.now(),
      capabilities: [],
      health: { successRate: 1.0, consecutiveFailures: 0, suspended: false },
    })
  }

  if (!taskQueue.has(agentId)) {
    taskQueue.set(agentId, [])
  }

  return agentRegistry.get(agentId) as SubAgentRegistryEntry
}

// Changes agent status and performs any related synchronization required by the feature.
function setAgentStatus(
  agentId: string,
  status: SubAgentRegistryEntry['status'],
  currentTaskId: string | null = null,
): void {
  const entry = ensureAgentEntry(agentId)
  entry.status = status
  entry.currentTaskId = currentTaskId
  entry.lastSeen = Date.now()
}

// Records agent success without making observability a required success path.
function recordAgentSuccess(agentId: string): void {
  const entry = agentRegistry.get(agentId)
  if (!entry) return

  entry.health.consecutiveFailures = 0
  entry.health.successRate = Math.min(1.0, entry.health.successRate * 0.95 + 0.05)
  entry.health.suspended = false
}

// Records agent failure without making observability a required success path.
function recordAgentFailure(agentId: string): void {
  const entry = agentRegistry.get(agentId)
  if (!entry) return

  entry.health.consecutiveFailures += 1
  entry.health.successRate = Math.max(0, entry.health.successRate * 0.9)

  if (entry.health.consecutiveFailures >= 3) {
    entry.health.suspended = true
  }
}

// ── Roster API ────────────────────────────────────────────────────────────────

/**
 * Returns current snapshot of all registered agents.
 *
 * @returns {object[]} Array of agent status records
 */
export function getAgentRoster(): SubAgentRosterEntry[] {
  const now = Date.now()
  const agents: SubAgentRosterEntry[] = []

  for (const [id, entry] of agentRegistry) {
    agents.push({
      id,
      status: entry.status,
      currentTaskId: entry.currentTaskId || null,
      lastSeen: entry.lastSeen,
      lastSeenSec: Math.round((now - entry.lastSeen) / 1000),
      queueDepth: (taskQueue.get(id) || []).length,
      health: { ...entry.health },
    })
  }

  return agents
}

/**
 * Returns true when the given agent is idle and not suspended.
 *
 * @param {string} agentId
 * @returns {boolean}
 */
export function isAgentAvailable(agentId: string): boolean {
  const entry = agentRegistry.get(agentId)
  if (!entry) return false
  if (entry.health.suspended) return false
  return entry.status === AGENT_STATUS.IDLE
}

// ── Task queue API ────────────────────────────────────────────────────────────

/**
 * Post an STP task to an agent's queue.
 * Returns the taskId for subsequent recall/status checks.
 *
 * @param {object} stp  - Output of buildSTP()
 * @returns {string}    - taskId
 */
export function postTask(stp: STPTask): string {
  const agentId = String(stp.toAgent || 'deepseek')
  const taskId = String(stp.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required')
  if (taskAlreadyExists(taskId)) throw new Error(`Task ${taskId} already exists`)
  ensureAgentEntry(agentId)

  const queue = taskQueue.get(agentId) as STPTask[]
  if (queue.length >= SUB_AGENT_MAX_QUEUE_PER_AGENT) {
    throw new Error(`${agentId} task queue limit reached`)
  }
  if (totalQueuedTasks() >= SUB_AGENT_MAX_QUEUE_GLOBAL) {
    throw new Error('Global sub-agent task queue limit reached')
  }

  enqueueAgentTask(queue, stp)
  return taskId
}

/**
 * Post multiple tasks and return all taskIds.
 * Used for parallel delegation bursts.
 *
 * @param {object[]} stpList
 * @returns {string[]} taskIds
 */
export function postTaskBatch(stpList: readonly STPTask[]): string[] {
  if (!Array.isArray(stpList)) throw new Error('Task batch must be an array')
  if (stpList.length > SUB_AGENT_MAX_BATCH_SIZE) {
    throw new Error(`Task batch exceeds the ${SUB_AGENT_MAX_BATCH_SIZE}-task limit`)
  }
  return stpList.map((stp) => postTask(stp))
}

/**
 * Poll the result for a single task.
 * Returns null if not yet complete.
 *
 * @param {string} taskId
 * @returns {object|null}
 */
export function pollTaskResult(taskId: string): SubAgentTaskResult | null {
  return taskResults.get(taskId) || null
}

/**
 * Wait for a single task to complete (SSE-free promise-based poller).
 * Resolves with the result or rejects on timeout.
 *
 * @param {string} taskId
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
export function waitForTask(taskId: string, timeoutMs = 30000): Promise<SubAgentTaskResult> {
  // Notify-on-done (Phase E): resolve the instant the task settles (settleTask
  // pushes to our waiter), rather than polling every interval and guessing. The
  // timeout is only a safety net behind the notification.
  const existing = taskResults.get(taskId)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    let done = false
    // Settles the current operation exactly once and publishes its terminal result.
    const finish = <T>(fn: (value: T) => void, arg: T): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      const set = taskWaiters.get(taskId)
      if (set) {
        set.delete(onSettle)
        if (!set.size) taskWaiters.delete(taskId)
      }
      fn(arg)
    }
    const onSettle: SubAgentTaskWaiter = (result) => finish(resolve, result)
    const timer = setTimeout(() => {
      const late = taskResults.get(taskId)
      if (late) finish(resolve, late)
      else finish(reject, new Error(`Task ${taskId} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    if (!taskWaiters.has(taskId)) taskWaiters.set(taskId, new Set())
    const waiters = taskWaiters.get(taskId) as Set<SubAgentTaskWaiter>
    if (waiters.size >= SUB_AGENT_MAX_WAITERS_PER_TASK) {
      clearTimeout(timer)
      reject(new Error(`Task ${taskId} waiter limit reached`))
      return
    }
    waiters.add(onSettle)
    // Race guard: a result stored between the initial check and registration.
    const raced = taskResults.get(taskId)
    if (raced) finish(resolve, raced)
  })
}

/**
 * Wait for all tasks in a batch to complete.
 *
 * @param {string[]} taskIds
 * @param {number} timeoutMs
 * @returns {Promise<object[]>}
 */
export function waitForAllTasks(taskIds: readonly string[], timeoutMs = 60000): Promise<SubAgentTaskResult[]> {
  return Promise.all(taskIds.map((id) => waitForTask(id, timeoutMs)))
}

/**
 * Get lightweight status for a task (no result data).
 *
 * @param {string} taskId
 * @returns {'pending'|'running'|'done'|'failed'|'timeout'|'unknown'}
 */
export function getTaskStatus(taskId: string): SubAgentTaskResult['status'] | 'unknown' {
  const result = taskResults.get(taskId)
  if (!result) {
    return findActiveTaskStatus(taskId, taskQueue, agentRegistry)
  }

  return result.status
}

// ── Tool broker for sub-agents ─────────────────────────────────────────────────

/**
 * Execute a single tool call within sub-agent context.
 * Respects stp.tools.available and stp.tools.forbidden.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} stp
 * @returns {Promise<object>}
 */
// ── Sub-agent tool safety ─────────────────────────────────────────────────────
// Sub-agents (delegated executors/scouts) MUST enforce the same path/command
// safety controls as the main agent. Without this, a delegated task can write
// any path or run any command, bypassing the strict safety profile entirely.
// These checks are intentionally self-contained to avoid an import cycle with
// agentRuntime (agentRuntime → orchestrationClient → subAgentRuntime).

const SUB_PATH_TRAVERSAL = /(^|[/\\])\.\.([/\\]|$)/
const SUB_BLOCKED_READ = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /id_rsa|id_ed25519|\.pem$|\.key$/i,
  /(^|\/)\.env(\.|$)/i,
  /\/etc\/(shadow|passwd|sudoers)/i,
]
const SUB_BLOCKED_WRITE = [/^\/(etc|boot|sys|proc|usr|bin|sbin|lib|dev)(\/|$)/i, /(^|\/)\.ssh(\/|$)/i, /\/etc\//i]
const SUB_DANGEROUS_COMMAND = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/i,
  /\bmkfs\b/i,
  /\bdd\s+[^|]*of=\/dev/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  />\s*\/dev\/sd[a-z]/i,
]
const SUB_SUDO = /(^|\s)sudo(\s|$)/i
const SUB_PIPE_TO_SHELL = /(curl|wget|fetch)\s+[^|;]*\|\s*(sudo\s+)?(sh|bash|zsh|python|perl|node)\b/i
const SUB_NETWORK = /\b(curl|wget|nc|ncat|telnet|ssh|scp|sftp|rsync|ftp)\b/i

// Permission tiers and per-tool minimums are centralized in toolCatalog.
const ROLE_DEFAULT_TIER: Readonly<Record<string, number>> = {
  orchestrator: PERMISSION_TIER.POWER,
  executor: PERMISSION_TIER.STANDARD,
  scout: PERMISSION_TIER.READ_ONLY,
}

/** Resolve a sub-agent's effective permission tier from settings + role default. */
function resolveSubAgentTier(stp: STPTask, settings: SubAgentSettings): number {
  const role = String(stp?.agentIdentity?.role || stp?.toAgent || 'executor').toLowerCase()
  // Per-role key, then the (shared) global tier, then the role default — mirrors
  // the main agent's resolveSafetyConfig so the two never diverge.
  const raw = settings?.[`agent_permission_tier_${role}`] ?? settings?.agent_permission_tier
  const def = ROLE_DEFAULT_TIER[role] ?? PERMISSION_TIER.STANDARD
  return Number.isFinite(Number(raw)) ? Math.max(0, Math.min(3, Number(raw))) : def
}

// Selects or derives sub agent capabilities from the available settings, input, and runtime
// context.
function resolveSubAgentCapabilities(settings: SubAgentSettings) {
  return {
    fileRead: settings?.permissions_file_read !== false,
    fileWrite: settings?.permissions_file_write !== false,
    terminal: settings?.permissions_terminal !== false,
  }
}

// Selects or derives sub agent safety from the available settings, input, and runtime context.
function resolveSubAgentSafety(settings: SubAgentSettings, tier?: number) {
  const t = Number.isFinite(Number(tier)) ? Number(tier) : PERMISSION_TIER.STANDARD
  return {
    strict: String(settings?.agent_safety_profile || 'strict').toLowerCase() === 'strict',
    blockSudo: settings?.agent_block_sudo !== false || t < PERMISSION_TIER.POWER,
    allowNetwork:
      t >= PERMISSION_TIER.POWER
        ? settings?.agent_allow_network_commands !== false
        : settings?.agent_allow_network_commands === true,
  }
}

/**
 * Validates the required conditions for sub agent path safe and stops the operation when
 * they are not satisfied.
 */

function assertSubAgentPathSafe(
  pathInput: unknown,
  operation: 'read' | 'write' | 'cwd',
  settings: SubAgentSettings,
): string {
  const raw = String(pathInput || '').trim()
  if (!raw) throw new Error('Path is required.')
  if (raw.includes('\0')) throw new Error('Path contains invalid null bytes.')

  const safety = resolveSubAgentSafety(settings)
  if (!safety.strict) return raw

  const normalized = raw.replace(/\\/g, '/')
  if ((operation === 'write' || operation === 'cwd') && SUB_PATH_TRAVERSAL.test(normalized)) {
    throw new Error('Path traversal is blocked by strict safety profile.')
  }
  if (operation === 'read' && SUB_BLOCKED_READ.some((p) => p.test(normalized))) {
    throw new Error('Read path blocked by strict safety profile.')
  }
  if ((operation === 'write' || operation === 'cwd') && SUB_BLOCKED_WRITE.some((p) => p.test(normalized))) {
    throw new Error('Write path blocked by strict safety profile.')
  }
  return raw
}

// Rejects sub-agent terminal commands that violate the delegated task or safety policy.
function assertSubAgentCommandSafe(command: unknown, settings: SubAgentSettings, tier: number): string {
  const text = String(command || '').trim()
  if (!text) throw new Error('Command is required.')
  if (SUB_DANGEROUS_COMMAND.some((p) => p.test(text))) throw new Error('Command blocked by safety policy.')
  if (SUB_PIPE_TO_SHELL.test(text)) throw new Error('Command blocked: pipe-to-shell execution is not allowed.')

  const safety = resolveSubAgentSafety(settings, tier)
  // Sub-agents have no per-command approval channel, so when sudo isn't fully
  // cleared (guard off + Tier 3) it's blocked rather than prompted — the main
  // agent keeps its interactive elevation prompt.
  if (safety.blockSudo && SUB_SUDO.test(text)) throw new Error('Commands using sudo are blocked by safety settings.')
  if (!safety.allowNetwork && SUB_NETWORK.test(text))
    throw new Error('Network-related commands are blocked by safety settings.')
  return text
}

/**
 * Executes one tool requested by a delegated executor or scout after applying the task's
 * role, tier, allowlist, and safety constraints. Results are bounded and normalized before
 * they are returned to the sub-agent model loop.
 */

async function executeSubAgentTool(
  toolName: unknown,
  args: unknown,
  stp: STPTask,
  settings: SubAgentSettings = {},
): Promise<unknown> {
  const name = String(toolName || '').trim()
  const file_operation = {
    actorId: String(stp?.toAgent || stp?.agentIdentity?.role || 'subagent'),
    taskId: String(stp?.taskId || ''),
    holdLease: true,
  }

  // Forbidden tools hard-block
  if (stp.tools.forbidden.includes(name)) {
    throw new Error(`Tool "${name}" is forbidden for this task.`)
  }

  // Tool availability has explicit semantics: omitted/auto uses tier defaults, an explicit
  // empty list grants no tools, and a populated explicit list grants only those named tools.
  const toolMode = stp?.tools?.mode === 'explicit' ? 'explicit' : 'auto'
  if (toolMode === 'explicit' && !stp.tools.available.includes(name)) {
    throw new Error(`Tool "${name}" is not in the available tool list for this task.`)
  }

  // Peer tools (mesh) are advisory, but they still obey an explicit task whitelist.
  // They are advisory (no files/terminal) and don't recurse (consulted peers run tool-free), so
  // they're safe at any tier; capped per sub-task to bound cost.
  if (SUB_AGENT_PEER_TOOLS.includes(name)) {
    const safeMeshArgs = isRecord(args) ? args : {}
    if (!isMeshEnabled(settings)) {
      return {
        error: 'Peer tools are off. Enable the communication bridge + peer consultation in Settings → Agents.',
      }
    }
    const used = subAgentMeshCalls.get(stp) || 0
    if (used >= SUB_AGENT_MAX_MESH_CALLS) {
      return {
        error: 'Peer-help budget for this sub-task is spent — finish with what you have.',
      }
    }
    subAgentMeshCalls.set(stp, used + 1)
    const mesh = await import('@/platform/agent/meshClient')
    if (name === 'agent.find') return mesh.handleAgentFind(safeMeshArgs, settings)
    if (name === 'agent.review') return mesh.runPeerReview(safeMeshArgs, settings)
    const selfRole = String(stp?.agentIdentity?.role || stp?.toAgent || '')
    const target = mesh.resolveConsultTarget(safeMeshArgs, settings, selfRole ? [selfRole] : [])
    if (!target) {
      return {
        consulted: false,
        reason: 'no_peer',
        message: 'No distinct peer is configured to consult.',
      }
    }
    return mesh.runPeerConsult(target, safeMeshArgs, settings)
  }

  // Capability toggles — checked the SAME way the main agent does
  // (evaluateToolAccess), so the File/Terminal switches in Settings → Permissions
  // apply to sub-agents too (a sub-agent can no longer write/exec when those
  // toggles are off, and now honours them when they're on). Error text matches
  // the main agent so isCapabilityOrPermissionError classifies it identically.
  const cap = resolveSubAgentCapabilities(settings)
  if (
    (name === 'files.read' || name === 'files.find' || name === 'files.list' || name === 'files.diff') &&
    !cap.fileRead
  ) {
    throw new Error('File System Read permission is disabled.')
  }
  if ((name === 'files.write' || name === 'files.patch' || name === 'files.edit') && !cap.fileWrite) {
    throw new Error('File System Write permission is disabled.')
  }
  if ((name === 'terminal.exec' || name === 'launch.run') && !cap.terminal) {
    throw new Error('Terminal Execution permission is disabled.')
  }

  // Per-role permission-tier enforcement at the call layer. The role's tier comes
  // from the Permissions tab (agent_permission_tier_<role>); scout defaults to
  // read-only (tier 1), executor to standard (tier 2). Users can elevate a role
  // (e.g. scout → tier 3) and that is honoured here. Both the capability toggle
  // above AND the tier here must clear — matching the main agent.
  const tier = resolveSubAgentTier(stp, settings)
  const minTier = getSubAgentMinTier(name, PERMISSION_TIER.STANDARD)
  if (tier < minTier) {
    throw new Error(
      `Tool "${name}" requires permission tier ${minTier}; the ${String(stp?.toAgent || 'agent')} role is tier ${tier}. Elevate it in Settings → Permissions.`,
    )
  }

  const safeArgs = isRecord(args) ? args : {}

  switch (name) {
    case 'files.list':
      return listDirectory(String(safeArgs.path || '~'), Number(safeArgs.depth) || 3)

    case 'files.find':
      return findFiles(String(safeArgs.path || '.'), String(safeArgs.query || ''), {
        mode: String(safeArgs.mode || 'auto'),
        ignoreCase: safeArgs.ignoreCase !== false,
        depth: Number(safeArgs.depth) || 5,
        maxResults: Number(safeArgs.maxResults) || 24,
        fuzzy: safeArgs.fuzzy !== false,
        useRegex: Boolean(safeArgs.useRegex),
      })

    case 'files.read':
      return readTextFile(assertSubAgentPathSafe(String(safeArgs.path || ''), 'read', settings), {
        startLine: Number(safeArgs.startLine) || 1,
        lineCount: Number(safeArgs.lineCount) || 220,
        ...file_operation,
      })

    case 'files.write':
      return writeTextFile(
        assertSubAgentPathSafe(String(safeArgs.path || ''), 'write', settings),
        String(safeArgs.content || ''),
        file_operation,
      )

    case 'files.diff':
      return powerDiff(
        assertSubAgentPathSafe(String(safeArgs.path || ''), 'read', settings),
        String(safeArgs.newContent || ''),
        Number.isFinite(Number(safeArgs.contextLines)) ? Number(safeArgs.contextLines) : 3,
      )

    case 'files.patch': {
      const patch = String(safeArgs.patch || '')
      if (!patch) throw new Error('patch is required for files.patch')
      return powerPatch(
        assertSubAgentPathSafe(String(safeArgs.path || ''), 'write', settings),
        patch,
        safeArgs.dryRun === true,
        file_operation,
      )
    }

    case 'files.edit': {
      const oldText = String(safeArgs.oldText ?? safeArgs.oldString ?? '')
      if (!oldText) throw new Error('oldText is required for files.edit.')
      return editTextFile(
        assertSubAgentPathSafe(String(safeArgs.path || ''), 'write', settings),
        oldText,
        String(safeArgs.newText ?? safeArgs.newString ?? ''),
        { replaceAll: safeArgs.replaceAll === true, ...file_operation },
      )
    }

    case 'terminal.exec':
      return executeTerminalCommand(
        assertSubAgentCommandSafe(String(safeArgs.command || ''), settings, tier),
        safeArgs.cwd ? assertSubAgentPathSafe(String(safeArgs.cwd), 'cwd', settings) : undefined,
      )

    case 'launch.run': {
      // Resolve a launcher menu entry by name (catalog already populated by the main session), or
      // run a raw command. A raw command goes through the same safety gate as terminal.exec.
      const launchName = String(safeArgs.name || safeArgs.app || '').trim()
      const cwd = safeArgs.cwd ? assertSubAgentPathSafe(String(safeArgs.cwd), 'cwd', settings) : undefined
      let category = String(safeArgs.category || 'command')
        .trim()
        .toLowerCase()
      let commandInput = String(safeArgs.command || '').trim()
      if (launchName) {
        const entry = resolveLauncherEntry(launchName, { agentOnly: true })
        if (!entry) {
          throw new Error(`No launcher named "${launchName}". Use a raw command or check the main launcher menu.`)
        }
        if (!category) category = String(entry.category || 'command').toLowerCase()
        if (entry.executable) {
          return launchLocalCommand({
            executable: entry.executable,
            args: entry.args || [],
            category,
            cwd: entry.cwd || cwd,
          })
        }
        commandInput = String(entry.command || '').trim()
      }
      if (!['command', 'app', 'script', 'url'].includes(category)) {
        throw new Error('Invalid launch category.')
      }
      return launchLocalCommand(assertSubAgentCommandSafe(commandInput, settings, tier), category, cwd)
    }

    case 'notes.list':
      return { notes: readNotes().slice(0, 60) }

    case 'search.web':
      return runWebResearchTask(String(safeArgs.query || ''), {
        settings,
        maxResults: Number(safeArgs.maxResults) || 6,
        maxSources: Number(safeArgs.maxSources) || 3,
        enablePlanning: false,
        includeContent: true,
        allowPaidFallback: false,
      })

    case 'web.fetch': {
      const url = String(safeArgs.url || '').trim()
      if (!/^https?:\/\//.test(url)) throw new Error('valid https url required for web.fetch')
      return powerWebFetch(url, {
        extract: String(safeArgs.extract || 'text'),
        ...(Number.isFinite(Number(safeArgs.maxChars)) ? { maxChars: Number(safeArgs.maxChars) } : {}),
      })
    }

    case 'sources.lookup':
      return lookupTrustedSources(String(safeArgs.topic || safeArgs.query || ''), {
        kind: safeArgs.kind as string | undefined,
        limit: safeArgs.limit as number | undefined,
      })

    case 'skills.list': {
      const result = await listSkillDefinitions(String(safeArgs.profile || 'default-model'))
      return result
    }

    case 'skills.search': {
      const query = String(safeArgs.query || '')
        .toLowerCase()
        .trim()
      const role = String(stp?.agentIdentity?.role || stp?.toAgent || 'executor')
      const result = await listSkillDefinitions('default-model')
      const skills = Array.isArray(result?.skills) ? result.skills : []
      const matches = skills
        .filter(Boolean)
        .filter((s) => skillMatchesRole(s, role))
        .filter((s) => {
          if (!query) return true
          const hay = `${s.id} ${s.title} ${s.summary} ${(s.triggers || []).join(' ')}`.toLowerCase()
          return query.split(/\s+/).some((tok) => tok && hay.includes(tok))
        })
        .slice(0, 12)
        .map((s) => ({ id: s.id, title: s.title, summary: s.summary }))
      return { skills: matches }
    }

    case 'skills.load': {
      const ids = Array.isArray(safeArgs.ids)
        ? safeArgs.ids.map((id) => String(id))
        : safeArgs.ids
          ? [String(safeArgs.ids)]
          : []
      if (!ids.length) throw new Error('ids is required for skills.load')
      const result = await listSkillDefinitions('default-model')
      const skills = Array.isArray(result?.skills) ? result.skills : []
      const loaded = ids
        .map((id) => skills.find((s) => String(s.id) === id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => {
          const modelVariants = isRecord(s.modelVariants) ? s.modelVariants : {}
          const text =
            stp.skills.variant === 'simple' ? modelVariants.simple || s.instructions || '' : s.instructions || ''
          return {
            id: s.id,
            title: s.title,
            instructions: String(text).slice(0, 6000),
          }
        })
      if (!loaded.length) return { loaded: [], message: 'No skill matched the requested id(s).' }
      return { loaded }
    }

    case 'skills.offload':
      // Sub-agent skills are statically pre-baked into the system prompt rather than carried in a
      // mutable active set, so there is nothing to free mid-task; acknowledge so the model moves on.
      return {
        offloaded: true,
        note: 'Sub-agent skills are fixed for the task; nothing to free.',
      }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── STP step executor ─────────────────────────────────────────────────────────

async function executeExplicitSteps(
  stp: STPTask,
  settings: SubAgentSettings,
  emit: SubAgentEventEmitter = () => {},
): Promise<{
  stepResults: ExplicitStepResult[]
  toolsUsed: string[]
  totalTokens: number
}> {
  const toolsUsed: string[] = []
  const stepResults: ExplicitStepResult[] = []
  let totalTokens = 0

  for (const step of stp.steps) {
    if (!step.action) continue

    emit({
      type: 'tool_call',
      tool: step.action,
      argsPreview: trimOutput(step.args, 300),
      step: step.order,
    })

    try {
      const startedAt = Date.now()
      const toolResult = await runWithTimeout(
        executeSubAgentTool(step.action, step.args, stp, settings),
        15000,
        `Step ${step.order} tool "${step.action}" timed out`,
      )

      const preview = trimOutput(toolResult)
      stepResults.push({
        order: step.order,
        action: step.action,
        ok: true,
        result: preview,
      })
      toolsUsed.push(step.action)
      totalTokens += Math.ceil(preview.length / 4)
      emit({
        type: 'tool_result',
        tool: step.action,
        status: 'ok',
        outputPreview: preview.slice(0, 600),
        durationMs: Date.now() - startedAt,
        step: step.order,
      })
    } catch (error: unknown) {
      const errorMsg = errorMessage(error, 'Unknown error')

      if (step.onError) {
        stepResults.push({
          order: step.order,
          action: step.action,
          ok: false,
          error: errorMsg,
          fallback: step.onError,
        })
        // Fallback instruction is passed to the model context — not re-executed here
      } else {
        stepResults.push({
          order: step.order,
          action: step.action,
          ok: false,
          error: errorMsg,
        })
      }
      emit({
        type: 'tool_result',
        tool: step.action,
        status: 'error',
        outputPreview: errorMsg.slice(0, 600),
        step: step.order,
      })
    }
  }

  return { stepResults, toolsUsed, totalTokens }
}

// ── Core STP execution ────────────────────────────────────────────────────────

/**
 * Execute a single STP task using the provided AI settings.
 *
 * @param {object} stp       - The STP task object from buildSTP()
 * @param {object} settings  - AI provider settings (same shape as agentRuntime)
 * @returns {Promise<object>} Task result object
 */
// Native sub-agent tool schemas are centralized in toolCatalog.
function buildSubAgentNativeTools(stp: STPTask, settings: SubAgentSettings = {}): JsonSchemaTool[] {
  const requested = Array.isArray(stp?.tools?.available) ? stp.tools.available : []
  const forbidden = Array.isArray(stp?.tools?.forbidden) ? stp.tools.forbidden : []
  const explicit = stp?.tools?.mode === 'explicit'
  const tier = resolveSubAgentTier(stp, settings)
  const available = explicit
    ? requested
    : listSubAgentNativeToolNames().filter((name) => getSubAgentMinTier(name, PERMISSION_TIER.STANDARD) <= tier)
  const defs = getSubAgentNativeToolDefinitions(available, forbidden)
  // Auto mode includes advisory peer tools when the bridge is enabled. Explicit mode includes them
  // only when the task author named them, and [] therefore means no tools at all.
  if (isMeshEnabled(settings) && !explicit) {
    const meshNames = SUB_AGENT_PEER_TOOLS.filter(
      (name) => !forbidden.includes(name) && !defs.some((definition) => definition.name === name),
    )
    defs.push(...getSubAgentNativeToolDefinitions(meshNames, forbidden))
  }
  return buildJsonSchemaTools(defs)
}

/**
 * Loads and bounds the skill instructions requested by one Structured Task Protocol assignment.
 * Skill failures remain non-fatal so delegated work can continue without optional guidance.
 */
export async function loadSubAgentSkillBlocks(stp: STPTask, role: string): Promise<string[]> {
  if (stp.skills.load.length === 0) return []
  try {
    const profile = stp.skills.load[0]
    const skillResult = await listSkillDefinitions(profile)
    return Array.isArray(skillResult?.skills)
      ? skillResult.skills
          .filter(Boolean)
          .filter((skill) => skillMatchesRole(skill, role))
          .map((skill) => {
            const modelVariants = isRecord(skill.modelVariants) ? skill.modelVariants : {}
            const text =
              stp.skills.variant === 'simple'
                ? modelVariants.simple || skill.instructions || ''
                : skill.instructions || ''
            return `[${skill.title}]\n${text}`
          })
          .filter(Boolean)
          .slice(0, 4)
      : []
  } catch {
    return []
  }
}

/**
 * Builds the persistent sub-agent model thread from the system prompt, explicit step results, and
 * required output schema. The same thread is then extended by native or JSON tool results.
 */
export function buildSubAgentModelMessages(stp: STPTask, systemPrompt: string, explicitContext: string): AIMessage[] {
  const userContent = explicitContext
    ? `STEP RESULTS:\n${explicitContext}\n\nNow produce the output JSON matching the schema.`
    : `Execute the task. Produce output JSON matching the schema: ${JSON.stringify(stp.output.schema)}`
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]
}

/**
 * Recovers a sub-agent JSON decision from plain text or fenced output. A balanced object fallback
 * preserves compatibility with models that add prose around the required response.
 */
export function parseSubAgentModelJson(rawText: string): unknown {
  try {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/g, '')
      .trim()
    return JSON.parse(cleaned)
  } catch {
    const firstBrace = rawText.indexOf('{')
    const lastBrace = rawText.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(rawText.slice(firstBrace, lastBrace + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Executes one Structured Task Protocol assignment for an executor or scout. It builds a
 * role-constrained model loop, exposes only allowed tools, records progress, persists large
 * output by reference, and returns a bounded result to the orchestrator.
 */

export async function executeSTP(
  stp: STPTask,
  settings: SubAgentSettings,
  emit: SubAgentEventEmitter = () => {},
  signal?: AbortSignal,
): Promise<SubAgentTaskResult> {
  const startedAt = Date.now()
  const role = String(stp?.agentIdentity?.role || stp?.toAgent || 'executor')
  const toolsUsed: string[] = []
  let stepsUsed = 0
  let totalTokens = 0

  // Soft deadline: return a partial result before the task's hard timeout (and
  // before the orchestrator's recall) instead of being killed with stepsUsed:0.
  const taskTimeoutMs = Number(stp?.budget?.timeoutMs) || 100000
  let softDeadline = startedAt + Math.max(8000, Math.round(taskTimeoutMs * SUB_AGENT_DEADLINE_RATIO))

  // Per-call timeout cap — reasoning models (o-series, R1, etc.) deliberate longer
  // before they emit a token, so they get the larger cap.
  const modelCallCap = isReasoningModel(settings?.ai_provider, settings?.ai_model)
    ? SUB_AGENT_REASONING_CALL_TIMEOUT_MS
    : SUB_AGENT_MODEL_CALL_TIMEOUT_MS

  emit({ type: 'thinking', summary: `Picked up task: ${summariseSTP(stp)}` })

  const skillBlocks = await loadSubAgentSkillBlocks(stp, role)

  // Native tool-calling for capable sub-agent models (hybrid: native tool calls
  // for actions, final result still returned as JSON text matching the schema).
  const subAgentNative =
    supportsNativeTools(settings?.ai_provider, settings?.ai_model) && settings?.native_tools_enabled !== false
  const nativeTools = subAgentNative ? buildSubAgentNativeTools(stp, settings) : []
  // `let`, not `const`: a provider that rejects native tools (e.g. an OpenRouter
  // route without function-calling) flips this off and the loop retries on the
  // JSON-in-text path rather than failing the task.
  let useNativeTools = nativeTools.length > 0

  const systemPrompt = buildSTPSystemPrompt(stp, skillBlocks, {
    native: useNativeTools,
  })

  // If steps are explicit, execute them directly first
  let explicitContext = ''
  if (stp.steps.length > 0) {
    const {
      stepResults,
      toolsUsed: stepTools,
      totalTokens: stepTokens,
    } = await executeExplicitSteps(stp, settings, emit)
    stepTools.forEach((t) => toolsUsed.push(t))
    totalTokens += stepTokens
    stepsUsed += stp.steps.length

    // Summarise step results to feed the model
    explicitContext = stepResults
      .map((sr) =>
        sr.ok
          ? `Step ${sr.order} [${sr.action}]: ${sr.result}`
          : `Step ${sr.order} [${sr.action}] FAILED: ${sr.error}${sr.fallback ? ` → fallback: ${sr.fallback}` : ''}`,
      )
      .join('\n\n')
  }

  const messages = buildSubAgentModelMessages(stp, systemPrompt, explicitContext)

  // Autonomous reasoning loop. Local workers are bounded by elapsed time and model/tool
  // repetition guards rather than an arbitrary number of reasoning turns.
  let finalResult: unknown = null
  let loopError: unknown = null
  let repetitionHit = false
  let lastResponseFingerprint = ''
  let repeatedResponseCount = 0

  let deadlineHit = false

  // Sub-agent model fallback (§F3): if this member's model fails (rate limit / API error), switch it
  // to a healthy model by role fit and retry — instead of failing the whole task. Bounded by the
  // failover policy (off / limited-N / exhaust). `activeSettings` carries the swapped model.
  let activeSettings = settings
  const subModel = {
    provider: String(stp?.agentIdentity?.provider || settings?.ai_provider || ''),
    model: String(stp?.agentIdentity?.model || settings?.ai_model || ''),
    keyId: String(stp?.agentIdentity?.keyId || '1'),
  }
  let subFailoverSwitches = 0
  const isRateLimitError = (msg: unknown): boolean =>
    /rate.?limit|429|too many requests|quota|overloaded/i.test(String(msg || ''))
  const trySubAgentFailover = async (error: unknown): Promise<boolean> => {
    const policy = resolveFailoverPolicy(settings as Record<string, unknown>)
    const errMsg = errorMessage(error)
    recordModelFailure(subModel.provider, subModel.model, subModel.keyId, {
      error: errMsg,
      rateLimited: isRateLimitError(errMsg),
    })
    if (!policy.enabled || subFailoverSwitches >= policy.maxAttempts) return false
    const role = String(stp?.agentIdentity?.role || stp?.toAgent || 'executor')
    const pick = pickFailoverModel(settings as Record<string, unknown>, subModel, {
      preferRole: role,
    })
    if (!pick) return false
    subFailoverSwitches += 1
    // The stand-in keeps THIS task's assigned role (e.g. overwatcher), not the fallback model's
    // native role — so a model picked from another role's pool still runs AS the overwatcher with
    // the overwatcher's tier, instead of acting as its original role under mismatched permissions.
    activeSettings = applyAgentIdentityToSettings(settings as never, {
      role: role as never,
      provider: pick.provider,
      model: pick.model,
      keyId: pick.keyId,
      explicitlyAssigned: true,
    }) as SubAgentSettings
    subModel.provider = pick.provider
    subModel.model = pick.model
    subModel.keyId = pick.keyId
    const attemptLabel =
      policy.maxAttempts >= 12
        ? `attempt ${subFailoverSwitches}`
        : `attempt ${subFailoverSwitches}/${policy.maxAttempts}`
    emit({
      type: 'thinking',
      // Carry the SWITCHED-TO model so the card/console reflects the model now running, not the
      // original one (taskEmit prefers an event-supplied model over the task's initial identity).
      model: pick.model,
      summary: `Model failing — switching this sub-agent to ${pick.model} (standing in as ${role}) and retrying (${attemptLabel}).`,
    } as SubAgentEvent)
    return true
  }

  for (let step = 0; ; step += 1) {
    // Soft-deadline guard — stop before the orchestrator's recall times out so we
    // can post a real (partial) result with the true step count.
    if (Date.now() >= softDeadline) {
      deadlineHit = true
      emit({
        type: 'thinking',
        summary: `Approaching the time budget; wrapping up.`,
      })
      break
    }

    stepsUsed += 1

    // Per-call timeout = the smaller of the remaining budget and the per-call cap,
    // so a single slow model response can't consume the entire task window.
    const remainingMs = Math.max(2000, softDeadline - Date.now())
    const callTimeoutMs = Math.min(remainingMs, modelCallCap)

    if (signal?.aborted) break // user pressed Stop — end this sub-task promptly
    try {
      const response = await runWithTimeout(
        callAIWithMeta(messages, activeSettings, {
          ...(useNativeTools ? { tools: nativeTools } : {}),
          signal,
        }),
        callTimeoutMs,
        `Sub-agent model call timed out after ${callTimeoutMs}ms at step ${step + 1}`,
      )
      // The call succeeded → clear this model's failure state.
      recordModelSuccess(subModel.provider, subModel.model, subModel.keyId)

      const rawText = String(response?.text || '')
      totalTokens += Math.ceil(rawText.length / 4)

      const responseFingerprint = rawText.replace(/\s+/g, ' ').trim().slice(0, 1000)
      if (responseFingerprint && responseFingerprint === lastResponseFingerprint) {
        repeatedResponseCount += 1
      } else {
        lastResponseFingerprint = responseFingerprint
        repeatedResponseCount = 0
      }
      if (repeatedResponseCount >= 2) {
        repetitionHit = true
        emit({
          type: 'thinking',
          summary:
            'The local worker repeated the same response without progress, so it stopped and returned its current findings.',
        })
        break
      }

      // ── Native tool-calling branch — execute the model's native tool call and
      // feed the result back as a tool_result turn (persistent conversation).
      // Final results still arrive as JSON text (handled by the parse below).
      const nativeCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : []
      if (useNativeTools && nativeCalls.length > 0) {
        const tc = nativeCalls[0]
        const toolName = String(tc.name || '').trim()
        const toolArgs = tc.args && typeof tc.args === 'object' ? tc.args : {}
        const reasoning = String(response?.thinkingText || rawText || '').trim()
        if (reasoning)
          emit({
            type: 'thinking',
            summary: reasoning.slice(0, 2000),
            step: step + 1,
          })
        emit({
          type: 'tool_call',
          tool: toolName,
          argsPreview: trimOutput(toolArgs, 300),
          step: step + 1,
        })

        try {
          const toolStartedAt = Date.now()
          const toolResult = await runWithTimeout(
            executeSubAgentTool(toolName, toolArgs, stp, settings),
            15000,
            `Tool "${toolName}" timed out`,
          )
          toolsUsed.push(toolName)
          const resultPreview = trimOutput(toolResult)
          totalTokens += Math.ceil(resultPreview.length / 4)
          emit({
            type: 'tool_result',
            tool: toolName,
            status: 'ok',
            outputPreview: resultPreview.slice(0, 600),
            durationMs: Date.now() - toolStartedAt,
            step: step + 1,
          })
          messages.push({
            role: 'assistant',
            content: rawText,
            reasoning_content: String(response?.thinkingText || ''),
            toolCalls: [tc],
          })
          messages.push({
            role: 'tool',
            toolResults: [{ id: tc.id, name: toolName, content: resultPreview }],
          })
        } catch (toolError: unknown) {
          emit({
            type: 'tool_result',
            tool: toolName,
            status: 'error',
            outputPreview: errorMessage(toolError).slice(0, 600),
            step: step + 1,
          })
          messages.push({
            role: 'assistant',
            content: rawText,
            reasoning_content: String(response?.thinkingText || ''),
            toolCalls: [tc],
          })
          messages.push({
            role: 'tool',
            toolResults: [
              {
                id: tc.id,
                name: toolName,
                content: `ERROR: ${errorMessage(toolError)}`,
              },
            ],
          })
        }
        continue
      }

      const parsed = parseSubAgentModelJson(rawText)

      // Surface the model's reasoning (if it provided a thinking field).
      const thought = isRecord(parsed) && typeof parsed.thinking === 'string' ? parsed.thinking.trim() : ''
      if (thought)
        emit({
          type: 'thinking',
          summary: thought.slice(0, 2000),
          step: step + 1,
        })

      // If we got a tool call in the JSON, execute it
      if (isRecord(parsed) && typeof parsed.tool === 'string') {
        const toolName = String(parsed.tool).trim()
        const toolArgs = parsed.args && typeof parsed.args === 'object' ? parsed.args : {}
        emit({
          type: 'tool_call',
          tool: toolName,
          argsPreview: trimOutput(toolArgs, 300),
          step: step + 1,
        })

        try {
          const toolStartedAt = Date.now()
          const toolResult = await runWithTimeout(
            executeSubAgentTool(toolName, toolArgs, stp, settings),
            15000,
            `Tool "${toolName}" timed out`,
          )
          toolsUsed.push(toolName)
          const resultPreview = trimOutput(toolResult)
          totalTokens += Math.ceil(resultPreview.length / 4)
          emit({
            type: 'tool_result',
            tool: toolName,
            status: 'ok',
            outputPreview: resultPreview.slice(0, 600),
            durationMs: Date.now() - toolStartedAt,
            step: step + 1,
          })

          messages.push({ role: 'assistant', content: rawText })
          messages.push({
            role: 'user',
            content: `Tool result for ${toolName}:\n${resultPreview}\n\nContinue. Return final output JSON when complete.`,
          })
          continue
        } catch (toolError: unknown) {
          emit({
            type: 'tool_result',
            tool: toolName,
            status: 'error',
            outputPreview: errorMessage(toolError).slice(0, 600),
            step: step + 1,
          })
          messages.push({ role: 'assistant', content: rawText })
          messages.push({
            role: 'user',
            content: `Tool "${toolName}" failed: ${errorMessage(toolError)}. Try another approach or return the final output JSON.`,
          })
          continue
        }
      }

      // Non-tool JSON = final result
      if (parsed && typeof parsed === 'object' && !(isRecord(parsed) && parsed.tool)) {
        finalResult = parsed
        break
      }

      // If model returned prose, inject it and ask for JSON
      messages.push({ role: 'assistant', content: rawText })
      messages.push({
        role: 'user',
        content: `Return the final output JSON matching this schema: ${JSON.stringify(stp.output.schema)}`,
      })
    } catch (error: unknown) {
      // Provider rejected native tools for this model (common with OpenRouter
      // routes) → drop to the JSON-in-text protocol and retry instead of failing
      // the whole task. The loop already parses `{tool, args}` JSON from text.
      if (useNativeTools && isToolSupportError(error)) {
        useNativeTools = false
        emit({
          type: 'thinking',
          summary: 'Provider does not support native tools for this model; retrying without them.',
        })
        continue
      }
      emit({
        type: 'notice',
        level: 'error',
        summary: errorMessage(error, 'unknown').slice(0, 200),
      })
      // Sub-agent model fallback (§F3): switch to a healthy model and retry instead of failing the
      // whole task. Honors the off / limited-N / exhaust policy.
      if (await trySubAgentFailover(error)) {
        // The switched-in model must not inherit the failed model's spent time budget — give it a
        // fresh working window (bounded by the task's hard timeout) so it actually gets to run.
        // Without this, a one-shot task dies the moment its first model fails over.
        softDeadline = Math.min(
          startedAt + taskTimeoutMs,
          Date.now() + Math.max(8000, Math.round(taskTimeoutMs * SUB_AGENT_DEADLINE_RATIO)),
        )
        continue
      }
      loopError = error
      break
    }
  }

  const durationMs = Date.now() - startedAt

  if (loopError && !finalResult) {
    emit({
      type: 'notice',
      level: 'error',
      summary: `Task failed: ${errorMessage(loopError)}`,
    })
    return {
      taskId: stp.taskId,
      agentId: stp.toAgent,
      status: TASK_STATUS.FAILED,
      result: null,
      toolsUsed,
      stepsUsed,
      tokensUsed: totalTokens,
      satisfactionHint: `Failed: ${errorMessage(loopError)}`,
      durationMs,
      completedAt: Date.now(),
    }
  }

  if (!finalResult) {
    const hint = deadlineHit
      ? `Hit the task time budget after ${stepsUsed} reasoning turn(s) before producing the output schema.`
      : repetitionHit
        ? 'The local worker stopped after repeating the same response without making progress.'
        : 'The local worker stopped before producing the requested output schema.'
    emit({ type: 'thinking', summary: hint })
    return {
      taskId: stp.taskId,
      agentId: stp.toAgent,
      status: deadlineHit ? TASK_STATUS.TIMEOUT : TASK_STATUS.PARTIAL,
      result: null,
      toolsUsed,
      stepsUsed,
      stepBudget: stp.budget.maxSteps,
      tokensUsed: totalTokens,
      satisfactionHint: hint,
      durationMs,
      completedAt: Date.now(),
    }
  }

  const validation = validateSTPResult(finalResult, stp.output.schema)
  const status = validation.valid ? TASK_STATUS.DONE : TASK_STATUS.PARTIAL
  const satisfactionHint = validation.valid
    ? `Completed — ${toolsUsed.length} tool${toolsUsed.length === 1 ? '' : 's'} used.`
    : `Partial — missing output fields: ${validation.missing.join(', ')}`
  emit({ type: 'thinking', summary: satisfactionHint })

  return {
    taskId: stp.taskId,
    agentId: stp.toAgent,
    status,
    result: finalResult,
    toolsUsed,
    stepsUsed,
    stepBudget: stp.budget.maxSteps,
    tokensUsed: totalTokens,
    satisfactionHint,
    durationMs,
    completedAt: Date.now(),
  }
}

// ── Sub-agent loop ─────────────────────────────────────────────────────────────

/**
 * Start the continuous polling loop for a sub-agent.
 * Picks up tasks from its queue, executes them, posts results.
 * Returns a stop() function to halt the loop.
 *
 * @param {string} agentId
 * @param {object} settings  - AI settings for this agent
 * @returns {{ stop: () => void }}
 */
export function startSubAgentLoop(agentId: string, settings: SubAgentSettings): SubAgentLoopHandle {
  ensureAgentEntry(agentId)
  let running = true

  // Runs the sub-agent worker loop until shutdown, claiming tasks and publishing bounded results.
  const loop = async (): Promise<void> => {
    while (running) {
      const entry = agentRegistry.get(agentId)

      if (entry?.health?.suspended) {
        await waitMs(5000)
        continue
      }

      const queue = taskQueue.get(agentId) || []
      const nextTask = queue.shift()

      if (!nextTask) {
        setAgentStatus(agentId, AGENT_STATUS.IDLE)
        await waitMs(SUB_AGENT_POLL_INTERVAL_MS)
        continue
      }

      setAgentStatus(agentId, AGENT_STATUS.WORKING, nextTask.taskId)

      // Per-task emitter — tags every event with the role + task so the chat
      // session can render this sub-agent's thinking inline, clearly labelled.
      const memberTags = deriveModelTags(
        String(nextTask.agentIdentity?.provider || ''),
        String(nextTask.agentIdentity?.model || ''),
      )
      const taskEmit: SubAgentEventEmitter = (event) =>
        emitSubAgentEvent({
          ...event,
          // agentId is the MEMBER id (executor#2, …) the loop runs as; surface its model + tags too
          // so the timeline renders a per-MODEL card, not just a role lane. Prefer a model the event
          // itself carries (a failover switch supplies the new model) over the task's initial one.
          agentId,
          model: String((event as { model?: unknown }).model || nextTask.agentIdentity?.model || ''),
          agentTags: memberTags,
          role: String(nextTask.agentIdentity?.role || nextTask.toAgent || agentId),
          taskId: nextTask.taskId,
        })

      try {
        const result = await runWithTimeout(
          executeSTP(nextTask, settings, taskEmit),
          nextTask.budget.timeoutMs + 5000, // small grace window
          `Task ${nextTask.taskId} timed out`,
        )

        // Persist the full result as an encrypted SQLite record. The compatibility
        // outputPath field now carries an opaque output id, never a filesystem path.
        const full = typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result ?? '', null, 2)
        if (full && full.length > 0) {
          result.outputPath = await subagentWriteOutput(nextTask.taskId, full)
          result.outputChars = full.length
        }

        settleTask(nextTask.taskId, result)

        if (result.status === TASK_STATUS.DONE) {
          recordAgentSuccess(agentId)
        } else {
          recordAgentFailure(agentId)
        }
      } catch (error: unknown) {
        const detail = errorMessage(error, 'unknown')
        const timedOut = /timed out/i.test(detail)
        const failureResult: SubAgentTaskResult = {
          taskId: nextTask.taskId,
          agentId,
          status: timedOut ? TASK_STATUS.TIMEOUT : TASK_STATUS.FAILED,
          result: null,
          toolsUsed: [],
          stepsUsed: 0,
          tokensUsed: 0,
          satisfactionHint: `Loop error: ${detail}`,
          durationMs: nextTask.budget.timeoutMs,
          completedAt: Date.now(),
        }

        settleTask(nextTask.taskId, failureResult)
        recordAgentFailure(agentId)
      }

      setAgentStatus(agentId, AGENT_STATUS.IDLE)
    }
  }

  loop().catch(() => {
    setAgentStatus(agentId, AGENT_STATUS.IDLE)
  })

  return {
    // Stops stop and releases retained resources.
    stop() {
      running = false
    },
  }
}

/**
 * Broadcast a context update to all queued tasks.
 * Used when user intent changes mid-run.
 *
 * @param {string} message
 * @param {object} [contextUpdate]
 */
export function broadcastToAgents(message: unknown, contextUpdate: Record<string, unknown> = {}): void {
  applyBroadcastToQueuedTasks(taskQueue, message, contextUpdate)
}

export { TASK_STATUS, AGENT_STATUS }
