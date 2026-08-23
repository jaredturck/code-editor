/**
 * Opinionated model-selection expert rules for the one-click automatic setup.
 *
 * This is intentionally executable policy rather than a passive model catalog. The
 * provider's live model list is the source of truth; these rules explain which of those
 * available models are suitable for IRIS's balanced four-role agent profile.
 */

import type { AgentRoleId } from '@/platform/agent/agentIdentity'

export interface AutoSetupCandidate {
  provider: string
  model: string
  keyId: string
}

export interface ModelEvaluation extends AutoSetupCandidate {
  excluded: boolean
  confidence: number
  family: string
  roleScores: Record<AgentRoleId, number>
  quality: number
  costEfficiency: number
  speed: number
  coding: number
  reasoning: number
  tools: number
  local: boolean
  reasons: string[]
}

const EXCLUDED_MODEL_PATTERNS = [
  /(^|[-/_.])(embedding|embeddings|embed)([-/_.]|$)/i,
  /(^|[-/_.])(rerank|reranker)([-/_.]|$)/i,
  /(^|[-/_.])(moderation|guard|safety)([-/_.]|$)/i,
  /(^|[-/_.])(tts|speech|audio|transcri(?:be|ption)|whisper)([-/_.]|$)/i,
  /(^|[-/_.])(image|imagen|dall-e|sora|veo|video|music|lyria)([-/_.]|$)/i,
  /(^|[-/_.])(realtime|live-translate|live-preview)([-/_.]|$)/i,
  /(^|[-/_.])(search|research)([-/_.]|$)/i,
]

function baseEvaluation(candidate: AutoSetupCandidate): ModelEvaluation {
  const local = candidate.provider === 'local'
  return {
    ...candidate,
    excluded: false,
    confidence: 20,
    family: candidate.model.toLowerCase(),
    roleScores: {
      orchestrator: local ? 40 : 48,
      executor: 45,
      scout: local ? 65 : 48,
      overwatcher: 42,
    },
    quality: 50,
    costEfficiency: local ? 100 : 55,
    speed: 55,
    coding: 50,
    reasoning: 50,
    tools: 50,
    local,
    reasons: [],
  }
}

function addRole(evaluation: ModelEvaluation, role: AgentRoleId, value: number): void {
  evaluation.roleScores[role] += value
}

function addAllRoles(evaluation: ModelEvaluation, value: number): void {
  for (const role of Object.keys(evaluation.roleScores) as AgentRoleId[]) {
    evaluation.roleScores[role] += value
  }
}

function applyGenericRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()

  if (EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(model))) {
    evaluation.excluded = true
    evaluation.reasons.push('Not a general text/tool agent model.')
    return
  }

  if (/preview|experimental|exp\b|beta/.test(model)) {
    addAllRoles(evaluation, -8)
    evaluation.confidence -= 4
    evaluation.reasons.push('Preview models receive a stability penalty.')
  }

  if (/deprecated|legacy|gpt-3\.5|gemini-1\.5|gemini-2\.0|claude-3[-.]|codellama|phi3\b/.test(model)) {
    addAllRoles(evaluation, -55)
    evaluation.quality -= 35
    evaluation.reasons.push('Legacy generation; kept available manually but avoided by auto setup.')
  }

  if (/mini|nano|flash-lite|haiku|small|lite|8b|9b|7b|3b/.test(model)) {
    evaluation.speed += 25
    evaluation.costEfficiency += 28
    evaluation.quality -= 10
    addRole(evaluation, 'scout', 35)
    addRole(evaluation, 'orchestrator', -18)
    addRole(evaluation, 'overwatcher', -12)
  }

  if (/pro|max|ultra|opus|fable|mythos|405b|70b/.test(model)) {
    evaluation.quality += 20
    evaluation.reasoning += 18
    evaluation.speed -= 15
    evaluation.costEfficiency -= evaluation.local ? 8 : 28
    addRole(evaluation, 'orchestrator', 18)
    addRole(evaluation, 'overwatcher', 18)
    addRole(evaluation, 'scout', -18)
  }

  if (/code|coder|codestral|devstral/.test(model)) {
    evaluation.coding += 35
    evaluation.tools += 18
    addRole(evaluation, 'executor', 45)
    evaluation.reasons.push('Coding-specialized family.')
  }

  if (/reasoner|reasoning|thinking|\bo[134]\b|r1\b/.test(model)) {
    evaluation.reasoning += 30
    evaluation.speed -= 12
    addRole(evaluation, 'orchestrator', 18)
    addRole(evaluation, 'overwatcher', 22)
    addRole(evaluation, 'scout', -15)
  }

  if (/vision|\bvl\b|multimodal|4o\b|gemini|claude/.test(model)) {
    addAllRoles(evaluation, 3)
  }
}

function applyOpenAIRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  evaluation.family = model.startsWith('o') ? 'openai-reasoning' : 'openai-gpt'

  if (/^gpt-4\.1(?:$|-)/.test(model)) {
    evaluation.confidence = 100
    evaluation.quality += 26
    evaluation.coding += 30
    evaluation.tools += 28
    evaluation.costEfficiency += 18
    addRole(evaluation, 'orchestrator', 42)
    addRole(evaluation, 'executor', 48)
    addRole(evaluation, 'overwatcher', 25)
    evaluation.reasons.push('Proven balanced coding and tool-use choice.')
  }

  if (/^gpt-4o(?:$|-)/.test(model) && !/mini/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 96)
    evaluation.quality += 22
    evaluation.tools += 24
    evaluation.costEfficiency += 14
    evaluation.speed += 8
    addRole(evaluation, 'orchestrator', 36)
    addRole(evaluation, 'executor', 28)
    addRole(evaluation, 'overwatcher', 22)
    evaluation.reasons.push('Mature multimodal balanced model.')
  }

  if (/^gpt-4o-mini(?:$|-)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 94)
    evaluation.speed += 28
    evaluation.costEfficiency += 35
    evaluation.tools += 16
    addRole(evaluation, 'scout', 48)
    addRole(evaluation, 'executor', 8)
    evaluation.reasons.push('Fast inexpensive Scout candidate.')
  }

  if (/^gpt-5(?:\.\d+)?(?:$|-)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 88)
    evaluation.quality += 34
    evaluation.reasoning += 30
    evaluation.tools += 28
    evaluation.costEfficiency -= /mini|nano|instant/.test(model) ? 0 : 25
    addRole(evaluation, 'orchestrator', /mini|nano|instant/.test(model) ? 18 : 28)
    addRole(evaluation, 'overwatcher', 24)
    addRole(evaluation, 'scout', /mini|nano|instant/.test(model) ? 30 : -22)
    evaluation.reasons.push('Very capable generation, balanced against flagship cost.')
  }

  if (/^(o3|o4-mini)(?:$|-)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 90)
    evaluation.reasoning += 32
    evaluation.costEfficiency += /mini/.test(model) ? 12 : -12
    addRole(evaluation, 'overwatcher', 34)
    addRole(evaluation, 'orchestrator', 22)
    addRole(evaluation, 'scout', -22)
  }
}

function applyAnthropicRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  evaluation.family = 'anthropic-claude'

  if (/claude-sonnet-4-6/.test(model)) {
    evaluation.confidence = 100
    evaluation.quality += 34
    evaluation.reasoning += 30
    evaluation.coding += 32
    evaluation.tools += 34
    evaluation.costEfficiency += 8
    addRole(evaluation, 'orchestrator', 52)
    addRole(evaluation, 'executor', 46)
    addRole(evaluation, 'overwatcher', 42)
    evaluation.reasons.push('Anthropic balanced agentic coding model.')
  }

  if (/claude-haiku-4-5/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 98)
    evaluation.speed += 35
    evaluation.costEfficiency += 38
    evaluation.tools += 20
    addRole(evaluation, 'scout', 52)
    addRole(evaluation, 'executor', 10)
    evaluation.reasons.push('Fast cost-effective Claude worker.')
  }

  if (/claude-opus-4-8/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 98)
    evaluation.quality += 42
    evaluation.reasoning += 40
    evaluation.coding += 32
    evaluation.tools += 36
    evaluation.costEfficiency -= 34
    addRole(evaluation, 'orchestrator', 30)
    addRole(evaluation, 'overwatcher', 34)
    evaluation.reasons.push('Excellent but deliberately cost-penalized for balanced setup.')
  }

  if (/claude-(fable|mythos)-5/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 92)
    evaluation.quality += 50
    evaluation.reasoning += 45
    evaluation.costEfficiency -= 55
    addRole(evaluation, 'orchestrator', 18)
    addRole(evaluation, 'overwatcher', 22)
    addRole(evaluation, 'scout', -35)
    evaluation.reasons.push('Premium frontier model; not the balanced default.')
  }
}

function applyGeminiRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  evaluation.family = 'google-gemini'

  if (/gemini-3\.5-flash(?:$|-)/.test(model)) {
    evaluation.confidence = 100
    evaluation.quality += 30
    evaluation.coding += 30
    evaluation.reasoning += 22
    evaluation.tools += 30
    evaluation.speed += 22
    evaluation.costEfficiency += 24
    addRole(evaluation, 'orchestrator', 46)
    addRole(evaluation, 'executor', 40)
    addRole(evaluation, 'scout', 28)
    addRole(evaluation, 'overwatcher', 28)
    evaluation.reasons.push('Stable price-performance agentic coding model.')
  }

  if (/gemini-3\.1-pro/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 92)
    evaluation.quality += 38
    evaluation.reasoning += 38
    evaluation.coding += 34
    evaluation.tools += 36
    evaluation.costEfficiency -= 32
    addRole(evaluation, 'orchestrator', 18)
    addRole(evaluation, 'overwatcher', 38)
    addRole(evaluation, 'executor', 24)
    evaluation.reasons.push('Premium preview model; stable Flash is preferred for balanced setup.')
  }

  if (/gemini-3\.1-flash-lite/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 98)
    evaluation.speed += 38
    evaluation.costEfficiency += 42
    evaluation.tools += 18
    addRole(evaluation, 'scout', 54)
  }

  if (/gemini-2\.5-flash(?:$|-)/.test(model) && !/lite/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 98)
    evaluation.quality += 20
    evaluation.reasoning += 18
    evaluation.tools += 24
    evaluation.speed += 20
    evaluation.costEfficiency += 28
    addRole(evaluation, 'orchestrator', 30)
    addRole(evaluation, 'executor', 25)
    addRole(evaluation, 'scout', 34)
    evaluation.reasons.push('Mature price-performance Gemini option.')
  }

  if (/gemini-2\.5-pro/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 96)
    evaluation.quality += 32
    evaluation.reasoning += 34
    evaluation.coding += 28
    evaluation.tools += 28
    evaluation.costEfficiency -= 8
    addRole(evaluation, 'orchestrator', 36)
    addRole(evaluation, 'overwatcher', 36)
    addRole(evaluation, 'executor', 25)
  }
}

function applyDeepSeekRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  evaluation.family = 'deepseek-v4'
  evaluation.costEfficiency += 45
  evaluation.coding += 24
  evaluation.tools += 24

  if (/deepseek-v4-pro/.test(model)) {
    evaluation.confidence = 100
    evaluation.quality += 32
    evaluation.reasoning += 34
    evaluation.coding += 22
    evaluation.tools += 22
    addRole(evaluation, 'orchestrator', 44)
    addRole(evaluation, 'executor', 48)
    addRole(evaluation, 'overwatcher', 34)
    evaluation.reasons.push('Strong, tool-capable and unusually cost-efficient cloud model.')
  }

  if (/deepseek-v4-flash/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 100)
    evaluation.quality += 16
    evaluation.speed += 38
    evaluation.costEfficiency += 35
    evaluation.coding += 12
    addRole(evaluation, 'scout', 58)
    addRole(evaluation, 'executor', 34)
    addRole(evaluation, 'orchestrator', 20)
    evaluation.reasons.push('Extremely economical fast agent worker.')
  }

  if (/deepseek-(chat|reasoner)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 75)
    addAllRoles(evaluation, -18)
    evaluation.reasons.push('Compatibility alias scheduled for retirement; prefer V4 IDs.')
  }
}

function applyLocalRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  evaluation.family = model.split(':')[0]
  evaluation.costEfficiency = 100

  if (/qwen3\.6:?(27b|35b)|qwen3\.6-(27b|35b)/.test(model)) {
    evaluation.confidence = 98
    evaluation.quality += 32
    evaluation.reasoning += 28
    evaluation.coding += 28
    evaluation.tools += 28
    addRole(evaluation, 'orchestrator', 42)
    addRole(evaluation, 'executor', 38)
    addRole(evaluation, 'overwatcher', 24)
  }

  if (/qwen3[-.]coder.*(30b|32b|next)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 98)
    evaluation.coding += 48
    evaluation.tools += 35
    evaluation.quality += 20
    addRole(evaluation, 'executor', 60)
    addRole(evaluation, 'orchestrator', 18)
  }

  if (/qwen3\.5:?(9b|8b)|qwen3\.5-(9b|8b)/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 96)
    evaluation.speed += 32
    evaluation.tools += 20
    addRole(evaluation, 'scout', 56)
  }

  if (/llama3\.3.*70b|llama-3\.3.*70b/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 92)
    evaluation.quality += 28
    evaluation.reasoning += 22
    evaluation.tools += 20
    addRole(evaluation, 'orchestrator', 34)
    addRole(evaluation, 'overwatcher', 24)
  }

  if (/deepseek-r1.*(32b|70b)|deepseek-v4/.test(model)) {
    evaluation.confidence = Math.max(evaluation.confidence, 90)
    evaluation.reasoning += 34
    evaluation.coding += 24
    addRole(evaluation, 'overwatcher', 34)
    addRole(evaluation, 'executor', 25)
  }

  if (/vision|\bvl\b/.test(model)) {
    evaluation.quality += 4
  }
}

function applyOpenRouterRules(evaluation: ModelEvaluation): void {
  const model = evaluation.model.toLowerCase()
  const slash = model.indexOf('/')
  const upstream = slash >= 0 ? model.slice(0, slash) : ''
  evaluation.family = upstream || 'openrouter'
  evaluation.confidence += slash >= 0 ? 8 : 0

  if (model.includes('deepseek')) applyDeepSeekRules(evaluation)
  else if (model.includes('claude')) applyAnthropicRules(evaluation)
  else if (model.includes('gemini')) applyGeminiRules(evaluation)
  else if (model.includes('gpt') || /\/o[134]/.test(model)) applyOpenAIRules(evaluation)

  addAllRoles(evaluation, -3)
  evaluation.reasons.push('OpenRouter route receives a small direct-provider preference penalty.')
}

export function evaluateModel(candidate: AutoSetupCandidate): ModelEvaluation {
  const evaluation = baseEvaluation(candidate)
  applyGenericRules(evaluation)
  if (evaluation.excluded) return evaluation

  if (candidate.provider === 'openai') applyOpenAIRules(evaluation)
  else if (candidate.provider === 'anthropic') applyAnthropicRules(evaluation)
  else if (candidate.provider === 'gemini') applyGeminiRules(evaluation)
  else if (candidate.provider === 'deepseek') applyDeepSeekRules(evaluation)
  else if (candidate.provider === 'openrouter') applyOpenRouterRules(evaluation)
  else if (candidate.provider === 'local') applyLocalRules(evaluation)
  else if (candidate.provider === 'opencode') {
    if (candidate.model.toLowerCase().includes('deepseek')) applyDeepSeekRules(evaluation)
    evaluation.costEfficiency += 12
  }

  for (const role of Object.keys(evaluation.roleScores) as AgentRoleId[]) {
    const roleFit =
      role === 'orchestrator'
        ? evaluation.quality * 0.34 +
          evaluation.reasoning * 0.25 +
          evaluation.tools * 0.22 +
          evaluation.costEfficiency * 0.19
        : role === 'executor'
          ? evaluation.coding * 0.36 +
            evaluation.tools * 0.3 +
            evaluation.quality * 0.18 +
            evaluation.costEfficiency * 0.16
          : role === 'scout'
            ? evaluation.speed * 0.35 +
              evaluation.costEfficiency * 0.35 +
              evaluation.tools * 0.15 +
              evaluation.quality * 0.15
            : evaluation.reasoning * 0.34 +
              evaluation.quality * 0.3 +
              evaluation.tools * 0.18 +
              evaluation.costEfficiency * 0.18
    evaluation.roleScores[role] += roleFit
  }

  return evaluation
}

export function compareForRole(role: AgentRoleId, left: ModelEvaluation, right: ModelEvaluation): number {
  return (
    right.roleScores[role] - left.roleScores[role] ||
    right.confidence - left.confidence ||
    right.costEfficiency - left.costEfficiency ||
    left.model.localeCompare(right.model)
  )
}
