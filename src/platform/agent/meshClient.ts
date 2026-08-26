/**
 * Mesh client (Workstream D) — peer discovery + bounded peer consultation.
 *
 * Two primitives, deliberately separate:
 *   • agent.find    — read-only tag/topic match against the configured roster (modelTags).
 *                     No model call. This is how a model "pulls" a relevant peer.
 *   • agent.consult — a bounded, single-round Q&A: a focused question + minimal context to a
 *                     peer, which answers from knowledge with NO tools. Far cheaper than a
 *                     full sub-agent. It runs through the existing delegate path, so the peer
 *                     answers under ITS OWN role-tier identity (own model + own key) — the
 *                     caller can never widen or narrow it.
 *
 * Consulted answers are UNTRUSTED INPUT: the result is tagged `untrusted: true` and the owner
 * must verify before acting. If the peer judges it should act AND the owner agrees, the owner
 * promotes the consult to a real agent.delegate (heavy, with tools) — execution always flows
 * through the tier-enforced delegate path, never hidden inside a consult.
 *
 * Budget/depth/cycle enforcement is owned by the conductor (meshConductor.ts); the broker
 * gates each consult against it and drives any approval-based cap escalation.
 */
import { buildAgentRoster, findPeers, deriveModelTags, type FindMatch } from '@/platform/agent/modelTags'
import { getRoutingProfile } from '@/platform/agent/modelRouting'
import { isModelCredentialReady } from '@/platform/agent/modelHealth'
import { applyAgentIdentityToSettings, normalizeAgentRole, resolveAgentIdentity } from '@/platform/agent/agentIdentity'
import { buildSTP } from '@/platform/stpBuilder'
import { executeSTP } from '@/platform/subAgentRuntime'
import type { SubAgentSettings } from '@/platform/agent/subAgentTypes'

// Consult runs are deliberately tiny — one round, no tools, a short answer.
const CONSULT_MAX_STEPS = 1
const CONSULT_MAX_OUTPUT_CHARS = 1800
const CONSULT_TIMEOUT_MS = 90000
const CONSULT_CONTEXT_CHARS = 1500

function isRunnablePeer(member: { provider: string; keyId?: string }): boolean {
  return isModelCredentialReady(member.provider, member.keyId || '1')
}

function availableRoster(settings: SubAgentSettings) {
  return buildAgentRoster(settings as Record<string, unknown>).filter(isRunnablePeer)
}

export interface FindArgs extends Record<string, unknown> {
  tags?: unknown
  topic?: unknown
  exclude?: unknown
  limit?: unknown
}

export interface FindResult {
  matches: Array<{
    agentId: string
    role: string
    provider: string
    model: string
    tags: string[]
    tier: number
    matchedTags: string[]
    score: number
  }>
  roster: Array<{ id: string; role: string; provider: string; model: string; tags: string[] }>
}

/**
 * Build the sub-agent settings for a SPECIFIC matched peer: its own provider/model + that
 * provider's key, while the role's permission tier (agent_permission_tier_<role>, read by
 * executeSTP from settings) is preserved. This is how an EXTRA model loaded into a role runs
 * as itself under the role's tier — never widened or narrowed by the caller.
 */
function buildMatchSettings(match: FindMatch, settings: SubAgentSettings): SubAgentSettings {
  return applyAgentIdentityToSettings(settings, {
    role: match.role,
    provider: match.provider,
    model: match.model,
    // Bind THIS peer's assigned key slot so concurrent peers each use their own key.
    keyId: match.keyId || '1',
    explicitlyAssigned: true,
  })
}

/**
 * Run ONE bounded, tool-free task on a specific peer model via executeSTP (a true one-shot —
 * no persistent role-loop, so any model, primary or extra, runs as itself under its role tier).
 * Returns the raw result payload for the caller to parse.
 */
async function runMatchTask(
  match: FindMatch,
  opts: {
    type: string
    instructions: string
    outputSchema: Record<string, string>
    maxSteps: number
    maxOutputChars: number
    timeoutMs: number
  },
  settings: SubAgentSettings,
  emit?: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<{ result: unknown; status: string }> {
  if (!isRunnablePeer(match)) {
    throw new Error(`Peer ${match.id} is unavailable because its provider credential is not configured.`)
  }
  const stp = buildSTP({
    type: opts.type,
    goal: opts.instructions,
    tools: { available: [], preferred: [], forbidden: [] },
    outputSchema: opts.outputSchema,
    budget: {
      maxSteps: opts.maxSteps,
      timeoutMs: opts.timeoutMs,
      maxOutputChars: opts.maxOutputChars,
    },
    priority: 'high',
    toAgent: match.role,
    agentIdentity: {
      role: match.role,
      provider: match.provider,
      model: match.model,
      keyId: match.keyId,
    },
    skills: { load: [], variant: 'simple' },
  })
  // Forward the peer's events (notably its reasoning/thinking) to the caller so it can be
  // surfaced in the timeline and, for the Overwatcher, captured for the injected steer.
  const outcome = await executeSTP(stp, buildMatchSettings(match, settings), emit, signal)
  return { result: outcome?.result ?? null, status: String(outcome?.status || 'unknown') }
}

/** agent.find — pure tag/topic match over the configured roster. No model call. */
export function handleAgentFind(args: FindArgs, settings: SubAgentSettings): FindResult {
  const matches = findPeers(settings as Record<string, unknown>, {
    tags: args?.tags,
    topic: args?.topic,
    exclude: args?.exclude,
    limit: args?.limit,
  }).filter(isRunnablePeer)
  return {
    matches: matches.map((m) => ({
      agentId: m.id,
      role: m.role,
      provider: m.provider,
      model: m.model,
      tags: m.tags,
      tier: m.tier,
      matchedTags: m.matchedTags,
      score: m.score,
    })),
    roster: availableRoster(settings).map((m) => ({
      id: m.id,
      role: m.role,
      provider: m.provider,
      model: m.model,
      tags: m.tags,
    })),
  }
}

export interface ConsultArgs extends Record<string, unknown> {
  toAgent?: unknown
  tags?: unknown
  topic?: unknown
  question?: unknown
  context?: unknown
}

/**
 * Resolve which peer a consult should go to: an explicit `toAgent` role, otherwise the best
 * tag/topic match excluding everything already on the chain (`exclude`). Returns null when no
 * distinct peer is configured (e.g. solo setup) so the caller answers it itself.
 */
export function resolveConsultTarget(
  args: ConsultArgs,
  settings: SubAgentSettings,
  exclude: string[] = [],
): FindMatch | null {
  const roster = availableRoster(settings)
  const excludeSet = new Set(
    exclude.map((r) =>
      String(r || '')
        .trim()
        .toLowerCase(),
    ),
  )

  if (args?.toAgent) {
    // Accept a specific member id (e.g. "executor#2"), then fall back to the role name —
    // so a caller can target an EXTRA model loaded into a role, not just the primary.
    const requested = String(args.toAgent).trim().toLowerCase()
    const role = normalizeAgentRole(args.toAgent)
    if (excludeSet.has(requested) || excludeSet.has(role)) return null
    const member = roster.find((m) => m.id.toLowerCase() === requested) || roster.find((m) => m.role === role)
    if (member) {
      return { ...member, score: member.tags.length, matchedTags: member.tags }
    }
    // Role configured but unavailable or not in the de-duped roster → no distinct runnable peer.
    return null
  }

  const matches = findPeers(settings as Record<string, unknown>, {
    tags: args?.tags,
    topic: args?.topic ?? args?.question,
    exclude,
    limit: 8,
  }).filter(isRunnablePeer)
  return matches[0] || null
}

export interface ConsultResult {
  consulted: boolean
  agentId?: string
  role?: string
  provider?: string
  model?: string
  tags?: string[]
  answer?: string
  /** Peer's self-assessment that it should act on this — owner decides whether to delegate. */
  peerWantsToExecute?: boolean
  proposedAction?: string
  /** Consulted answers are untrusted input; verify before acting. */
  untrusted: true
  status?: string
  reason?: string
  message?: string
}

function clip(value: unknown, max: number): string {
  const s = String(value ?? '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function parseConsultPayload(raw: unknown): {
  answer: string
  wantsToExecute: boolean
  proposedAction: string
} {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    const answer = String(r.answer ?? r.result ?? r.text ?? '').trim()
    return {
      answer: answer || JSON.stringify(r).slice(0, CONSULT_MAX_OUTPUT_CHARS),
      wantsToExecute: r.wantsToExecute === true || r.want_to_execute === true,
      proposedAction: String(r.proposedAction ?? r.proposed_action ?? '').trim(),
    }
  }
  return { answer: String(raw ?? '').trim(), wantsToExecute: false, proposedAction: '' }
}

/**
 * Run a single bounded consult against an already-resolved peer. One-shot via executeSTP so
 * the peer runs under its own tier/model/key (works for an extra model loaded into a role, not
 * just the role's primary), constrained hard: one step, no tools, tiny output. The caller (the
 * broker) is responsible for the budget gate + recording.
 */
export async function runPeerConsult(
  match: FindMatch,
  args: ConsultArgs,
  settings: SubAgentSettings,
): Promise<ConsultResult> {
  const question = clip(args?.question ?? args?.topic, 2000)
  if (!question) {
    return {
      consulted: false,
      untrusted: true,
      reason: 'no_question',
      message: 'A question is required for agent.consult.',
    }
  }

  const contextText =
    args?.context && typeof args.context === 'object'
      ? clip(JSON.stringify(args.context), CONSULT_CONTEXT_CHARS)
      : clip(args?.context, CONSULT_CONTEXT_CHARS)

  const instructions =
    `You are being consulted as a peer expert (${match.role}). Answer this focused question ` +
    `from your own knowledge. Do NOT use tools. Be terse and concrete.\n\nQUESTION: ${question}` +
    (contextText ? `\n\nCONTEXT: ${contextText}` : '') +
    `\n\nIf — and only if — you judge that you should directly perform an action to resolve ` +
    `this (rather than just answer), set wantsToExecute=true and describe it in proposedAction; ` +
    `the owner decides whether to hand it to you.`

  const { result, status } = await runMatchTask(
    match,
    {
      type: 'discover',
      instructions,
      maxSteps: CONSULT_MAX_STEPS,
      maxOutputChars: CONSULT_MAX_OUTPUT_CHARS,
      timeoutMs: CONSULT_TIMEOUT_MS,
      outputSchema: {
        answer: 'string — the focused answer',
        wantsToExecute: 'boolean — true only if you should act, not just answer',
        proposedAction: 'string — what you would do, if wantsToExecute',
      },
    },
    settings,
  )
  const payload = parseConsultPayload(result)

  return {
    consulted: true,
    agentId: match.id,
    role: match.role,
    provider: match.provider,
    model: match.model,
    tags: match.tags,
    answer: payload.answer || '(peer returned no answer)',
    peerWantsToExecute: payload.wantsToExecute,
    proposedAction: payload.proposedAction,
    untrusted: true,
    status,
  }
}

// ── Final multi-model peer review (Workstream D) ──────────────────────────────

const REVIEW_MAX_STEPS = 1
const REVIEW_MAX_OUTPUT_CHARS = 2400
const REVIEW_TIMEOUT_MS = 120000
const REVIEW_DIFF_CHARS = 14000
const MIN_REVIEWERS = 2
const MAX_REVIEWERS = 3

export interface ReviewArgs extends Record<string, unknown> {
  diff?: unknown
  request?: unknown
  rubric?: unknown
  reviewers?: unknown
}

export interface ReviewFinding {
  reviewer: string
  severity: string
  note: string
  file?: string
  line?: number
}

export interface ReviewResult {
  reviewed: boolean
  overallVerdict?: 'approved' | 'changes_requested' | 'mixed'
  reviews?: Array<{
    reviewer: string
    provider: string
    model: string
    verdict: string
    summary: string
    findingCount: number
  }>
  findings?: ReviewFinding[]
  untrusted: true
  reason?: string
  message?: string
}

/**
 * Pick up to MAX_REVIEWERS distinct peers, preferring DIVERSITY (different cost tiers /
 * families) — heterogeneous reviewers are the whole point. Excludes the owner role.
 */
function pickReviewers(settings: SubAgentSettings, want: number): FindMatch[] {
  const roster = availableRoster(settings).filter((m) => m.role !== 'orchestrator')
  const byTierDiversity: FindMatch[] = []
  const seenTiers = new Set<string>()
  // First pass: one per distinct cost tier for diversity.
  for (const m of roster) {
    if (!seenTiers.has(m.costTier)) {
      seenTiers.add(m.costTier)
      byTierDiversity.push({ ...m, score: m.tags.length, matchedTags: m.tags })
    }
  }
  // Fill remaining slots with whatever distinct peers are left.
  for (const m of roster) {
    if (byTierDiversity.length >= want) break
    if (!byTierDiversity.some((r) => r.role === m.role)) {
      byTierDiversity.push({ ...m, score: m.tags.length, matchedTags: m.tags })
    }
  }
  return byTierDiversity.slice(0, want)
}

function parseReview(
  raw: unknown,
  reviewer: string,
): {
  verdict: string
  summary: string
  findings: ReviewFinding[]
} {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const verdictRaw = String(obj.verdict ?? obj.result ?? '').toLowerCase()
  const verdict = /change|reject|fail|block/.test(verdictRaw)
    ? 'changes_requested'
    : /approve|pass|ok|lgtm/.test(verdictRaw)
      ? 'approved'
      : 'commented'
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : []
  const findings: ReviewFinding[] = rawFindings.slice(0, 20).map((f) => {
    const fo = f && typeof f === 'object' ? (f as Record<string, unknown>) : {}
    const lineNum = Number(fo.line)
    return {
      reviewer,
      severity: String(fo.severity ?? 'note').toLowerCase(),
      note: String(fo.note ?? fo.message ?? fo.text ?? f ?? '').slice(0, 400),
      file: fo.file ? String(fo.file) : undefined,
      line: Number.isFinite(lineNum) ? lineNum : undefined,
    }
  })
  return { verdict, summary: String(obj.summary ?? '').slice(0, 400), findings }
}

/**
 * Fan a code diff out to 2–3 DIFFERENT peer models for a closing review (bounded, one round,
 * no tools). Each returns a structured verdict + findings anchored to file/line; the result is
 * aggregated (any "changes_requested" → overall changes). Untrusted input — the owner decides
 * the bounded fix pass. Used for complex runs that wrote code; gated by agent_peer_review.
 */
export async function runPeerReview(args: ReviewArgs, settings: SubAgentSettings): Promise<ReviewResult> {
  const diff = clip(args?.diff, REVIEW_DIFF_CHARS)
  if (!diff) {
    return {
      reviewed: false,
      untrusted: true,
      reason: 'no_diff',
      message: 'Pass the code diff to review (e.g. from files.diff or `git diff`).',
    }
  }
  const want = Math.max(MIN_REVIEWERS, Math.min(MAX_REVIEWERS, Number(args?.reviewers) || MAX_REVIEWERS))
  const reviewers = pickReviewers(settings, want)
  if (reviewers.length < MIN_REVIEWERS) {
    return {
      reviewed: false,
      untrusted: true,
      reason: 'insufficient_peers',
      message: `Peer review needs at least ${MIN_REVIEWERS} distinct peer models. Assign more models to the executor/scout roles in Settings → Agents.`,
    }
  }

  const request = clip(args?.request, 1200)
  const rubric =
    clip(args?.rubric, 600) ||
    'Does the change meet the request, follow standards, and introduce no errors or regressions?'
  const instructions =
    `You are a code reviewer. Review this diff against the request and rubric. Do NOT use tools. ` +
    `Be concrete; anchor each finding to a file and line where possible.\n\n` +
    (request ? `REQUEST: ${request}\n\n` : '') +
    `RUBRIC: ${rubric}\n\nDIFF:\n${diff}`
  const outputSchema = {
    verdict: 'string — "approved" or "changes_requested"',
    summary: 'string — one-paragraph assessment',
    findings: 'array of { severity: "blocker|major|minor|nit", note: string, file: string, line: number }',
  }

  const settled = await Promise.all(
    reviewers.map(async (reviewer) => {
      try {
        const { result } = await runMatchTask(
          reviewer,
          {
            type: 'verify',
            instructions,
            maxSteps: REVIEW_MAX_STEPS,
            maxOutputChars: REVIEW_MAX_OUTPUT_CHARS,
            timeoutMs: REVIEW_TIMEOUT_MS,
            outputSchema,
          },
          settings,
        )
        const parsed = parseReview(result, reviewer.role)
        return { reviewer, ...parsed }
      } catch (err) {
        return {
          reviewer,
          verdict: 'errored',
          summary: err instanceof Error ? err.message : 'review failed',
          findings: [] as ReviewFinding[],
        }
      }
    }),
  )

  const findings = settled.flatMap((r) => r.findings)
  const verdicts = settled.map((r) => r.verdict)
  const anyChanges = verdicts.includes('changes_requested')
  const anyApproved = verdicts.includes('approved')
  const overallVerdict: ReviewResult['overallVerdict'] = anyChanges
    ? anyApproved
      ? 'mixed'
      : 'changes_requested'
    : 'approved'

  return {
    reviewed: true,
    overallVerdict,
    reviews: settled.map((r) => ({
      reviewer: r.reviewer.role,
      provider: r.reviewer.provider,
      model: r.reviewer.model,
      verdict: r.verdict,
      summary: r.summary,
      findingCount: r.findings.length,
    })),
    findings,
    untrusted: true,
  }
}

// ── Overwatcher (supervisor / complexity guide) — Workstream D ────────────────

const OVERWATCH_MAX_OUTPUT_CHARS = 1400
const OVERWATCH_TIMEOUT_MS = 90000
const OVERWATCH_CONTEXT_CHARS = 2000

export interface OverwatchResult {
  available: boolean
  provider?: string
  model?: string
  complexity?: 'trivial' | 'standard' | 'complex'
  guidance?: string
  /** The Overwatcher's captured chain-of-thought (shown in the timeline; backs thin guidance). */
  reasoning?: string
  escalate?: boolean
  suggestedTags?: string[]
  /** Overwatcher output is advisory input — verify before acting on it. */
  untrusted: true
  reason?: string
}

/** Resolve the configured Overwatcher peer (the role bound to a model), or null if none. */
export function resolveOverwatcher(settings: SubAgentSettings): FindMatch | null {
  const member = availableRoster(settings).find((m) => m.role === 'overwatcher')
  if (!member) return null
  return { ...member, score: member.tags.length, matchedTags: member.tags }
}

/** True when a distinct Overwatcher model is configured and credential-ready. */
export function hasOverwatcher(settings: SubAgentSettings): boolean {
  return resolveOverwatcher(settings) !== null
}

function parseOverwatch(raw: unknown): {
  complexity: OverwatchResult['complexity']
  guidance: string
  escalate: boolean
  suggestedTags: string[]
} {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const c = String(obj.complexity ?? '').toLowerCase()
  const complexity = /complex|hard|high/.test(c)
    ? 'complex'
    : /trivial|simple|easy|low/.test(c)
      ? 'trivial'
      : 'standard'
  const tagsRaw = Array.isArray(obj.suggestedTags) ? obj.suggestedTags : []
  return {
    complexity,
    guidance: String(obj.guidance ?? obj.advice ?? '').slice(0, OVERWATCH_MAX_OUTPUT_CHARS),
    escalate: obj.escalate === true || obj.escalate === 'true',
    suggestedTags: tagsRaw
      .map((t) =>
        String(t || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  }
}

/**
 * Ask the Overwatcher (a reasoning model) to gauge task complexity and advise the active
 * agent: a one-shot, tool-free reasoning call under the overwatcher role's tier. Returns
 * guidance + whether the active agent should escalate (pull in a stronger/specialist peer)
 * and which tags to look for. Advisory only — the active model owns the decision.
 */
export async function runOverwatch(
  args: { task?: unknown; context?: unknown; question?: unknown },
  settings: SubAgentSettings,
  emit?: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<OverwatchResult> {
  const overwatcher = resolveOverwatcher(settings)
  if (!overwatcher) {
    return { available: false, untrusted: true, reason: 'no_overwatcher' }
  }

  const task = clip(args?.task ?? args?.question, 2000)
  const contextText =
    args?.context && typeof args.context === 'object'
      ? clip(JSON.stringify(args.context), OVERWATCH_CONTEXT_CHARS)
      : clip(args?.context, OVERWATCH_CONTEXT_CHARS)

  const instructions =
    `You are the Overwatcher — a reasoning model supervising the active agent. Think through how ` +
    `hard this task is, then give brief, concrete guidance. Decide whether the active agent should ` +
    `pull in a stronger or specialist PEER (escalate) and, if so, which ability tags to look for ` +
    `(reasoning, code, vision, long-context, fast, cheap, local, or a domain like "rust"). Do NOT ` +
    `attempt the task yourself.\n\nTASK: ${task || '(see context)'}` +
    (contextText ? `\n\nCONTEXT / PROGRESS: ${contextText}` : '')

  // Capture the Overwatcher's reasoning so it can be both shown in the timeline and folded
  // into the guidance we inject — a reasoning model often puts the substance in its thinking.
  let thinking = ''
  const collect = (event: Record<string, unknown>) => {
    if (event?.type === 'thinking' && typeof event.summary === 'string' && event.summary.trim()) {
      thinking += (thinking ? '\n' : '') + event.summary.trim()
    }
    emit?.(event)
  }

  const { result } = await runMatchTask(
    overwatcher,
    {
      type: 'discover',
      instructions,
      maxSteps: 1,
      maxOutputChars: OVERWATCH_MAX_OUTPUT_CHARS,
      timeoutMs: OVERWATCH_TIMEOUT_MS,
      outputSchema: {
        complexity: 'string — trivial | standard | complex',
        guidance: 'string — concise steering for the active agent',
        escalate: 'boolean — true if the agent should pull in a stronger/specialist peer',
        suggestedTags: 'string[] — ability tags to look for if escalating',
      },
    },
    settings,
    collect,
    signal,
  )
  const parsed = parseOverwatch(result)
  // If the structured guidance came back thin, fall back to the captured reasoning so the
  // injected steer is never empty (the original "not injected properly" symptom).
  const reasoning = thinking.replace(/^Picked up task:.*$/gm, '').trim()
  const guidance = parsed.guidance || reasoning.slice(0, OVERWATCH_MAX_OUTPUT_CHARS)

  return {
    available: true,
    provider: overwatcher.provider,
    model: overwatcher.model,
    complexity: parsed.complexity,
    guidance,
    reasoning: reasoning.slice(0, OVERWATCH_MAX_OUTPUT_CHARS),
    escalate: parsed.escalate,
    suggestedTags: parsed.suggestedTags,
    untrusted: true,
  }
}

// ── Teamwork mode — collaborative planning (Workstream D / Stage 2) ───────────

const TEAMWORK_MAX_OUTPUT_CHARS = 2200
const TEAMWORK_TIMEOUT_MS = 120000
const TEAMWORK_MAX_PARTS = 6

export interface TeamworkPart {
  summary: string
  role: string // owner role (orchestrator | executor | scout | overwatcher)
}

export interface TeamworkPlan {
  ok: boolean
  reason?: string
  planner?: string
  team?: Array<{ role: string; model: string }>
  parts?: TeamworkPart[]
}

function parseTeamworkParts(raw: unknown, roleSet: Set<string>): TeamworkPart[] {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const rawParts = Array.isArray(obj.parts) ? obj.parts : Array.isArray(raw) ? raw : []
  const parts: TeamworkPart[] = []
  for (const p of rawParts.slice(0, TEAMWORK_MAX_PARTS)) {
    const po = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
    const summary = String(po.summary ?? po.task ?? po.text ?? p ?? '').trim()
    if (!summary) continue
    const roleRaw = String(po.role ?? po.owner ?? po.agent ?? '')
      .trim()
      .toLowerCase()
    const role = roleSet.has(roleRaw) ? roleRaw : 'orchestrator'
    parts.push({ summary: summary.slice(0, 300), role })
  }
  return parts
}

/**
 * Teamwork planning: the team co-decomposes a task. A planner model (prefer the Overwatcher's
 * reasoning, else the orchestrator) is given the full roster + each agent's tags and splits the
 * task into independent parts, each OWNED by the best-fit agent. Returns the parts so the runtime
 * can seed owner-tagged todos and the owner agents can each take their piece. One bounded call.
 */
export async function planTeamwork(
  task: unknown,
  settings: SubAgentSettings,
  emit?: (event: Record<string, unknown>) => void,
): Promise<TeamworkPlan> {
  const roster = availableRoster(settings)
  if (roster.length < 2) return { ok: false, reason: 'insufficient_agents' }

  const plannerMember =
    roster.find((m) => m.role === 'overwatcher') || roster.find((m) => m.role === 'orchestrator') || roster[0]
  const planner: FindMatch = {
    ...plannerMember,
    score: plannerMember.tags.length,
    matchedTags: plannerMember.tags,
  }
  const roleSet = new Set(roster.map((m) => m.role))
  const rosterDesc = roster.map((m) => `${m.role} [${m.tags.join(', ') || 'general'}]`).join('; ')

  const instructions =
    `You are coordinating a TEAM of AI agents working together on ONE task. Split it into a small ` +
    `set of parts (no more than ${TEAMWORK_MAX_PARTS}), keeping parts independent where possible, ` +
    `and assign each part to the best-fit teammate by its ability tags. Every capable teammate ` +
    `should get a part where it fits.\n\nTEAM (role [tags]): ${rosterDesc}\n\nTASK: ${clip(task, 2000)}`

  const { result } = await runMatchTask(
    planner,
    {
      type: 'discover',
      instructions,
      maxSteps: 1,
      maxOutputChars: TEAMWORK_MAX_OUTPUT_CHARS,
      timeoutMs: TEAMWORK_TIMEOUT_MS,
      outputSchema: {
        parts: 'array of { summary: string — the part, role: string — owner role from the team }',
      },
    },
    settings,
    emit,
  )

  const parts = parseTeamworkParts(result, roleSet)
  if (!parts.length) return { ok: false, reason: 'no_plan', planner: planner.role }
  return {
    ok: true,
    planner: planner.role,
    team: roster.map((m) => ({ role: m.role, model: m.model })),
    parts,
  }
}

/** Tag list for an arbitrary role under the current settings (used for UI attribution). */
export function tagsForRole(role: unknown, settings: SubAgentSettings): string[] {
  const identity = resolveAgentIdentity(role, settings as Parameters<typeof resolveAgentIdentity>[1])
  return deriveModelTags(identity.provider, identity.model)
}

/** Cost tier for a role — small helper kept here so UI/prompt share one derivation. */
export function costTierForRole(role: unknown, settings: SubAgentSettings): string {
  const identity = resolveAgentIdentity(role, settings as Parameters<typeof resolveAgentIdentity>[1])
  return getRoutingProfile(identity.provider, identity.model).costTier
}

// ── Teamwork V2 — collaborative planning with per-member ownership (Workstream D / §4) ──────────
// The team co-plans ONE task before any execution: the lead drafts a split, the plan is passed
// around to every other loaded member for input, and the lead reconciles it into final parts —
// each OWNED by a specific member id (so the todo list can be split per agent) with dependencies.

const TEAMWORK_V2_PLAN_TIMEOUT_MS = 120000
const TEAMWORK_V2_COMMENT_TIMEOUT_MS = 90000
const TEAMWORK_V2_MAX_PARTS = 8
const TEAMWORK_V2_MAX_COMMENTERS = 5
const TEAMWORK_V2_COMMENT_CHARS = 600

export interface TeamworkPlanPart {
  id: string
  summary: string
  /** Roster member id that owns this part (executor, executor#2, scout, …). */
  owner: string
  /** The owner's role — for color/tier attribution in the todo lanes. */
  role: string
  /** Part ids this one must follow (a small DAG the lead sequences during execution). */
  dependsOn: string[]
}

export interface TeamworkPlanV2 {
  ok: boolean
  reason?: string
  planner?: string
  team?: Array<{ id: string; role: string; model: string; tags: string[] }>
  parts?: TeamworkPlanPart[]
  /** Human-readable markdown for the approval side panel (the "tmp file" the user reviews). */
  planText?: string
}

/** The members that take part in teamwork: every bound model except the advisory Overwatcher. */
function teamworkMembers(settings: SubAgentSettings): FindMatch[] {
  return availableRoster(settings)
    .filter((member) => member.role !== 'overwatcher')
    .map((member) => ({ ...member, score: member.tags.length, matchedTags: member.tags }))
}

/** Parse a model's raw parts payload into validated parts with member owners + deps. Pure. */
export function parseTeamworkPlanParts(raw: unknown, members: FindMatch[]): TeamworkPlanPart[] {
  const validIds = members.map((m) => m.id)
  const roleOf = (id: string): string => members.find((m) => m.id === id)?.role || 'orchestrator'
  const defaultOwner = validIds[0] || 'orchestrator'
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const rawParts = Array.isArray(obj.parts) ? obj.parts : Array.isArray(raw) ? raw : []
  const parts: TeamworkPlanPart[] = []
  for (const entry of rawParts.slice(0, TEAMWORK_V2_MAX_PARTS)) {
    const po = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const summary = String(po.summary ?? po.task ?? po.text ?? entry ?? '').trim()
    if (!summary) continue
    const ownerRaw = String(po.owner ?? po.agent ?? po.member ?? po.role ?? '').trim()
    // Accept an exact member id; else map a role name to its primary member; else the first member.
    const owner = validIds.includes(ownerRaw)
      ? ownerRaw
      : members.find((m) => m.role === normalizeAgentRole(ownerRaw))?.id || defaultOwner
    const deps = Array.isArray(po.dependsOn) ? po.dependsOn : Array.isArray(po.depends_on) ? po.depends_on : []
    parts.push({
      id: `p${parts.length + 1}`,
      summary: summary.slice(0, 300),
      owner,
      role: roleOf(owner),
      dependsOn: deps
        .map((d) => String(d || '').trim())
        .filter(Boolean)
        .slice(0, 4),
    })
  }
  return parts
}

/** Render the plan as markdown for the approval side panel. Pure. */
export function renderTeamworkPlanMarkdown(
  parts: TeamworkPlanPart[],
  team: Array<{ id: string; role: string; model: string }>,
): string {
  const teamLine = team.map((t) => `- **${t.id}** (${t.role}) — \`${t.model}\``).join('\n')
  const partLines = parts
    .map((p, i) => {
      const dep = p.dependsOn.length ? ` _(after ${p.dependsOn.join(', ')})_` : ''
      return `${i + 1}. **[${p.owner}]** ${p.summary}${dep}`
    })
    .join('\n')
  return `# Team plan\n\n## Team\n${teamLine}\n\n## Parts (each owned by one teammate)\n${partLines}\n`
}

/**
 * Run one collaborative planning pass: the lead (orchestrator) drafts a split, the draft is passed
 * to every other loaded member for terse input, then the lead reconciles it into the final parts.
 * Bounded (one comment round, capped commenters). Accepts an optional user `steer` so the
 * keep-planning / steer loop can re-plan with the user's clarification. Returns the parts + a
 * markdown rendering for the approval side panel.
 */
export async function runTeamworkPlanning(
  task: unknown,
  settings: SubAgentSettings,
  opts: {
    steer?: string
    emit?: (event: Record<string, unknown>) => void
    signal?: AbortSignal
  } = {},
): Promise<TeamworkPlanV2> {
  const members = teamworkMembers(settings)
  if (members.length < 2) return { ok: false, reason: 'insufficient_agents' }
  const { emit } = opts
  const steer = String(opts.steer || '').trim()

  const lead =
    members.find((m) => m.role === 'orchestrator' && m.primary) ||
    members.find((m) => m.role === 'orchestrator') ||
    members[0]
  const teamDesc = members.map((m) => `${m.id} (${m.role}) [${m.tags.join(', ') || 'general'}]`).join('; ')
  const taskText = clip(task, 2000)
  const partsSchema = {
    parts: 'array of { summary: string, owner: string — a member id from the team, dependsOn: string[] — part ids }',
  }

  // 1) DRAFT — the lead splits the task and assigns owners.
  const draftInstr =
    `You are the lead coordinating a TEAM of AI agents on ONE task. Split it into a small set of ` +
    `parts (no more than ${TEAMWORK_V2_MAX_PARTS}), keeping them independent where possible, and ` +
    `assign each to the best-fit teammate by its EXACT member id. Add dependsOn ids where a part ` +
    `must follow another.\n\nTEAM (id (role) [tags]): ${teamDesc}\n\nTASK: ${taskText}` +
    (steer ? `\n\nUSER STEER (incorporate this): ${steer}` : '')
  const draft = await runMatchTask(
    lead,
    {
      type: 'discover',
      instructions: draftInstr,
      maxSteps: 1,
      maxOutputChars: TEAMWORK_MAX_OUTPUT_CHARS,
      timeoutMs: TEAMWORK_V2_PLAN_TIMEOUT_MS,
      outputSchema: partsSchema,
    },
    settings,
    emit,
    opts.signal,
  )
  let parts = parseTeamworkPlanParts(draft.result, members)
  if (!parts.length) return { ok: false, reason: 'no_plan', planner: lead.id }

  // 2) PASS-AROUND — every other member gives terse input on the plan + its part (in parallel).
  const draftText = renderTeamworkPlanMarkdown(parts, members)
  const commenters = members.filter((m) => m.id !== lead.id).slice(0, TEAMWORK_V2_MAX_COMMENTERS)
  const settled = await Promise.all(
    commenters.map(async (member) => {
      try {
        const { result } = await runMatchTask(
          member,
          {
            type: 'discover',
            instructions:
              `You are teammate "${member.id}" (${member.role}). Review the team plan below. In 1-3 ` +
              `sentences note any change to YOUR part, a missing step, or a better owner. Be terse.\n\n${draftText}`,
            maxSteps: 1,
            maxOutputChars: TEAMWORK_V2_COMMENT_CHARS,
            timeoutMs: TEAMWORK_V2_COMMENT_TIMEOUT_MS,
            outputSchema: { comment: 'string — your terse feedback on the plan' },
          },
          settings,
          emit,
          opts.signal,
        )
        const comment =
          result && typeof result === 'object'
            ? String((result as Record<string, unknown>).comment ?? '').trim()
            : String(result ?? '').trim()
        return comment ? { id: member.id, comment: clip(comment, TEAMWORK_V2_COMMENT_CHARS) } : null
      } catch {
        return null
      }
    }),
  )
  const feedback = settled.filter((f): f is { id: string; comment: string } => f !== null)

  // 3) RECONCILE — the lead merges the feedback into the final plan.
  if (feedback.length) {
    const fbText = feedback.map((f) => `- ${f.id}: ${f.comment}`).join('\n')
    const reconcileInstr =
      `You are the team lead finalizing the plan. Below are the draft and each teammate's feedback. ` +
      `Produce the FINAL parts (no more than ${TEAMWORK_V2_MAX_PARTS}), each owned by a teammate id, ` +
      `incorporating the feedback and setting dependsOn where a part must follow another.\n\n` +
      `${draftText}\n\nTEAMMATE FEEDBACK:\n${fbText}` +
      (steer ? `\n\nUSER STEER: ${steer}` : '')
    const reconciled = await runMatchTask(
      lead,
      {
        type: 'discover',
        instructions: reconcileInstr,
        maxSteps: 1,
        maxOutputChars: TEAMWORK_MAX_OUTPUT_CHARS,
        timeoutMs: TEAMWORK_V2_PLAN_TIMEOUT_MS,
        outputSchema: partsSchema,
      },
      settings,
      emit,
      opts.signal,
    )
    const finalParts = parseTeamworkPlanParts(reconciled.result, members)
    if (finalParts.length) parts = finalParts
  }

  const team = members.map((m) => ({ id: m.id, role: m.role, model: m.model, tags: m.tags }))
  return {
    ok: true,
    planner: lead.id,
    team,
    parts,
    planText: renderTeamworkPlanMarkdown(parts, members),
  }
}
