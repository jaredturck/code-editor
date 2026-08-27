/**
 * Structured Task Protocol (STP) v1.0
 *
 * Builds machine-readable task contracts for inter-agent delegation.
 * Sub-agents receive STP objects instead of prose — removing ambiguity,
 * cutting token overhead ~50-60%, and enforcing predictable output schemas.
 *
 * Token budget comparison (approx):
 *   Prose task description + model interpretation  400–800 tokens
 *   STP task object + generated system prompt      630–800 tokens
 *   Full tool specs for every step               1200–1500 tokens
 *   STP with dynamic tool injection only           350–450 tokens
 *
 * Usage:
 *   const stp = buildSTP({ type: 'discover', goal: '...', ... });
 *   const id  = stp.taskId;  // uuid for recall/status polling
 */

export type STPTaskType = 'execute' | 'discover' | 'summarize' | 'verify' | 'compile'
export type STPPriority = 'high' | 'normal' | 'low'

export interface STPAgentIdentity {
  role: string
  provider: string
  model: string
  /** Which provider key slot the member uses (for health tracking + failover). */
  keyId?: string
}

export interface STPStepInput extends Record<string, unknown> {
  order?: number
  action?: string
  args?: Record<string, unknown>
  onEmpty?: string
  onError?: string
}

export interface STPStep {
  order: number
  action: string
  args: Record<string, unknown>
  onEmpty: string
  onError: string
}

export interface STPBuildInput {
  type?: unknown
  goal?: unknown
  scope?: unknown
  constraints?: unknown
  tools?: {
    /** Omit available for tier defaults; pass [] to explicitly grant no tools. */
    available?: unknown
    preferred?: unknown
    forbidden?: unknown
  } | null
  skills?: {
    load?: unknown
    variant?: unknown
  } | null
  steps?: unknown
  outputSchema?: unknown
  budget?: {
    maxSteps?: unknown
    maxTokens?: unknown
    timeoutMs?: unknown
    maxOutputChars?: unknown
  } | null
  context?: unknown
  priority?: unknown
  toAgent?: unknown
  agentIdentity?: unknown
}

export interface STPTask {
  stp: string
  taskId: string
  type: STPTaskType
  priority: STPPriority
  toAgent: string
  agentIdentity?: STPAgentIdentity
  createdAt: number
  objective: {
    goal: string
    scope: string
    constraints: string[]
  }
  tools: {
    mode: 'auto' | 'explicit'
    available: string[]
    preferred: string[]
    forbidden: string[]
  }
  skills: {
    load: string[]
    variant: 'simple' | 'default'
  }
  steps: STPStep[]
  output: {
    schema: Record<string, unknown>
    maxChars: number
    format: 'json'
  }
  budget: {
    maxSteps: number
    maxTokens: number
    timeoutMs: number
  }
  context: Record<string, unknown>
  onComplete: {
    notifyAgent: string
    summarizeResult: boolean
  }
}

interface STPSystemPromptOptions {
  native?: boolean
}

const STP_VERSION = '1.0'
const DEFAULT_MAX_STEPS = 12
const DEFAULT_MAX_TOKENS = 8000
const DEFAULT_TIMEOUT_MS = 45000
const DEFAULT_MAX_OUTPUT_CHARS = 6000

function generateTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const hex = (n: number) =>
    Math.floor(Math.random() * n)
      .toString(16)
      .padStart(2, '0')
  return [
    Array.from({ length: 4 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 6 }, () => hex(256)).join(''),
  ].join('-')
}

function normalizeStringArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeConstraints(value: unknown): string[] {
  return normalizeStringArray(value, 16)
}

function normalizeSteps(value: unknown): STPStep[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((step): step is STPStepInput => (step && typeof step === 'object') as boolean)
    .map((step, index) => ({
      order: Number.isFinite(Number(step.order)) ? Number(step.order) : index + 1,
      action: String(step.action || '').trim(),
      args: step.args && typeof step.args === 'object' ? step.args : {},
      onEmpty: String(step.onEmpty || '').trim(),
      onError: String(step.onError || '').trim(),
    }))
    .slice(0, 24)
}

function normalizePriority(value: unknown): STPPriority {
  const p = String(value || 'normal').toLowerCase()
  if (p === 'high' || p === 'low') return p
  return 'normal'
}

function normalizeType(value: unknown): STPTaskType {
  const valid = new Set<STPTaskType>(['execute', 'discover', 'summarize', 'verify', 'compile'])
  const t = String(value || 'execute').toLowerCase()
  return valid.has(t as STPTaskType) ? (t as STPTaskType) : 'execute'
}

function normalizeAgentIdentity(value: unknown): STPAgentIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const role = String((value as Record<string, unknown>).role || '').trim()
  const provider = String((value as Record<string, unknown>).provider || '').trim()
  const model = String((value as Record<string, unknown>).model || '').trim()
  if (!role && !provider && !model) return null

  const keyId = String((value as Record<string, unknown>).keyId || '').trim()
  return keyId ? { role, provider, model, keyId } : { role, provider, model }
}

export function buildSTP({
  type,
  goal,
  scope,
  constraints,
  tools,
  skills,
  steps,
  outputSchema,
  budget,
  context,
  priority,
  toAgent,
  agentIdentity,
}: STPBuildInput = {}): STPTask {
  const taskId = generateTaskId()
  const normalizedAgentIdentity = normalizeAgentIdentity(agentIdentity)

  return {
    stp: STP_VERSION,
    taskId,
    type: normalizeType(type),
    priority: normalizePriority(priority),
    toAgent: String(toAgent || 'deepseek').trim(),
    ...(normalizedAgentIdentity ? { agentIdentity: normalizedAgentIdentity } : {}),
    createdAt: Date.now(),

    objective: {
      goal: String(goal || '').trim(),
      scope: String(scope || '').trim(),
      constraints: normalizeConstraints(constraints),
    },

    tools: {
      mode: tools && Object.prototype.hasOwnProperty.call(tools, 'available') ? 'explicit' : 'auto',
      available: normalizeStringArray(tools?.available, 32),
      preferred: normalizeStringArray(tools?.preferred, 16),
      forbidden: normalizeStringArray(tools?.forbidden, 16),
    },

    skills: {
      load: normalizeStringArray(skills?.load, 12),
      variant: String(skills?.variant || 'default').trim() === 'simple' ? 'simple' : 'default',
    },

    steps: normalizeSteps(steps),

    output: {
      schema: outputSchema && typeof outputSchema === 'object' ? (outputSchema as Record<string, unknown>) : {},
      maxChars: Number.isFinite(Number(budget?.maxOutputChars))
        ? Math.max(200, Math.min(24000, Number(budget!.maxOutputChars)))
        : DEFAULT_MAX_OUTPUT_CHARS,
      format: 'json',
    },

    budget: {
      maxSteps: Number.isFinite(Number(budget?.maxSteps))
        ? Math.max(1, Math.min(40, Number(budget!.maxSteps)))
        : DEFAULT_MAX_STEPS,
      maxTokens: Number.isFinite(Number(budget?.maxTokens))
        ? Math.max(500, Math.min(64000, Number(budget!.maxTokens)))
        : DEFAULT_MAX_TOKENS,
      timeoutMs: Number.isFinite(Number(budget?.timeoutMs))
        ? Math.max(5000, Math.min(300000, Number(budget!.timeoutMs)))
        : DEFAULT_TIMEOUT_MS,
    },

    context: context && typeof context === 'object' ? (context as Record<string, unknown>) : {},

    onComplete: {
      notifyAgent: 'claude',
      summarizeResult: true,
    },
  }
}

export function buildSTPSystemPrompt(
  stp: STPTask,
  injectedSkillInstructions: string[] = [],
  options: STPSystemPromptOptions = {},
) {
  const lines = [`Task: ${stp.objective.goal}`]

  if (stp.objective.scope) lines.push(`Scope: ${stp.objective.scope}`)
  if (stp.objective.constraints.length) {
    lines.push(`Constraints: ${stp.objective.constraints.slice(0, 6).join(' | ')}`)
  }

  if (stp.context && Object.keys(stp.context).length > 0) {
    lines.push(`Context: ${JSON.stringify(stp.context).slice(0, 6000)}`)
  }

  if (injectedSkillInstructions.length > 0) {
    lines.push(`Skills:\n${injectedSkillInstructions.join('\n\n')}`)
  }

  if (!options.native && stp.tools.available.length > 0) {
    lines.push(`Tools: ${stp.tools.available.join(', ')}`)
    if (stp.tools.forbidden.length > 0) lines.push(`Do not use: ${stp.tools.forbidden.join(', ')}`)
  }

  if (Object.keys(stp.output.schema).length > 0) {
    lines.push(`Final result schema: ${JSON.stringify(stp.output.schema)}`)
  }

  if (options.native) {
    lines.push('Use the available tools when they help. Return the final result when the task is complete.')
  } else {
    lines.push('For a tool action, return a JSON object with tool and args. Otherwise return the final JSON result.')
  }

  return lines.join('\n\n')
}

export function validateSTPResult(result: unknown, schema: Record<string, unknown> | null | undefined) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return { valid: true, missing: [] }
  }

  if (!result || typeof result !== 'object') {
    return { valid: false, missing: Object.keys(schema) }
  }

  const missing = Object.keys(schema).filter((key) => !(key in (result as Record<string, unknown>)))

  return { valid: missing.length === 0, missing }
}

export function summariseSTP(stp: STPTask) {
  const typeLabel = String(stp.type || 'execute')
  const goal = String(stp.objective?.goal || '').slice(0, 120)
  const stepCount = Array.isArray(stp.steps) ? stp.steps.length : 0
  const agentLabel = String(stp.toAgent || 'unknown')
  const stepsLabel = stepCount > 0 ? ` (${stepCount} explicit steps)` : ' (autonomous)'
  return `[STP ${typeLabel} → ${agentLabel}]${stepsLabel}: ${goal}`
}
