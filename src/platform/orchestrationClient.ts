/**
 * Orchestration Client
 *
 * Frontend-side client for the multi-agent bus.
 * Wraps subAgentRuntime's in-process queue with the interface expected by
 * agentRuntime's new agent.delegate / agent.recall / agent.status / agent.roster tools.
 *
 * Task orchestration is in-process; bridge-backed handoff uses the Electron-owned local server,
 * no added latency beyond the sub-agent AI calls themselves.
 *
 * Role-based: any provider can be orchestrator / executor / scout.
 * Guards check for 'orchestrator' role, not for 'claude' provider.
 */

import { buildSTP, summariseSTP } from '@/platform/stpBuilder'
import { buildSkillProfile } from '@/platform/skillProfiles'
import {
  applyAgentIdentityToSettings,
  normalizeAgentRole,
  resolveAgentRoleSettings,
  resolveCurrentAgentRole,
} from '@/platform/agent/agentIdentity'
import type { AgentRoleId } from '@/platform/agent/agentIdentity'
import { buildAgentRoster, type RosterMember } from '@/platform/agent/modelTags'
import { recordModelFailure, isModelHealthy } from '@/platform/agent/modelHealth'
import { getKey } from '@/platform/keyStore'
import { subscribeSettingsChanged } from '@/platform/settingsStorage'
import type {
  BroadcastArgs,
  DelegateArgs,
  DelegateResult,
  DelegateTarget,
  DelegationEvaluation,
  OrchestrationModeResult,
  RecallArgs,
  RecallResult,
  StatusArgs,
  SubAgentLoopHandle,
  SubAgentRosterEntry,
  SubAgentSettings,
  SubAgentTaskResult,
  VerifyArgs,
  VerifyResult,
} from '@/platform/agent/subAgentTypes'
import {
  postTask,
  waitForTask,
  waitForAllTasks,
  pollTaskResult,
  getTaskStatus,
  getAgentRoster,
  isAgentAvailable,
  broadcastToAgents,
  startSubAgentLoop,
  resolveAgentId,
  subscribeSubAgentEvents,
  TASK_STATUS,
} from '@/platform/subAgentRuntime'

// ── Constants ─────────────────────────────────────────────────────────────────

// Default per-task budget when the orchestrator doesn't specify one. Raised from
// 45s: that left a ~38s soft deadline, too short for real model calls (one slow
// reasoning call would exhaust it), so delegated tasks were timing out once the
// connection fix let them actually run. The orchestrator can still override via
// args.timeoutMs (clamped 5s–300s in handleAgentDelegate).
const DEFAULT_DELEGATE_TIMEOUT_MS = 130000
const DELEGATE_AVAILABILITY_WAIT_MS = 10000
const DELEGATE_AVAILABILITY_POLL_MS = 500
const MAX_PARALLEL_DELEGATIONS = 16
const MAX_ACTIVE_SUB_AGENT_LOOPS = 8

interface DelegationTaskLike {
  output?: { schema?: Record<string, unknown> }
  budget?: { maxSteps?: unknown }
}

interface DelegationResultLike {
  status?: string
  result?: unknown
  stepsUsed?: unknown
  stepBudget?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// ── Delegate helpers ──────────────────────────────────────────────────────────

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait up to maxWaitMs for an agent to become idle before posting.
 * Falls back to posting anyway (task queues, agent picks it up when free).
 *
 * @param {string} agentId
 * @param {number} maxWaitMs
 * @returns {Promise<boolean>} true if agent became available, false if waited out
 */
async function awaitAgentAvailable(agentId: string, maxWaitMs = DELEGATE_AVAILABILITY_WAIT_MS): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    if (isAgentAvailable(agentId)) return true
    await waitMs(DELEGATE_AVAILABILITY_POLL_MS)
  }

  return false // Post anyway — agent will pick it up when ready
}

// ── Satisfaction evaluation ───────────────────────────────────────────────────

/**
 * Evaluates whether a delegation result is satisfactory.
 * Claude uses this to decide whether to accept, retry, or take over.
 *
 * @param {object} task     - The original STP object
 * @param {object} result   - The task result from the bus
 * @returns {{ satisfied: boolean, reason: string, warning?: string }}
 */
export function evaluateDelegationResult(
  task: DelegationTaskLike,
  result: DelegationResultLike | null | undefined,
): DelegationEvaluation {
  if (!result) {
    return { satisfied: false, reason: 'no_result' }
  }

  if (result.status === TASK_STATUS.FAILED) {
    return { satisfied: false, reason: 'agent_failed' }
  }

  if (result.status === TASK_STATUS.TIMEOUT) {
    return { satisfied: false, reason: 'timeout' }
  }

  if (task?.output?.schema && Object.keys(task.output.schema).length > 0) {
    const schema = task.output.schema
    const res = result.result

    if (!isRecord(res)) {
      return { satisfied: false, reason: 'schema_mismatch' }
    }

    const missing = Object.keys(schema).filter((k) => !(k in res))
    if (missing.length > 0) {
      return { satisfied: false, reason: `missing_fields: ${missing.join(', ')}` }
    }
  }

  if (!result.result || (typeof result.result === 'object' && Object.keys(result.result).length === 0)) {
    return { satisfied: false, reason: 'empty_result' }
  }

  return { satisfied: true, reason: 'ok' }
}

export function resolveDelegateTarget(toAgent: unknown, settings: SubAgentSettings): DelegateTarget {
  const role = normalizeAgentRole(toAgent)
  const resolved = resolveAgentRoleSettings(role, settings)

  return {
    agentId: role,
    role,
    provider: resolved.identity.provider,
    model: resolved.identity.model,
    identity: resolved.identity,
    subSettings: resolved.settings,
  }
}

export async function handleAgentDelegate(args: DelegateArgs, settings: SubAgentSettings): Promise<DelegateResult> {
  const { agentId: toAgent, identity, subSettings } = pickDelegateMember(String(args?.toAgent || 'executor'), settings)
  const type = String(args?.type || 'execute')
  const instructions = String(args?.instructions || args?.goal || '').trim()
  const timeoutMs = Number.isFinite(Number(args?.timeoutMs))
    ? Math.max(5000, Math.min(300000, Number(args.timeoutMs)))
    : DEFAULT_DELEGATE_TIMEOUT_MS

  const subProfile = buildSkillProfile(subSettings?.ai_provider, subSettings?.ai_model)
  const subModel = String(subSettings?.ai_model || '').toLowerCase()
  const weakFamilies = ['gemma', 'phi', 'llama', 'mistral', 'mixtral', 'qwen']
  const skillVariant = toAgent === 'scout' || weakFamilies.some((f) => subModel.includes(f)) ? 'simple' : 'default'
  const skills =
    args?.skills && typeof args.skills === 'object'
      ? (args.skills as { load?: unknown; variant?: unknown })
      : { load: [subProfile], variant: skillVariant }

  const delegatedTools = {
    ...(Array.isArray(args?.tools) ? { available: args.tools } : {}),
    preferred: Array.isArray(args?.preferredTools) ? args.preferredTools : [],
    forbidden: Array.isArray(args?.forbiddenTools) ? args.forbiddenTools : [],
  }

  const stp = buildSTP({
    type,
    goal: instructions,
    scope: String(args?.scope || '').trim(),
    constraints: Array.isArray(args?.constraints) ? args.constraints : [],
    tools: delegatedTools,
    outputSchema: args?.outputSchema && typeof args.outputSchema === 'object' ? args.outputSchema : {},
    context: args?.context && typeof args.context === 'object' ? args.context : {},
    skills,
    budget: {
      maxSteps: Number.isFinite(Number(args?.maxSteps)) ? Number(args.maxSteps) : 12,
      timeoutMs,
      maxOutputChars: Number.isFinite(Number(args?.maxOutputChars)) ? Number(args.maxOutputChars) : 6000,
    },
    priority: String(args?.priority || 'normal'),
    toAgent,
    agentIdentity: identity,
  })

  ensureSubAgentLoop(toAgent, subSettings)
  if (args?.waitForIdle !== false) await awaitAgentAvailable(toAgent, 3000)
  const taskId = postTask(stp)

  return {
    taskId,
    toAgent,
    model: String(identity?.model || subSettings?.ai_model || ''),
    summary: summariseSTP(stp),
    status: 'posted',
    postedAt: Date.now(),
  }
}

export async function handleAgentRecall(args: RecallArgs): Promise<RecallResult> {
  const taskId = String(args?.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required for agent.recall')
  const waitMsParam = Number.isFinite(Number(args?.waitMs)) ? Number(args.waitMs) : 0
  if (waitMsParam > 0) {
    try {
      const result = await waitForTask(taskId, waitMsParam)
      return {
        taskId,
        status: result.status,
        result: result.result || null,
        toolsUsed: result.toolsUsed || [],
        stepsUsed: result.stepsUsed || 0,
        tokensUsed: result.tokensUsed || 0,
        satisfactionHint: result.satisfactionHint || '',
        durationMs: result.durationMs || 0,
      }
    } catch (error: unknown) {
      return {
        taskId,
        status: TASK_STATUS.TIMEOUT,
        result: null,
        toolsUsed: [],
        stepsUsed: 0,
        tokensUsed: 0,
        satisfactionHint: errorMessage(error, 'Timed out waiting for result.'),
        durationMs: waitMsParam,
      }
    }
  }
  const result = pollTaskResult(taskId)
  return {
    taskId,
    status: result ? result.status : getTaskStatus(taskId),
    result: result?.result || null,
    toolsUsed: result?.toolsUsed || [],
    stepsUsed: result?.stepsUsed || 0,
    tokensUsed: result?.tokensUsed || 0,
    satisfactionHint: result?.satisfactionHint || '',
    durationMs: result?.durationMs || 0,
    ready: Boolean(result),
  }
}

export function handleAgentStatus(args: StatusArgs): {
  taskId: string
  status: SubAgentTaskResult['status'] | 'unknown'
} {
  const taskId = String(args?.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required for agent.status')
  return { taskId, status: getTaskStatus(taskId) }
}

export function handleAgentRoster(): { agents: SubAgentRosterEntry[] } {
  return { agents: getAgentRoster() }
}

export function handleAgentBroadcast(args: BroadcastArgs): { broadcasted: true; message: string } {
  const message = String(args?.message || '').trim()
  const contextUpdate =
    args?.contextUpdate && typeof args.contextUpdate === 'object' ? (args.contextUpdate as Record<string, unknown>) : {}
  broadcastToAgents(message, contextUpdate)
  return { broadcasted: true, message }
}

export async function handleAgentVerify(args: VerifyArgs): Promise<VerifyResult> {
  const taskId = String(args?.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required for agent.verify')
  const result = pollTaskResult(taskId)
  if (!result) return { taskId, verdict: 'not_ready', message: 'Task result not yet available.' }
  const criteria = String(args?.criteria || '').trim()
  const { satisfied, reason, warning } = evaluateDelegationResult(
    { output: { schema: {} }, budget: { maxSteps: 8 } },
    result,
  )
  return {
    taskId,
    verdict: satisfied ? 'pass' : 'fail',
    reason,
    warning: warning || null,
    criteria,
    result: result.result || null,
    satisfactionHint: result.satisfactionHint || '',
  }
}

export async function delegateParallel(
  taskArgsList: DelegateArgs[],
  settings: SubAgentSettings,
  timeoutMs = 60000,
): Promise<SubAgentTaskResult[]> {
  if (!Array.isArray(taskArgsList)) throw new Error('Parallel tasks must be an array')
  if (taskArgsList.length > MAX_PARALLEL_DELEGATIONS) {
    throw new Error(`Parallel delegation exceeds the ${MAX_PARALLEL_DELEGATIONS}-task limit`)
  }
  const taskIds = await Promise.all(
    taskArgsList.map((args) => handleAgentDelegate(args, settings).then((r) => r.taskId)),
  )
  return waitForAllTasks(taskIds, timeoutMs)
}

const activeLoops = new Map<string, { handle: SubAgentLoopHandle; hash: string }>()

function memberHash(member: { provider: string; model: string; keyId: string; tier: number }): string {
  return `${member.provider}|${member.model}|${member.keyId}|${member.tier}`
}

export function ensureSubAgentLoop(agentId: string, settings: SubAgentSettings, hash = ''): void {
  const existing = activeLoops.get(agentId)
  if (existing) {
    if (!hash || existing.hash === hash) return
    existing.handle.stop()
    activeLoops.delete(agentId)
  }
  if (activeLoops.size >= MAX_ACTIVE_SUB_AGENT_LOOPS) throw new Error('Active sub-agent loop limit reached')
  const handle = startSubAgentLoop(agentId, settings)
  activeLoops.set(agentId, { handle, hash })
}

export function stopSubAgentLoop(agentId: string): void {
  const entry = activeLoops.get(agentId)
  if (entry) {
    entry.handle.stop()
    activeLoops.delete(agentId)
  }
}

export function stopAllSubAgentLoops(): void {
  for (const [agentId, entry] of activeLoops) {
    entry.handle.stop()
    activeLoops.delete(agentId)
  }
  standbyMembers.clear()
}

const standbyMembers = new Map<string, { member: RosterMember; settings: SubAgentSettings; hash: string }>()
const roleRoundRobin = new Map<string, number>()
let standbySubscribed = false

function resolveMemberSettings(member: RosterMember, settings: SubAgentSettings): SubAgentSettings {
  return applyAgentIdentityToSettings(settings as never, {
    role: member.role,
    provider: member.provider,
    model: member.model,
    keyId: member.keyId || '1',
    explicitlyAssigned: true,
  }) as SubAgentSettings
}

function isMemberConnectable(member: RosterMember): boolean {
  if (!member.provider || !member.model) return false
  return member.provider === 'local' || Boolean(getKey(member.provider, member.keyId || '1'))
}

export interface DroppedMember {
  member: RosterMember
  reason: string
}

function standbyRoster(settings: SubAgentSettings): { connected: RosterMember[]; dropped: DroppedMember[] } {
  const rawAllow = (settings as Record<string, unknown> | null)?.agent_team_roles
  const allowList = Array.isArray(rawAllow) && rawAllow.length ? new Set(rawAllow.map((r) => String(r))) : null
  const delegatable = buildAgentRoster(settings as never).filter(
    (member) =>
      member.role !== 'overwatcher' &&
      !(member.role === 'orchestrator' && member.primary) &&
      (!allowList || allowList.has(member.role)),
  )
  const connected: RosterMember[] = []
  const dropped: DroppedMember[] = []
  for (const member of delegatable) {
    if (!member.provider || !member.model) {
      dropped.push({ member, reason: 'no provider/model set' })
    } else if (isMemberConnectable(member)) {
      connected.push(member)
    } else {
      dropped.push({
        member,
        reason:
          member.provider === 'local'
            ? 'local server has no key/endpoint resolved'
            : `no API key saved for ${member.provider} Key ${member.keyId || '1'}`,
      })
    }
  }
  return { connected: connected.slice(0, MAX_ACTIVE_SUB_AGENT_LOOPS), dropped }
}

export interface StandbyPoolState {
  members: string[]
  roles: string[]
  connected: RosterMember[]
  dropped: DroppedMember[]
}

export function syncStandbyPool(settings: SubAgentSettings): StandbyPoolState {
  if (!standbySubscribed) {
    standbySubscribed = true
    subscribeSettingsChanged((next) => {
      try {
        syncStandbyPool(next as SubAgentSettings)
      } catch {
        /* non-fatal */
      }
    })
  }
  if (settings?.agent_multi_enabled !== true) {
    stopAllSubAgentLoops()
    return { members: [], roles: [], connected: [], dropped: [] }
  }
  const eager = String(settings?.agent_standby_mode || 'eager').toLowerCase() !== 'lazy'
  const roster = standbyRoster(settings)
  const desired = roster.connected
  const desiredIds = new Set(desired.map((m) => m.id))
  for (const id of [...standbyMembers.keys()]) if (!desiredIds.has(id)) standbyMembers.delete(id)
  for (const id of [...activeLoops.keys()]) if (!desiredIds.has(id)) stopSubAgentLoop(id)
  for (const member of desired) {
    const subSettings = resolveMemberSettings(member, settings)
    const hash = memberHash(member)
    standbyMembers.set(member.id, { member, settings: subSettings, hash })
    const running = activeLoops.get(member.id)
    if (eager || (running && running.hash !== hash)) {
      try {
        ensureSubAgentLoop(member.id, subSettings, hash)
      } catch {
        /* loop cap reached */
      }
    }
  }
  return {
    members: desired.map((m) => m.id),
    roles: Array.from(new Set(desired.map((m) => m.role))),
    connected: desired,
    dropped: roster.dropped,
  }
}

export function inspectStandbyRoster(settings: SubAgentSettings): {
  connected: RosterMember[]
  dropped: DroppedMember[]
} {
  if (settings?.agent_multi_enabled !== true) return { connected: [], dropped: [] }
  return standbyRoster(settings)
}

export function pickDelegateMember(
  target: string,
  settings: SubAgentSettings,
): {
  agentId: string
  identity: { role: AgentRoleId; provider: string; model: string }
  subSettings: SubAgentSettings
} {
  const raw = String(target || '').trim()
  const localOnly = settings?.agent_local_only_enforced === true
  if (raw.includes('#')) {
    const exact = standbyMembers.get(raw)
    if (exact && (!localOnly || exact.member.provider === 'local')) {
      try {
        ensureSubAgentLoop(exact.member.id, exact.settings, exact.hash)
      } catch {
        /* non-fatal */
      }
      return {
        agentId: exact.member.id,
        identity: { role: exact.member.role, provider: exact.member.provider, model: exact.member.model },
        subSettings: exact.settings,
      }
    }
  }
  const role = normalizeAgentRole(raw)
  const candidates = [...standbyMembers.values()].filter(
    (m) => m.member.role === role && (!localOnly || m.member.provider === 'local'),
  )
  if (!candidates.length) {
    const resolved = resolveAgentRoleSettings(role, settings)
    return { agentId: role, identity: resolved.identity, subSettings: resolved.settings }
  }
  const idle = candidates.filter((c) => isAgentAvailable(c.member.id))
  const pool = idle.length ? idle : candidates
  const index = (roleRoundRobin.get(role) ?? 0) % pool.length
  roleRoundRobin.set(role, index + 1)
  const chosen = pool[index]
  try {
    ensureSubAgentLoop(chosen.member.id, chosen.settings, chosen.hash)
  } catch {
    /* non-fatal */
  }
  return {
    agentId: chosen.member.id,
    identity: { role, provider: chosen.member.provider, model: chosen.member.model },
    subSettings: chosen.settings,
  }
}

export function reassignFailedPart(
  failedMemberId: string,
  settings: SubAgentSettings,
): { memberId: string; model: string; role: AgentRoleId } | null {
  const localOnly = settings?.agent_local_only_enforced === true
  const failed = standbyMembers.get(String(failedMemberId || ''))
  if (failed) {
    recordModelFailure(failed.member.provider, failed.member.model, failed.member.keyId, {
      error: 'delegated teamwork part failed',
    })
  }
  const failedRole = failed?.member.role || normalizeAgentRole(failedMemberId)
  const healthy = [...standbyMembers.values()].filter(
    (m) =>
      m.member.id !== failedMemberId &&
      (!localOnly || m.member.provider === 'local') &&
      isModelHealthy(m.member.provider, m.member.model, m.member.keyId),
  )
  if (!healthy.length) return null
  const pick = healthy.find((m) => m.member.role === failedRole) || healthy[0]
  try {
    ensureSubAgentLoop(pick.member.id, pick.settings, pick.hash)
  } catch {
    /* non-fatal */
  }
  return { memberId: pick.member.id, model: pick.member.model, role: pick.member.role }
}

export { resolveAgentId, subscribeSubAgentEvents, TASK_STATUS }

export async function detectOrchestrationMode(): Promise<OrchestrationModeResult> {
  try {
    const result = handleAgentRoster()
    const roster = Array.isArray(result?.agents) ? result.agents : []
    const onlineRoles = roster
      .filter((a) => a.status !== 'offline' && Date.now() - (a.lastSeen || 0) < 30000)
      .map((a) => String(normalizeAgentRole(String(a.role || a.id).split('#')[0])))
    if (!onlineRoles.includes('orchestrator')) onlineRoles.push('orchestrator')
    const allRoles = ['orchestrator', 'executor', 'scout']
    const offline = allRoles.filter((r) => !onlineRoles.includes(r))
    let mode: OrchestrationModeResult['mode'] = 'solo'
    if (onlineRoles.includes('executor') && onlineRoles.includes('scout')) mode = 'full'
    else if (onlineRoles.includes('executor') || onlineRoles.includes('scout')) mode = 'dual'
    return { mode, available: onlineRoles, offline }
  } catch {
    return { mode: 'solo', available: ['orchestrator'], offline: ['executor', 'scout'] }
  }
}

export function resolveCurrentRole(settings: SubAgentSettings): AgentRoleId {
  return resolveCurrentAgentRole(settings)
}
