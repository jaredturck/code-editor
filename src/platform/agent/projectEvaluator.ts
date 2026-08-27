import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import { collectProjectEvaluationEvidence } from '@/platform/agent/projectEvaluationHarness'
import {
  addEvaluatorFindings,
  loadProjectLedger,
  mutateProjectLedger,
  projectLedgerComplete,
  upsertProjectRequirements,
  upsertProjectWorkItems,
  type ProjectEvaluatorFinding,
  type ProjectLedger,
} from '@/platform/agent/projectLedger'

export interface ProjectEvaluationEvidence {
  diagnostics?: unknown
  verification?: unknown
  diff?: string
  runtime?: unknown
  notes?: string[]
}

export interface ProjectEvaluationResult {
  accepted: boolean
  summary: string
  findings: ProjectEvaluatorFinding[]
  requirementStatus: Array<{ id: string; status: 'verified' | 'implemented' | 'blocked' | 'pending'; evidence: string[] }>
  ledger: ProjectLedger
}

const EVALUATOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accepted: { type: 'boolean' },
    summary: { type: 'string' },
    requirements: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['verified', 'implemented', 'blocked', 'pending'] },
          evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        },
        required: ['id', 'status', 'evidence'],
      },
    },
    missingRequirements: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          evidence: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        },
        required: ['text', 'acceptanceCriteria', 'evidence'],
      },
    },
    findings: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirementId: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning', 'error'] },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        },
        required: ['requirementId', 'severity', 'summary', 'evidence'],
      },
    },
  },
  required: ['accepted', 'summary', 'requirements', 'missingRequirements', 'findings'],
} as const

function parseJson(value: string): Record<string, any> | null {
  const raw = String(value || '').trim()
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

function compactLedger(ledger: ProjectLedger) {
  return {
    goal: ledger.goal,
    generation: ledger.generation,
    strategyGeneration: ledger.strategyGeneration,
    requirements: ledger.requirements.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptanceCriteria,
      evidence: requirement.evidence.slice(-8),
    })),
    workItems: ledger.workItems.slice(-100).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      role: item.role,
      requirementIds: item.requirementIds,
      attempts: item.attempts,
      resultSummary: item.resultSummary,
      blockers: item.blockers,
    })),
    openFindings: ledger.evaluatorFindings.filter((finding) => finding.status === 'open').slice(-60),
    architectureSummary: ledger.architectureSummary,
    currentStrategy: ledger.currentStrategy,
    lastProgressSummary: ledger.lastProgressSummary,
  }
}

function normalizedRequirementText(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function materializeMissingRequirements(chatId: string, ledger: ProjectLedger, parsed: Record<string, any>) {
  const existing = new Set(ledger.requirements.map((item) => normalizedRequirementText(item.text)))
  const missing = (Array.isArray(parsed.missingRequirements) ? parsed.missingRequirements : [])
    .filter((item: any) => {
      const text = normalizedRequirementText(item?.text)
      return text && !existing.has(text)
    })
    .slice(0, 20)

  if (!missing.length) return ledger
  const stamp = Date.now().toString(36)
  const requirements = missing.map((item: any, index: number) => ({
    id: `eval-req-${stamp}-${index + 1}`,
    text: String(item.text || '').slice(0, 5000),
    status: 'pending' as const,
    acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.map(String).slice(0, 10) : [],
    dependsOn: [],
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String).slice(0, 10) : [],
    notes: ['Recovered by independent evaluator from the original project goal.'],
  }))
  let updated = upsertProjectRequirements(chatId, ledger.goal, requirements)
  updated = upsertProjectWorkItems(
    chatId,
    ledger.goal,
    requirements.flatMap((requirement, index) => [
      {
        id: `eval-missing-implement-${stamp}-${index + 1}`,
        title: `Implement recovered requirement: ${requirement.text.slice(0, 140)}`,
        description: requirement.text,
        role: 'executor' as const,
        requirementIds: [requirement.id],
        dependsOn: [],
        status: 'ready' as const,
      },
      {
        id: `eval-missing-verify-${stamp}-${index + 1}`,
        title: `Verify recovered requirement: ${requirement.text.slice(0, 140)}`,
        description: `Independently verify this recovered requirement against its acceptance criteria: ${requirement.acceptanceCriteria.join('; ')}`,
        role: 'evaluator' as const,
        requirementIds: [requirement.id],
        dependsOn: [`eval-missing-implement-${stamp}-${index + 1}`],
        status: 'pending' as const,
      },
    ]),
  )
  return updated
}

export async function evaluateProject(
  chatId: string,
  settings: Record<string, any>,
  evidence: ProjectEvaluationEvidence = {},
  signal?: AbortSignal,
): Promise<ProjectEvaluationResult> {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) throw new Error('Project evaluator requires a durable project ledger.')

  const freshEvidence = await collectProjectEvaluationEvidence(chatId, ledger, settings, evidence as Record<string, unknown>)

  const result = await runBoundedRoleTask({
    settings,
    preferredRoles: ['overwatcher', 'orchestrator'],
    maxAttempts: 2,
    maxOutputTokens: 3600,
    reasoningEffort: 'medium',
    signal,
    taskLabel: 'independent project evaluation',
    responseSchema: { name: 'project_evaluation', schema: EVALUATOR_SCHEMA },
    messages: [
      {
        role: 'system',
        content:
          'Act as an independent software evaluator. Do not trust implementation claims. Judge each recorded requirement against the current project plus deterministic evidence. Verification failures, severity=error diagnostics, broken runtime/browser behavior, or unmet acceptance criteria prevent verified status. Also compare the requirement ledger against the ORIGINAL goal: if a material requirement clearly stated or necessarily implied by that goal is absent from the ledger, return it in missingRequirements. Do not invent enhancements or preferences. Do not mutate code.',
      },
      {
        role: 'user',
        content: JSON.stringify({ project: compactLedger(ledger), evidence: freshEvidence }, null, 2).slice(0, 90_000),
      },
    ],
  })

  const parsed = parseJson(result.text)
  if (!parsed) throw new Error('Evaluator returned no parseable verdict.')

  const statuses = (Array.isArray(parsed.requirements) ? parsed.requirements : []).map((item: any) => ({
    id: String(item.id || ''),
    status: ['verified', 'implemented', 'blocked'].includes(String(item.status)) ? item.status : 'pending',
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String).slice(0, 12) : [],
  })) as ProjectEvaluationResult['requirementStatus']

  const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).map((item: any, index: number) => ({
    id: `eval-${Date.now().toString(36)}-${index}`,
    requirementId: String(item.requirementId || ''),
    severity: item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
    status: 'open' as const,
    summary: String(item.summary || '').slice(0, 4000),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String).slice(0, 12) : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }))

  let updated = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const statusById = new Map(statuses.map((item) => [item.id, item]))
    draft.requirements = draft.requirements.map((requirement) => {
      const verdict = statusById.get(requirement.id)
      if (!verdict) return requirement
      return {
        ...requirement,
        status: verdict.status,
        evidence: Array.from(new Set([...requirement.evidence, ...verdict.evidence])).slice(-60),
        updatedAt: Date.now(),
      }
    })
    draft.evaluatorFindings = draft.evaluatorFindings.map((finding) => {
      const requirement = draft.requirements.find((item) => item.id === finding.requirementId)
      if (requirement?.status === 'verified') return { ...finding, status: 'resolved', updatedAt: Date.now() }
      return finding
    })
    draft.lastProgressAt = Date.now()
    draft.lastProgressSummary = String(parsed.summary || 'Independent evaluation completed.').slice(0, 5000)
  })

  if (findings.length) updated = addEvaluatorFindings(chatId, updated.goal, findings)
  updated = materializeMissingRequirements(chatId, updated, parsed)

  const deterministicAccepted = projectLedgerComplete(updated)
  const accepted = parsed.accepted === true && deterministicAccepted
  return {
    accepted,
    summary: String(parsed.summary || '').slice(0, 5000),
    findings,
    requirementStatus: statuses,
    ledger: updated,
  }
}
