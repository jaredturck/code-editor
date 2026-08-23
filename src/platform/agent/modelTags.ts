/**
 * Tagged model mesh — ability tags + tag-based peer discovery (Workstream D).
 *
 * A role is a *tag of permission + ability*, not "who answers". This module derives
 * ability tags for a (provider, model) pair from the existing capability spine
 * (modelProfiles / modelRouting) — NO per-model table to hand-maintain — and scores
 * configured roles against a set of desired tags or a free-text topic so a model can
 * "pull" the peer that most likely knows more about a subject.
 *
 * Everything here is PURE and deterministic: discovery is a tag/specialty match against
 * the configured roster, never a model call (avoids the "triage trap"). The consult /
 * delegate execution that acts on a match lives in meshClient.ts; the budget ledger that
 * bounds it lives in meshConductor.ts.
 */
import { getModelCapabilities } from '@/platform/modelProfiles'
import { getRoutingProfile } from '@/platform/agent/modelRouting'
import { AGENT_ROLE_IDS, readAgentModels, type AgentRoleId } from '@/platform/agent/agentIdentity'

export type AbilityTag =
  'reasoning' | 'code' | 'vision' | 'long-context' | 'fast' | 'cheap' | 'local' | 'tool-accurate' | 'general'

export const ABILITY_TAGS: readonly AbilityTag[] = [
  'reasoning',
  'code',
  'vision',
  'long-context',
  'fast',
  'cheap',
  'local',
  'tool-accurate',
  'general',
] as const

const LONG_CONTEXT_THRESHOLD = 200000

// Model-name / family heuristics for the two tags the capability spine can't infer.
const CODE_FAMILIES = new Set(['codestral', 'deepseek', 'deepseek-v4', 'deepseek-r1', 'qwen25'])
const CODE_NAME = /\b(code|coder|codestral|deepseek|starcoder|qwen.*coder)\b/i
const VISION_FAMILIES = new Set(['claude', 'gpt4o', 'gpt', 'gemini2', 'gemini15', 'gemini'])
const VISION_NAME = /\b(vision|vl|llava|multimodal|omni|4o)\b/i

/**
 * Derive the ability tags for a (provider, model) pair from the capability spine.
 * Stable + deterministic — safe to call per render / per discovery with no side effects.
 */
export function deriveModelTags(provider: unknown, model: unknown): AbilityTag[] {
  const caps = getModelCapabilities(provider, model)
  const routing = getRoutingProfile(provider, model)
  const family = String(caps.family || '')
  const name = String(model || '').toLowerCase()
  const tags = new Set<AbilityTag>()

  if (caps.reasoning === true) tags.add('reasoning')
  if (Number(caps.contextWindow) >= LONG_CONTEXT_THRESHOLD) tags.add('long-context')
  if (routing.local) tags.add('local')
  if (routing.costTier === 'cheap') tags.add('cheap')
  if (routing.speed === 'fast') tags.add('fast')
  if (caps.toolProtocol === 'native') tags.add('tool-accurate')
  if (CODE_FAMILIES.has(family) || CODE_NAME.test(name)) tags.add('code')
  if (VISION_FAMILIES.has(family) || VISION_NAME.test(name)) tags.add('vision')

  // Every model can field a general question — keeps topic matching from returning empty.
  tags.add('general')

  return ABILITY_TAGS.filter((tag) => tags.has(tag))
}

// Free-text topic → likely ability tags. Pure keyword mapping; biases discovery without a
// model call. Unmatched topics fall back to 'general' so find() still returns candidates.
const TOPIC_TAG_RULES: ReadonlyArray<{ pattern: RegExp; tags: AbilityTag[] }> = [
  {
    pattern: /\b(code|coding|refactor|bug|debug|implement|function|api|compile|build)\b/i,
    tags: ['code', 'tool-accurate'],
  },
  {
    pattern: /\b(reason|reasoning|plan|prove|math|logic|analy[sz]e|architect|strategy)\b/i,
    tags: ['reasoning'],
  },
  {
    pattern: /\b(image|photo|screenshot|screen|diagram|visual|picture|ocr)\b/i,
    tags: ['vision'],
  },
  {
    pattern: /\b(long|large|whole|entire|book|transcript|huge|document|corpus)\b/i,
    tags: ['long-context'],
  },
  {
    pattern: /\b(fast|quick|cheap|simple|lookup|trivial|fetch)\b/i,
    tags: ['fast', 'cheap'],
  },
  { pattern: /\b(local|offline|private|on[- ]device)\b/i, tags: ['local'] },
]

export function topicToTags(topic: unknown): AbilityTag[] {
  const text = String(topic || '').trim()
  if (!text) return []
  const tags = new Set<AbilityTag>()
  for (const rule of TOPIC_TAG_RULES) {
    if (rule.pattern.test(text)) rule.tags.forEach((t) => tags.add(t))
  }
  return ABILITY_TAGS.filter((tag) => tags.has(tag))
}

export interface RosterMember {
  /** Stable id: the role for its primary model, `role#2`, `role#3`, … for extra models. */
  id: string
  role: AgentRoleId
  /** True for the role's primary (answering/executing) binding; false for extra pool models. */
  primary: boolean
  provider: string
  model: string
  /** Which of the provider's keys this member uses (Key 1/2/…) — so concurrent peers don't
   *  share one rate limit. */
  keyId: string
  /** Derived ability tags PLUS any custom per-role tags (lowercased, deduped). */
  tags: string[]
  tier: number
  costTier: ReturnType<typeof getRoutingProfile>['costTier']
}

type TierSettings = Record<string, unknown> & {
  agent_permission_tier?: unknown
  agent_models?: unknown
}

const ROLE_DEFAULT_TIER: Record<AgentRoleId, number> = {
  orchestrator: 3,
  executor: 2,
  scout: 1,
  // The Overwatcher only advises (identifies complexity, guides, recommends escalation) — it
  // never executes tools itself, so it defaults to read-only.
  overwatcher: 1,
}

function resolveRoleTier(role: AgentRoleId, settings: TierSettings): number {
  const perRole = Number(settings?.[`agent_permission_tier_${role}`])
  if (Number.isFinite(perRole)) return perRole
  const shared = Number(settings?.agent_permission_tier)
  if (Number.isFinite(shared)) return shared
  return ROLE_DEFAULT_TIER[role]
}

/**
 * Effective tags = (derived ability tags MINUS the maintainer's suppressed ones) ∪ custom tags.
 * Lets a maintainer drop an auto-derived tag they disagree with (e.g. cost tier) and add their own.
 */
function tagsFor(provider: string, model: string, customTags: string[], disabledTags: string[]): string[] {
  const disabled = new Set(disabledTags)
  const set = new Set<string>([
    ...deriveModelTags(provider, model)
      .map((t) => String(t).toLowerCase())
      .filter((t) => !disabled.has(t)),
    ...customTags,
  ])
  return Array.from(set)
}

/**
 * Build the configured model pool from the canonical flat list (agentIdentity.readAgentModels):
 * every entry becomes a discoverable peer under its role's permission tier, with each member's
 * derived+custom tags. Members are de-duped by role+provider+model+key, so the SAME model on
 * different keys (or in different roles) are DISTINCT agents — the multi-key peers and a same-model
 * Overwatcher the old provider+model de-dup collapsed. The role's primary keeps the bare `role`
 * member id; extras become `role#2`, `role#3`, … Pure read over settings — no live roster call.
 */
export function buildAgentRoster(settings: TierSettings): RosterMember[] {
  const entries = readAgentModels(settings as Parameters<typeof readAgentModels>[0])
  const members: RosterMember[] = []
  const seen = new Set<string>()

  for (const role of AGENT_ROLE_IDS) {
    const tier = resolveRoleTier(role, settings)
    const roleEntries = entries
      .filter((entry) => entry.role === role && (entry.provider || entry.model))
      // Primary first so it gets the bare `role` member id; extras become role#2, role#3, …
      .sort((a, b) => Number(b.primary) - Number(a.primary))

    let rank = 0
    for (const entry of roleEntries) {
      const key = `${role}::${entry.provider.toLowerCase()}::${entry.model.toLowerCase()}::${entry.keyId}`
      if (seen.has(key)) continue
      seen.add(key)

      rank += 1
      members.push({
        id: rank === 1 ? role : `${role}#${rank}`,
        role,
        primary: rank === 1,
        provider: entry.provider,
        model: entry.model,
        keyId: entry.keyId || '1',
        tags: tagsFor(entry.provider, entry.model, entry.tags, entry.disabledTags),
        tier,
        costTier: getRoutingProfile(entry.provider, entry.model).costTier,
      })
    }
  }

  return members
}

export interface FindMatch extends RosterMember {
  score: number
  matchedTags: string[]
}

export interface FindOptions {
  tags?: unknown
  topic?: unknown
  exclude?: unknown // role ids / member ids to skip (caller self + visited set → no cycles)
  limit?: unknown
}

// Accept ANY non-empty tag token (lowercased) — derived ability tags AND custom specialty
// tags like "rust"/"sql" that a role may be tagged with. Not restricted to ABILITY_TAGS so a
// model can pull a peer by a specialty the user assigned.
function asTagList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : []
  return list
    .map((t) =>
      String(t || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
}

/**
 * Rank configured peers against desired tags (explicit tags ∪ topic-derived tags).
 * Deterministic tag-overlap scoring — this is the read-only heart of agent.find: it is
 * how a model "pulls" a relevant peer without spending a model call to do it.
 */
export function findPeers(settings: TierSettings, options: FindOptions = {}): FindMatch[] {
  const desired = new Set<string>([...asTagList(options.tags), ...topicToTags(options.topic)])
  // No constraints → rank the whole pool by capability breadth (most-tagged first).
  const wantsAny = desired.size > 0
  const excluded = new Set(
    (Array.isArray(options.exclude)
      ? options.exclude
      : typeof options.exclude === 'string'
        ? [options.exclude]
        : []
    ).map((r) =>
      String(r || '')
        .trim()
        .toLowerCase(),
    ),
  )
  const limit = Math.max(1, Math.min(8, Number(options.limit) || 4))

  const ranked = buildAgentRoster(settings)
    // Exclude by role OR member id so a visited role hides all its models (cycle guard).
    .filter((m) => !excluded.has(m.role) && !excluded.has(m.id))
    .map((m) => {
      const matchedTags = m.tags.filter((t) => desired.has(t))
      // With desired tags: overlap count. Without: capability breadth as a soft proxy.
      const score = wantsAny ? matchedTags.length : m.tags.length
      return { ...m, score, matchedTags }
    })
    .filter((m) => (wantsAny ? m.score > 0 : true))
    // Prefer the strongest match, then primary models, then the lower (cheaper) tier.
    .sort((a, b) => b.score - a.score || Number(b.primary) - Number(a.primary) || a.tier - b.tier)

  return ranked.slice(0, limit)
}
