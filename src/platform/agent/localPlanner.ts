/**
 * Lightweight task preflight. Workspace projects are classified deterministically so coding
 * starts immediately; a local planner model is reserved for genuinely ambiguous non-workspace
 * requests where a second inference can add useful routing information.
 */

import { callAIWithMeta } from '@/platform/aiService'
import { readAgentModels } from '@/platform/agent/agentIdentity'

export interface LocalPreflightPlan {
  taskType: string
  developmentTask: boolean
  workspaceMutationExpected: boolean
  verificationRequired: boolean
  successCriteria: string[]
  needsLocalFiles: boolean
  needsWebResearch: boolean
  localQueries: string[]
  webQueries: string[]
  preflightChecks: string[]
  verificationChecks: string[]
  steps: string[]
}

interface SettingsLike {
  agent_models?: unknown
  ai_local_url?: string
  agent_local_planning?: boolean
  agent_preflight_plan?: unknown
  agent_working_dir?: string
  [key: string]: unknown
}

const SOCIAL_TURN_PATTERN =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|cool|great|got it|sounds good|good (?:morning|afternoon|evening))[.!?\s]*$/i
const DEVELOPMENT_NOUN_PATTERN =
  /\b(code|codebase|repo|repository|project|app|application|website|webpage|page|component|function|class|module|api|endpoint|ui|interface|css|html|typescript|javascript|python|react|electron|backend|frontend|test|tests|bug|provider|agent|runtime|prompt|database|schema|build)\b/i
const MUTATION_VERB_PATTERN =
  /\b(build|create|implement|add|change|update|fix|repair|refactor|remove|delete|rename|rewrite|migrate|wire|integrate|debug|optimi[sz]e|improve|redesign|replace|convert|edit|write|make|style|move)\b/i
const READ_ONLY_DEVELOPMENT_PATTERN =
  /\b(review|audit|analy[sz]e|explain|inspect|investigate|trace|understand|find|locate|summari[sz]e|check)\b/i
const FILE_MUTATION_PATTERN = /\b(create|write|edit|update|change|rename|move|delete|remove|replace)\b[\s\S]{0,80}\b(file|folder|directory|document)\b/i
const WEB_RESEARCH_PATTERN =
  /\b(research|look up|search the web|browse|latest|current|today|recent|sources?|citations?|online)\b/i

const LOCAL_PREFLIGHT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskType: { type: 'string', enum: ['answer', 'research', 'code_change', 'file_task', 'other'] },
    developmentTask: { type: 'boolean' },
    workspaceMutationExpected: { type: 'boolean' },
    verificationRequired: { type: 'boolean' },
    successCriteria: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    needsLocalFiles: { type: 'boolean' },
    needsWebResearch: { type: 'boolean' },
  },
  required: [
    'taskType',
    'developmentTask',
    'workspaceMutationExpected',
    'verificationRequired',
    'successCriteria',
    'needsLocalFiles',
    'needsWebResearch',
  ],
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parsePlannerJson(value: string): Record<string, unknown> | null {
  const text = String(value || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit)
}

function normalizePreflightPlan(value: unknown): LocalPreflightPlan | null {
  if (!isRecord(value)) return null
  return {
    taskType: String(value.taskType || 'other'),
    developmentTask: value.developmentTask === true,
    workspaceMutationExpected: value.workspaceMutationExpected === true,
    verificationRequired: value.verificationRequired === true,
    successCriteria: normalizeStrings(value.successCriteria, 6),
    needsLocalFiles: value.needsLocalFiles === true,
    needsWebResearch: value.needsWebResearch === true,
    localQueries: normalizeStrings(value.localQueries, 4),
    webQueries: normalizeStrings(value.webQueries, 4),
    preflightChecks: normalizeStrings(value.preflightChecks, 4),
    verificationChecks: normalizeStrings(value.verificationChecks, 4),
    steps: normalizeStrings(value.steps, 6),
  }
}

function directPlan(
  taskType: string,
  developmentTask: boolean,
  workspaceMutationExpected: boolean,
  verificationRequired: boolean,
  needsLocalFiles: boolean,
  needsWebResearch: boolean,
): LocalPreflightPlan {
  return {
    taskType,
    developmentTask,
    workspaceMutationExpected,
    verificationRequired,
    successCriteria: [],
    needsLocalFiles,
    needsWebResearch,
    localQueries: [],
    webQueries: [],
    preflightChecks: [],
    verificationChecks: [],
    steps: [],
  }
}

/** Returns a deterministic contract whenever another inference would add more ceremony than value. */
export function inferDirectPreflightPlan(userInput: string, settings: SettingsLike = {}): LocalPreflightPlan | null {
  const text = String(userInput || '').trim()
  if (!text || SOCIAL_TURN_PATTERN.test(text)) return null

  const hasWorkspace = Boolean(String(settings.agent_working_dir || '').trim())
  const development = DEVELOPMENT_NOUN_PATTERN.test(text)
  const mutation = MUTATION_VERB_PATTERN.test(text)
  const readOnly = READ_ONLY_DEVELOPMENT_PATTERN.test(text)

  if ((development || hasWorkspace) && mutation) {
    return directPlan('code_change', true, true, true, hasWorkspace, false)
  }

  if ((development || hasWorkspace) && readOnly) {
    return directPlan('code_change', true, false, false, hasWorkspace, false)
  }

  if (FILE_MUTATION_PATTERN.test(text)) {
    return directPlan('file_task', false, true, true, hasWorkspace, false)
  }

  if (WEB_RESEARCH_PATTERN.test(text)) {
    return directPlan('research', false, false, false, false, true)
  }

  // Workspace ambiguity belongs to the main agent, which has the live files and tools needed
  // to resolve it. Do not pay for a separate model interpretation first.
  if (hasWorkspace) return directPlan('other', false, false, false, true, false)

  return null
}

export function shouldRunLocalPlanning(userInput: string, settings: SettingsLike = {}): boolean {
  const text = String(userInput || '').trim()
  if (!text || SOCIAL_TURN_PATTERN.test(text)) return false
  if (String(settings.agent_working_dir || '').trim()) return false
  return inferDirectPreflightPlan(text, settings) === null
}

export async function buildLocalPreflightPlan(
  userInput: string,
  conversation: Array<{ role?: string; content?: unknown }>,
  settings: SettingsLike,
  signal?: AbortSignal | null,
): Promise<LocalPreflightPlan | null> {
  const suppliedPlan = normalizePreflightPlan(settings?.agent_preflight_plan)
  if (suppliedPlan) return suppliedPlan

  const direct = inferDirectPreflightPlan(userInput, settings)
  if (direct) return direct
  if (!shouldRunLocalPlanning(userInput, settings) || settings?.agent_local_planning === false) return null

  const localModels = readAgentModels(settings).filter((entry) => entry.provider === 'local' && entry.model)
  const planner =
    localModels.find((entry) => entry.role === 'scout' && entry.primary) ||
    localModels.find((entry) => entry.role === 'orchestrator' && entry.primary) ||
    localModels.find((entry) => entry.role === 'scout') ||
    localModels[0]
  if (!planner) return null

  const recent = (Array.isArray(conversation) ? conversation : [])
    .slice(-2)
    .map((message) => `${message.role || 'user'}: ${String(message.content || '').slice(0, 400)}`)
    .join('\n')
  const prompt = [`Request:\n${userInput}`, recent ? `Context:\n${recent}` : ''].filter(Boolean).join('\n\n')

  const meta = await callAIWithMeta(
    [
      { role: 'system', content: 'Classify this task for execution.' },
      { role: 'user', content: prompt },
    ],
    {
      ...settings,
      ai_provider: 'local',
      ai_model: planner.model,
      ai_runtime_api_key: '',
      agent_max_output_tokens: 320,
    },
    {
      signal: signal || undefined,
      responseSchema: {
        name: 'task_preflight',
        schema: LOCAL_PREFLIGHT_RESPONSE_SCHEMA,
      },
    },
  )
  return normalizePreflightPlan(parsePlannerJson(String(meta?.text || '')))
}

export function formatLocalPreflightPlan(plan: LocalPreflightPlan | null): string {
  const normalized = normalizePreflightPlan(plan)
  if (!normalized) return ''

  const parts = [`Task: ${normalized.taskType}.`]
  if (normalized.workspaceMutationExpected) parts.push('Workspace change required.')
  if (normalized.verificationRequired) parts.push('Verify the result before finishing.')
  if (normalized.successCriteria.length) parts.push(`Done when: ${normalized.successCriteria.join(' | ')}.`)
  return parts.join(' ')
}
