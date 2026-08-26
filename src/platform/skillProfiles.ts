/**
 * Builds and normalizes skill-profile names from the active provider, model, and user
 * selection. These rules keep persisted skill directories stable even when model
 * identifiers contain unsuitable path characters.
 */

export interface SkillProfileSettings {
  ai_provider?: unknown
  ai_model?: unknown
  skills_auto_switch?: boolean
  skills_active_profile?: unknown
}

// Converts slugify into a stable filesystem-safe slug.
function slugify(value: unknown, fallback = 'default'): string {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

  return text || fallback
}

/**
 * Infers model family when the caller has not supplied an explicit value.
 */

export function inferModelFamily(modelName: unknown): string {
  const raw = String(modelName || '')
    .toLowerCase()
    .trim()
  const slashIdx = raw.indexOf('/')
  const m = slugify(slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw, 'model')

  if (m.includes('claude')) return 'claude'
  if (m.includes('nemotron')) return 'nemotron'
  if (m.includes('gpt-oss')) return 'gpt-oss'
  if (m.includes('gpt-4o')) return 'gpt4o'
  if (m.includes('gpt-4')) return 'gpt4'
  if (m.includes('gpt-3.5')) return 'gpt35'
  if (/\bo[134]\b/.test(m)) return 'openai-o'
  if (m.includes('gpt')) return 'gpt'
  if (m.includes('gemini-1.5')) return 'gemini15'
  if (m.includes('gemini-2')) return 'gemini2'
  if (m.includes('gemini')) return 'gemini'
  if (m.includes('llama-3') || m.includes('llama3')) return 'llama3'
  if (m.includes('llama')) return 'llama'
  if (m.includes('gemma-3') || m.includes('gemma3')) return 'gemma3'
  if (m.includes('gemma')) return 'gemma'
  if (m.includes('codestral')) return 'codestral'
  if (m.includes('mistral')) return 'mistral'
  if (m.includes('mixtral')) return 'mixtral'
  if (m.includes('phi-4') || m.includes('phi4')) return 'phi4'
  if (m.includes('phi-3') || m.includes('phi3')) return 'phi3'
  if (m.includes('phi')) return 'phi'
  if (m.includes('deepseek-r1')) return 'deepseek-r1'
  if (m.includes('deepseek-v4')) return 'deepseek-v4'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('qwen3.6') || m.includes('qwen3-6') || m.includes('qwen3.5') || m.includes('qwen3-5')) return 'qwen35'
  if (m.includes('qwen2.5') || m.includes('qwen2-5')) return 'qwen25'
  if (m.includes('qwen')) return 'qwen'
  if (m.includes('grok')) return 'grok'
  if (m.includes('command')) return 'cohere'
  return m.slice(0, 32) || 'model'
}

// Assembles skill profile from lower-level state so callers receive one consistent representation.
export function buildSkillProfile(provider: unknown, modelName: unknown): string {
  return `${slugify(provider, 'provider')}-${inferModelFamily(modelName)}`
}

// Converts skill profile name into the canonical representation expected by later code.
export function normalizeSkillProfileName(value: unknown, fallback = 'default-model'): string {
  return slugify(value, fallback)
}

// Selects or derives active skill profile from the available settings, input, and runtime context.
export function resolveActiveSkillProfile(settings: SkillProfileSettings = {}): string {
  const computed = buildSkillProfile(settings.ai_provider, settings.ai_model)
  if (settings.skills_auto_switch !== false) return computed
  const manual = normalizeSkillProfileName(settings.skills_active_profile || '', '')
  return manual || computed
}