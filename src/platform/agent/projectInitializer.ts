import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import {
  advanceProjectStrategy,
  ensureProjectLedger,
  replaceProjectRequirements,
  saveProjectLedger,
  upsertProjectWorkItems,
  type ProjectAgentRole,
  type ProjectLedger,
} from '@/platform/agent/projectLedger'

export interface ProjectInitializationResult {
  complex: boolean
  initialized: boolean
  ledger: ProjectLedger
  summary: string
}

const COMPLEX_PROJECT_PATTERN =
  /\b(full[- ]stack|platform|dashboard|application|app|website|system|authentication|authorization|billing|payments?|database|api|backend|frontend|admin|roles?|permissions?|migration|integration|multi[- ]page|production|complete project|entire project|from scratch)\b/i
const MULTI_REQUIREMENT_PATTERN = /\b(and|also|plus|as well as|then|including|with)\b/gi

const INITIALIZER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    architectureSummary: { type: 'string' },
    strategy: { type: 'string' },
    requirements: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        },
        required: ['id', 'text', 'acceptanceCriteria', 'dependsOn'],
      },
    },
    workItems: {
      type: 'array',
      maxItems: 120,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string', enum: ['orchestrator', 'planner', 'scout', 'executor', 'evaluator'] },
          requirementIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        },
        required: ['id', 'title', 'description', 'role', 'requirementIds', 'dependsOn'],
      },
    },
  },
  required: ['summary', 'architectureSummary', 'strategy', 'requirements', 'workItems'],
} as const

function parseJson(text: string): Record<string, any> | null {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, any>
  } catch {
    return null
  }
}

export function projectPromptLooksComplex(goal: string) {
  const text = String(goal || '').trim()
  if (!text) return false
  if (text.length >= 1200) return true
  const conjunctions = text.match(MULTI_REQUIREMENT_PATTERN)?.length || 0
  const bullets = text.split(/\n/).filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length
  const domains = Array.from(
    new Set(
      (text.match(new RegExp(COMPLEX_PROJECT_PATTERN.source, 'gi')) || []).map((item) => item.toLowerCase()),
    ),
  ).length
  return bullets >= 4 || domains >= 3 || (COMPLEX_PROJECT_PATTERN.test(text) && conjunctions >= 4)
}

function fallbackRequirements(goal: string) {
  const lines = String(goal || '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length >= 8)
    .slice(0, 30)
  const source = lines.length > 1 ? lines : [String(goal || '').trim()]
  return source.map((text, index) => ({
    id: `req-${index + 1}`,
    text,
    status: 'pending' as const,
    acceptanceCriteria: [],
    dependsOn: [],
  }))
}

export async function initializeProject(
  chatId: string,
  goal: string,
  settings: Record<string, any>,
  signal?: AbortSignal,
): Promise<ProjectInitializationResult> {
  let ledger = ensureProjectLedger(chatId, goal)
  if (ledger.requirements.length) {
    return { complex: projectPromptLooksComplex(goal), initialized: false, ledger, summary: 'Existing project ledger reused.' }
  }

  const complex = projectPromptLooksComplex(goal)
  if (!complex) {
    ledger = replaceProjectRequirements(chatId, goal, fallbackRequirements(goal))
    ledger = upsertProjectWorkItems(chatId, goal, [
      {
        id: 'work-main',
        title: 'Implement requested change',
        description: goal,
        role: 'executor',
        requirementIds: ledger.requirements.map((item) => item.id),
        dependsOn: [],
        status: 'ready',
      },
      {
        id: 'work-evaluate',
        title: 'Evaluate completed change',
        description: 'Verify requirements, diagnostics, tests, and runtime behavior where applicable.',
        role: 'evaluator',
        requirementIds: ledger.requirements.map((item) => item.id),
        dependsOn: ['work-main'],
        status: 'pending',
      },
    ])
    return { complex: false, initialized: true, ledger, summary: 'Initialized compact project ledger.' }
  }

  try {
    const response = await runBoundedRoleTask({
      settings,
      preferredRoles: ['orchestrator', 'scout'],
      maxAttempts: 2,
      maxOutputTokens: 2600,
      reasoningEffort: 'medium',
      signal,
      taskLabel: 'project initialization',
      responseSchema: { name: 'project_initialization', schema: INITIALIZER_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'Initialize a software project for autonomous execution. Convert the user goal into independently checkable requirements and a dependency-aware work graph. Do not invent product requirements. Use scout work for investigation, executor work for implementation, evaluator work for independent acceptance, and orchestrator work only for integration/decisions.',
        },
        { role: 'user', content: goal },
      ],
    })
    const parsed = parseJson(response.text)
    if (!parsed) throw new Error('Initializer returned no parseable project contract.')

    const requirements = Array.isArray(parsed.requirements) && parsed.requirements.length
      ? parsed.requirements.map((item: any, index: number) => ({
          id: String(item.id || `req-${index + 1}`),
          text: String(item.text || ''),
          status: 'pending' as const,
          acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [],
          dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
        }))
      : fallbackRequirements(goal)

    ledger = replaceProjectRequirements(chatId, goal, requirements)
    ledger = upsertProjectWorkItems(
      chatId,
      goal,
      (Array.isArray(parsed.workItems) ? parsed.workItems : []).map((item: any, index: number) => ({
        id: String(item.id || `work-${index + 1}`),
        title: String(item.title || `Work item ${index + 1}`),
        description: String(item.description || ''),
        role: (['orchestrator', 'planner', 'scout', 'executor', 'evaluator'].includes(String(item.role))
          ? item.role
          : 'executor') as ProjectAgentRole,
        requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds : [],
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
        status: Array.isArray(item.dependsOn) && item.dependsOn.length ? 'pending' : 'ready',
      })),
    )
    ledger.architectureSummary = String(parsed.architectureSummary || '').slice(0, 12_000)
    ledger = saveProjectLedger(chatId, ledger)
    ledger = advanceProjectStrategy(chatId, goal, String(parsed.strategy || parsed.summary || 'Execute initialized project plan.'))

    return {
      complex: true,
      initialized: true,
      ledger,
      summary: String(parsed.summary || 'Initialized complex project requirements and work graph.'),
    }
  } catch (error) {
    ledger = replaceProjectRequirements(chatId, goal, fallbackRequirements(goal))
    ledger = upsertProjectWorkItems(chatId, goal, [
      {
        id: 'work-discovery',
        title: 'Inspect project and derive implementation plan',
        description: goal,
        role: 'scout',
        requirementIds: ledger.requirements.map((item) => item.id),
        dependsOn: [],
        status: 'ready',
      },
      {
        id: 'work-main',
        title: 'Implement project requirements',
        description: goal,
        role: 'executor',
        requirementIds: ledger.requirements.map((item) => item.id),
        dependsOn: ['work-discovery'],
        status: 'pending',
      },
      {
        id: 'work-evaluate',
        title: 'Evaluate project requirements',
        description: 'Independently verify implemented requirements and report concrete findings.',
        role: 'evaluator',
        requirementIds: ledger.requirements.map((item) => item.id),
        dependsOn: ['work-main'],
        status: 'pending',
      },
    ])
    return {
      complex: true,
      initialized: true,
      ledger,
      summary: `Initialized fallback project ledger after planner failure: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
