/**
 * Complexity-aware model routing (Workstream B).
 *
 * Pure helpers that let the runtime / tagged mesh pick the right-sized model for a unit of
 * work: derive cheap/standard/premium + fast/local routing tags from the existing capability
 * spine (modelProfiles), estimate task complexity CHEAPLY (no extra model call — that would be
 * the "triage trap"), and pick the best candidate. Off by default (`agent_model_routing`);
 * the tagged-mesh router (Workstream D) consumes these.
 */
import { getModelCapabilities } from '@/platform/modelProfiles'

export type CostTier = 'cheap' | 'standard' | 'premium'
export type SpeedTier = 'fast' | 'standard'
export type TaskComplexity = 'trivial' | 'standard' | 'complex'

export interface RoutingProfile {
  family: string
  provider: string
  costTier: CostTier
  speed: SpeedTier
  local: boolean
  reasoning: boolean
  contextWindow: number
}

const PREMIUM_FAMILIES = new Set(['claude', 'openai-o', 'gpt-oss', 'nemotron', 'gemini2'])
const SMALL_FAMILIES = new Set(['gpt35', 'gemma', 'gemma3', 'phi', 'phi3', 'phi4'])
const SMALL_CONTEXT = 65536
const LARGE_CONTEXT = 400000

// Derive routing tags from the capability spine + provider — no per-model table to maintain.
export function getRoutingProfile(provider: unknown, model: unknown): RoutingProfile {
  const caps = getModelCapabilities(provider, model)
  const family = String(caps.family || '')
  const prov = String(caps.provider || '')
  const local = prov === 'local'
  const contextWindow = Number(caps.contextWindow) || 0
  const reasoning = caps.reasoning === true

  let costTier: CostTier
  if (prov === 'deepseek' && /v4-flash/i.test(String(model || ''))) {
    costTier = 'cheap'
  } else if (prov === 'deepseek' && /v4-pro/i.test(String(model || ''))) {
    costTier = 'standard'
  } else if (local || SMALL_FAMILIES.has(family) || (contextWindow > 0 && contextWindow <= SMALL_CONTEXT)) {
    costTier = 'cheap'
  } else if (PREMIUM_FAMILIES.has(family) || contextWindow >= LARGE_CONTEXT) {
    costTier = 'premium'
  } else {
    costTier = 'standard'
  }

  // Reasoning models deliberate internally (slower); small/local models are fast.
  const speed: SpeedTier = reasoning ? 'standard' : costTier === 'cheap' ? 'fast' : 'standard'

  return { family, provider: prov, costTier, speed, local, reasoning, contextWindow }
}

const COMPLEX_SIGNALS =
  /\b(refactor|implement|build|debug|fix|design|architect|migrate|optimi[sz]e|review|analy[sz]e|integrate|across|multiple|pipeline|end[- ]to[- ]end|test\s+suite)\b/i
const TRIVIAL_SIGNALS =
  /^\s*(hi|hey|hello|yo|thanks|thank you|ty|ok|okay|cool|nice|sup|good (morning|night|evening)|gm|gn)\b/i

// Cheap heuristic complexity estimate — NO model call. Used to bias routing; the lean
// first-turn (Workstream A) still does the real work of resolving trivial inputs in one call.
export function estimateTaskComplexity(userInput: unknown, conversation: unknown[] = []): TaskComplexity {
  void conversation
  const text = String(userInput || '').trim()
  if (!text) return 'trivial'
  if (TRIVIAL_SIGNALS.test(text) && text.length < 40) return 'trivial'
  const words = text.split(/\s+/).filter(Boolean).length
  if (COMPLEX_SIGNALS.test(text) || words > 60 || /```|\n/.test(text)) return 'complex'
  if (words <= 8) return 'trivial'
  return 'standard'
}

export interface ModelCandidate {
  id: string
  provider: string
  model: string
}

const COST_RANK: Record<CostTier, number> = { cheap: 0, standard: 1, premium: 2 }

// Pick the model for a complexity: complex → most capable; trivial → cheapest; standard →
// cheapest that isn't the weakest. Deterministic; never calls a model. null if no candidates.
export function pickModelForComplexity(
  candidates: ModelCandidate[],
  complexity: TaskComplexity,
): ModelCandidate | null {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.model)
  if (!list.length) return null
  const ranked = list.map((c) => ({
    candidate: c,
    profile: getRoutingProfile(c.provider, c.model),
  }))
  const cheapestFirst = [...ranked].sort((a, b) => COST_RANK[a.profile.costTier] - COST_RANK[b.profile.costTier])
  if (complexity === 'complex') return cheapestFirst[cheapestFirst.length - 1].candidate
  if (complexity === 'trivial') return cheapestFirst[0].candidate
  return (cheapestFirst.find((r) => r.profile.costTier !== 'cheap') || cheapestFirst[0]).candidate
}

// Routing is opt-in; default off until the user configures a multi-model pool.
export function isModelRoutingEnabled(settings: { agent_model_routing?: unknown } = {}): boolean {
  return String(settings?.agent_model_routing || 'off').toLowerCase() === 'on'
}
