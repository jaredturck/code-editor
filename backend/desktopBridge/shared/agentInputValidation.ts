/**
 * Validates and bounds data entering the multi-agent and training APIs before it reaches
 * queues or persistent state. It normalizes supported roles and capabilities while
 * rejecting malformed identifiers, oversized payloads, and unsupported task shapes.
 */

const AGENT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const TASK_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/
const CAPABILITY_REGEX = /^[a-z][a-z0-9_-]{0,31}(?:\.[a-z][a-z0-9_-]{0,31})?$/

const ALLOWED_AGENT_ROLES = new Set([
  'orchestrator',
  'executor',
  'scout',
  'claude',
  'deepseek',
  'local',
  'openai',
  'gemini',
  'unknown',
])

const ALLOWED_CAPABILITY_NAMESPACES = new Set([
  'agent',
  'apps',
  'artifacts',
  'clipboard',
  'files',
  'memory',
  'notes',
  'power',
  'screen',
  'search',
  'skills',
  'sources',
  'system',
  'terminal',
  'todo',
  'trace',
  'training',
  'web',
])

const TASK_STATUSES = new Set(['pending', 'running', 'done', 'failed', 'timeout', 'partial'])
const RESPONSE_TYPES = new Set(['thinking', 'reply', 'skill_saved'])
const TASK_PRIORITIES = new Set(['low', 'normal', 'high'])

export const INPUT_LIMITS = Object.freeze({
  agentIdChars: 64,
  taskIdChars: 80,
  capabilityCount: 64,
  capabilityChars: 64,
  taskGoalChars: 20000,
  taskScopeChars: 4000,
  taskConstraintCount: 40,
  taskConstraintChars: 1000,
  taskToolCount: 80,
  taskContextBytes: 64 * 1024,
  taskOutputBytes: 64 * 1024,
  taskResultBytes: 256 * 1024,
  broadcastChars: 8000,
  trainingMessageChars: 64000,
  skillBytes: 128 * 1024,
})

export class InputValidationError extends Error {
  statusCode: number

  // Initializes the instance state required by input validation error.
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'InputValidationError'
    this.statusCode = statusCode
  }
}

// Evaluates whether is plain object for the supplied value and current runtime state.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Measures the UTF-8 byte size of a JSON value before accepting it into bridge state.
function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
  } catch {
    throw new InputValidationError('Input must be JSON serializable')
  }
}

// Rejects agent input whose serialized JSON exceeds the limit for that field.
function assertJsonSize(value: unknown, maxBytes: number, label: string): void {
  if (jsonByteLength(value) > maxBytes) {
    throw new InputValidationError(`${label} exceeds the ${maxBytes}-byte limit`)
  }
}

// Bounds string before it is retained or returned.
function boundedString(value: unknown, label: string, maxChars: number, required = false): string {
  const text = String(value ?? '').trim()
  if (required && !text) throw new InputValidationError(`${label} is required`)
  if (text.length > maxChars) {
    throw new InputValidationError(`${label} exceeds the ${maxChars}-character limit`)
  }
  return text
}

// Bounds string array before it is retained or returned.
function boundedStringArray(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new InputValidationError(`${label} must be an array`)
  if (value.length > maxItems) {
    throw new InputValidationError(`${label} exceeds the ${maxItems}-item limit`)
  }
  return value.map((item, index) => boundedString(item, `${label}[${index}]`, maxChars, true))
}

// Checks agent id at the boundary and returns or produces the accepted form.
export function validateAgentId(value: unknown, label = 'agentId'): string {
  const agentId = boundedString(value, label, INPUT_LIMITS.agentIdChars, true)
  if (!AGENT_ID_REGEX.test(agentId)) {
    throw new InputValidationError(`${label} contains unsupported characters`)
  }
  return agentId
}

// Checks agent role at the boundary and returns or produces the accepted form.
export function validateAgentRole(value: unknown, fallback = 'executor'): string {
  const role =
    String(value ?? fallback)
      .trim()
      .toLowerCase() || fallback
  if (!ALLOWED_AGENT_ROLES.has(role)) {
    throw new InputValidationError(`Unknown agent role: ${role}`)
  }
  return role
}

// Checks task id at the boundary and returns or produces the accepted form.
export function validateTaskId(value: unknown, label = 'taskId'): string {
  const taskId = boundedString(value, label, INPUT_LIMITS.taskIdChars, true)
  if (!TASK_ID_REGEX.test(taskId)) {
    throw new InputValidationError(`${label} contains unsupported characters`)
  }
  return taskId
}

// Checks capabilities at the boundary and returns or produces the accepted form.
export function validateCapabilities(value: unknown): string[] {
  const capabilities = boundedStringArray(
    value,
    'capabilities',
    INPUT_LIMITS.capabilityCount,
    INPUT_LIMITS.capabilityChars,
  )

  return capabilities.map((capability) => {
    const normalized = capability.toLowerCase()
    const namespace = normalized.split('.')[0]
    if (!CAPABILITY_REGEX.test(normalized) || !ALLOWED_CAPABILITY_NAMESPACES.has(namespace)) {
      throw new InputValidationError(`Unsupported capability: ${capability}`)
    }
    return normalized
  })
}

// Checks tool list at the boundary and returns or produces the accepted form.
function validateToolList(value: unknown, label: string): string[] {
  const tools = boundedStringArray(value, label, INPUT_LIMITS.taskToolCount, INPUT_LIMITS.capabilityChars)
  for (const tool of tools) {
    if (!CAPABILITY_REGEX.test(tool.toLowerCase())) {
      throw new InputValidationError(`${label} contains an invalid tool name: ${tool}`)
    }
  }
  return tools
}

/**
 * Validates a delegated task as a complete Structured Task Protocol object before it enters
 * an agent queue. It bounds objectives, scope, tools, steps, budgets, context, and
 * identifiers so malformed or oversized tasks cannot amplify into uncontrolled local work.
 */

export function validateStpTask(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new InputValidationError('STP task must be an object')
  assertJsonSize(value, INPUT_LIMITS.taskOutputBytes * 4, 'STP task')

  const taskId = validateTaskId(value.taskId)
  const toAgent = validateAgentRole(value.toAgent, 'executor')
  const objective = isPlainObject(value.objective) ? value.objective : {}
  const constraints = boundedStringArray(
    objective.constraints ?? value.constraints,
    'objective.constraints',
    INPUT_LIMITS.taskConstraintCount,
    INPUT_LIMITS.taskConstraintChars,
  )
  const goal = boundedString(
    objective.goal ?? value.goal ?? value.instructions,
    'objective.goal',
    INPUT_LIMITS.taskGoalChars,
    true,
  )
  const scope = boundedString(objective.scope ?? value.scope, 'objective.scope', INPUT_LIMITS.taskScopeChars)

  const tools = isPlainObject(value.tools) ? value.tools : {}
  const context = value.context === undefined ? {} : value.context
  const output = value.output === undefined ? {} : value.output
  const budget = value.budget === undefined ? {} : value.budget
  const skills = value.skills === undefined ? {} : value.skills
  const agentIdentity = value.agentIdentity === undefined ? null : value.agentIdentity
  if (!isPlainObject(context)) throw new InputValidationError('context must be an object')
  if (!isPlainObject(output)) throw new InputValidationError('output must be an object')
  if (!isPlainObject(budget)) throw new InputValidationError('budget must be an object')
  if (!isPlainObject(skills)) throw new InputValidationError('skills must be an object')
  if (agentIdentity !== null && !isPlainObject(agentIdentity)) {
    throw new InputValidationError('agentIdentity must be an object')
  }
  assertJsonSize(context, INPUT_LIMITS.taskContextBytes, 'context')
  assertJsonSize(output, INPUT_LIMITS.taskOutputBytes, 'output')

  const steps = value.steps === undefined ? [] : value.steps
  if (!Array.isArray(steps)) throw new InputValidationError('steps must be an array')
  if (steps.length > 40) throw new InputValidationError('steps exceeds the 40-item limit')
  for (const [index, step] of steps.entries()) {
    if (!isPlainObject(step)) throw new InputValidationError(`steps[${index}] must be an object`)
    boundedString(step.action, `steps[${index}].action`, 120, true)
    assertJsonSize(step.args ?? {}, 16 * 1024, `steps[${index}].args`)
  }

  const priority =
    String(value.priority ?? 'normal')
      .trim()
      .toLowerCase() || 'normal'
  if (!TASK_PRIORITIES.has(priority)) throw new InputValidationError(`Invalid priority: ${priority}`)

  const normalizedAgentIdentity = agentIdentity
    ? {
        ...agentIdentity,
        role: validateAgentRole(agentIdentity.role, toAgent),
        provider: boundedString(agentIdentity.provider, 'agentIdentity.provider', 80),
        model: boundedString(agentIdentity.model, 'agentIdentity.model', 160),
      }
    : undefined

  return {
    ...value,
    taskId,
    toAgent,
    type: boundedString(value.type ?? 'execute', 'type', 40, true),
    priority,
    objective: {
      ...objective,
      goal,
      scope,
      constraints,
    },
    tools: {
      ...tools,
      available: validateToolList(tools.available, 'tools.available'),
      preferred: validateToolList(tools.preferred, 'tools.preferred'),
      forbidden: validateToolList(tools.forbidden, 'tools.forbidden'),
    },
    skills: {
      ...skills,
      load: boundedStringArray(skills.load, 'skills.load', 12, 120),
      variant: boundedString(skills.variant ?? 'default', 'skills.variant', 32, true),
    },
    steps,
    output,
    budget: {
      ...budget,
      maxSteps: Math.max(1, Math.min(40, Number(budget.maxSteps) || 12)),
      maxTokens: Math.max(500, Math.min(64000, Number(budget.maxTokens) || 8000)),
      timeoutMs: Math.max(5000, Math.min(300000, Number(budget.timeoutMs) || 45000)),
    },
    context,
    ...(normalizedAgentIdentity ? { agentIdentity: normalizedAgentIdentity } : {}),
  }
}

/**
 * Checks task result at the boundary and returns or produces the accepted form.
 */

export function validateTaskResult(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new InputValidationError('Task result must be an object')
  assertJsonSize(value, INPUT_LIMITS.taskResultBytes, 'Task result')

  const status =
    String(value.status ?? 'done')
      .trim()
      .toLowerCase() || 'done'
  if (!TASK_STATUSES.has(status)) throw new InputValidationError(`Invalid task status: ${status}`)

  return {
    ...value,
    taskId: validateTaskId(value.taskId),
    agentId: value.agentId ? validateAgentId(value.agentId) : '',
    status,
    toolsUsed: validateToolList(value.toolsUsed, 'toolsUsed'),
    stepsUsed: Math.max(0, Math.min(1000, Number(value.stepsUsed) || 0)),
    tokensUsed: Math.max(0, Math.min(100000000, Number(value.tokensUsed) || 0)),
    satisfactionHint: boundedString(value.satisfactionHint, 'satisfactionHint', 4000),
    durationMs: Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(value.durationMs) || 0)),
  }
}

// Checks broadcast input at the boundary and returns or produces the accepted form.
export function validateBroadcastInput(value: unknown): {
  message: string
  contextUpdate: Record<string, unknown>
} {
  if (!isPlainObject(value)) throw new InputValidationError('Broadcast body must be an object')
  const message = boundedString(value.message, 'message', INPUT_LIMITS.broadcastChars, true)
  const contextUpdate = value.contextUpdate === undefined ? {} : value.contextUpdate
  if (!isPlainObject(contextUpdate)) {
    throw new InputValidationError('contextUpdate must be an object')
  }
  assertJsonSize(contextUpdate, INPUT_LIMITS.taskContextBytes, 'contextUpdate')
  return { message, contextUpdate }
}

// Checks training message at the boundary and returns or produces the accepted form.
export function validateTrainingMessage(value: unknown): string {
  return boundedString(value, 'content', INPUT_LIMITS.trainingMessageChars, true)
}

// Checks training response type at the boundary and returns or produces the accepted form.
export function validateTrainingResponseType(value: unknown): string {
  const type =
    String(value ?? 'reply')
      .trim()
      .toLowerCase() || 'reply'
  if (!RESPONSE_TYPES.has(type)) throw new InputValidationError(`Invalid response type: ${type}`)
  return type
}

// Checks skill input at the boundary and returns or produces the accepted form.
export function validateSkillInput(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new InputValidationError('Skill must be an object')
  assertJsonSize(value, INPUT_LIMITS.skillBytes, 'Skill')
  const id = boundedString(value.id ?? value.title, 'skill.id', 80, true)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  if (!id) throw new InputValidationError('skill.id is required')

  return {
    ...value,
    id,
    title: boundedString(value.title ?? id, 'skill.title', 120, true),
    summary: boundedString(value.summary, 'skill.summary', 500),
    instructions: boundedString(value.instructions, 'skill.instructions', 24000),
  }
}

// Checks proposal id at the boundary and returns or produces the accepted form.
export function validateProposalId(value: unknown): string {
  return validateTaskId(value, 'proposalId')
}

// Builds the stable bridge response returned for invalid agent input.
export function inputErrorResponse(error: unknown): { statusCode: number; message: string } {
  if (error instanceof InputValidationError) {
    return { statusCode: error.statusCode, message: error.message }
  }
  return { statusCode: 500, message: error instanceof Error ? error.message : 'Internal error' }
}
