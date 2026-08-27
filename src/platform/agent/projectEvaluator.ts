import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import { collectProjectEvaluationEvidence } from '@/platform/agent/projectEvaluationHarness'
import {
  addEvaluatorFindings,
  loadProjectLedger,
  mutateProjectLedger,
  projectLedgerComplete,
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
  required: ['accepted', 'summary', 'requirements', 'findings'],
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

export async function evaluateProject(
  chatId: string,
  settings: Record<string, any>,
  evidence: ProjectEvaluationEvidence = {},
  signal?: AbortSignal,
): Promise<ProjectEvaluationResult> {
  const ledger = loadProjectLedger(chatId)
  if (!ledger) throw new Error('Project evaluator requires a durable project ledger.')

  // Fresh deterministic evidence is gathered independently of executor summaries. This is the
  // evaluator's factual substrate: integrated diff/status, diagnostics, inferred build/test/lint
  // verification, managed runtime state, and browser evidence where applicable.
  const freshEvidence = await collectProjectEvaluationEvidence(chatId, ledger, settings, evidence as Record<string, unknown>)

  const result = await runBoundedRoleTask({
    settings,
    // The settings UI still exposes "overwatcher". The autonomous coding harness treats that
    // binding as the independent evaluator until the GUI/settings vocabulary is migrated later.
    preferredRoles: ['overwatcher', 'orchestrator'],
    maxAttempts: 2,
    maxOutputTokens: 3200,
    reasoningEffort: 'medium',
    signal,
    taskLabel: 'independent project evaluation',
    responseSchema: { name: 'project_evaluation', schema: EVALUATOR_SCHEMA },
    messages: [
      {
        role: 'system',
        content:
          'Act as an independent software evaluator. Do not trust implementation claims. Judge each requirement against the current project plus supplied deterministic evidence. Verification failures, severity=error diagnostics, broken runtime/browser behavior, or unmet acceptance criteria prevent verified status. Do not mutate code and do not propose unrelated enhancements. Return concrete requirement statuses and actionable defects only.',
      },
      {
        role: 'user',
        content: JSON.stringify({ project: compactLedger(ledger), evidence: freshEvidence }, null, 2).slice(0, 80_000),
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
