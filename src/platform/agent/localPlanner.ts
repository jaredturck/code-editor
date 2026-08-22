/**
 * Best-effort local preflight planning. It asks one configured local model for a
 * compact structured plan only; tool execution remains in the main controller.
 */

import { callAIWithMeta } from '@/platform/aiService';
import { readAgentModels } from '@/platform/agent/agentIdentity';

export interface LocalPreflightPlan {
  taskType: string;
  developmentTask: boolean;
  workspaceMutationExpected: boolean;
  verificationRequired: boolean;
  successCriteria: string[];
  needsLocalFiles: boolean;
  needsWebResearch: boolean;
  localQueries: string[];
  webQueries: string[];
  preflightChecks: string[];
  verificationChecks: string[];
  steps: string[];
}

interface SettingsLike {
  agent_models?: unknown;
  ai_local_url?: string;
  agent_local_planning?: boolean;
  agent_preflight_plan?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePlannerJson(value: string): Record<string, unknown> | null {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).slice(
    0,
    limit,
  );
}

function normalizePreflightPlan(value: unknown): LocalPreflightPlan | null {
  if (!isRecord(value)) return null;
  return {
    taskType: String(value.taskType || 'other'),
    developmentTask: value.developmentTask === true,
    workspaceMutationExpected: value.workspaceMutationExpected === true,
    verificationRequired: value.verificationRequired === true,
    successCriteria: normalizeStrings(value.successCriteria, 10),
    needsLocalFiles: value.needsLocalFiles === true,
    needsWebResearch: value.needsWebResearch === true,
    localQueries: normalizeStrings(value.localQueries, 6),
    webQueries: normalizeStrings(value.webQueries, 6),
    preflightChecks: normalizeStrings(value.preflightChecks, 8),
    verificationChecks: normalizeStrings(value.verificationChecks, 8),
    steps: normalizeStrings(value.steps, 12),
  };
}

export function shouldRunLocalPlanning(userInput: string): boolean {
  return Boolean(String(userInput || '').trim());
}

export async function buildLocalPreflightPlan(
  userInput: string,
  conversation: Array<{ role?: string; content?: unknown }>,
  settings: SettingsLike,
  signal?: AbortSignal | null,
): Promise<LocalPreflightPlan | null> {
  const suppliedPlan = normalizePreflightPlan(settings?.agent_preflight_plan);
  if (suppliedPlan) return suppliedPlan;
  if (!shouldRunLocalPlanning(userInput) || settings?.agent_local_planning === false) return null;

  const localModels = readAgentModels(settings).filter(
    (entry) => entry.provider === 'local' && entry.model,
  );
  const planner =
    localModels.find((entry) => entry.role === 'scout' && entry.primary) ||
    localModels.find((entry) => entry.role === 'orchestrator' && entry.primary) ||
    localModels.find((entry) => entry.role === 'scout') ||
    localModels[0];
  if (!planner) return null;

  const recent = (Array.isArray(conversation) ? conversation : [])
    .slice(-6)
    .map((message) => `${message.role || 'user'}: ${String(message.content || '').slice(0, 1200)}`)
    .join('\n');
  const prompt = [
    'Create a compact execution preflight and task contract for an AI agent. Return JSON only.',
    'Interpret the complete request and recent context semantically. Do not classify intent from isolated keywords or phrases.',
    'Do not expose chain-of-thought. Provide decisions, observable success criteria, search queries, and observable steps.',
    'Schema:',
    '{"taskType":"answer|research|code_change|file_task|other","developmentTask":boolean,"workspaceMutationExpected":boolean,"verificationRequired":boolean,"successCriteria":string[],"needsLocalFiles":boolean,"needsWebResearch":boolean,"localQueries":string[],"webQueries":string[],"preflightChecks":string[],"verificationChecks":string[],"steps":string[]}',
    'Set workspaceMutationExpected=true only when fulfilling the user intent requires changing files or project state in the workspace. Explanations, review, discovery, and read-only analysis normally do not require mutation.',
    'Set verificationRequired=true when successful completion should be checked against the real project or runtime rather than accepted from generated text alone.',
    'successCriteria must contain short observable outcomes that establish whether the user request is actually complete.',
    'For development tasks, plan reconnaissance before substantive implementation: inspect the existing project structure, manifests, conventions, toolchain/environment, and available developer tooling instead of assuming a blank project or a particular ecosystem.',
    'If the project is new or incomplete, the main agent should establish only the environment, dependency manifest, and structure that are normally appropriate for the ecosystem it actually discovers. Do not prescribe language-specific commands from this planner.',
    'For development tasks, include verification appropriate to the discovered project. A successful implementation should be run, built, tested, linted, imported, or otherwise checked against reality as appropriate; failures should feed back into diagnosis and another fix/verify cycle.',
    'Use needsLocalFiles when files on the user computer could materially help.',
    'Use needsWebResearch for current/public facts or external sources, not for purely local code work.',
    `Current request: ${userInput}`,
    recent ? `Recent context:\n${recent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const meta = await callAIWithMeta(
    [
      {
        role: 'system',
        content: 'You are IRIS local planner. Interpret user intent semantically and produce a concise structured task contract, not a final answer.',
      },
      { role: 'user', content: prompt },
    ],
    {
      ...settings,
      ai_provider: 'local',
      ai_model: planner.model,
      ai_runtime_api_key: '',
      agent_max_output_tokens: 1100,
    },
    { signal: signal || undefined },
  );
  const parsed = parsePlannerJson(String(meta?.text || ''));
  return normalizePreflightPlan(parsed);
}

export function formatLocalPreflightPlan(plan: LocalPreflightPlan | null): string {
  if (!plan) return '';
  const parts = [
    `Local preflight: task=${plan.taskType}.`,
    plan.developmentTask
      ? 'Development lifecycle: inspect the current project and toolchain first; prepare only what is missing; implement; verify against the real environment; diagnose and fix any failures; then verify again before finishing.'
      : '',
    plan.workspaceMutationExpected
      ? 'Task contract: workspace mutation is required for completion. Make the requested change with the available workspace tools; do not finish with only a proposed snippet, example, or explanation. Remain in the current agent loop until the mutation succeeds or a genuine blocker prevents it.'
      : '',
    plan.verificationRequired
      ? 'Task contract: completion requires real verification. Continue the current agent loop until appropriate verification evidence exists; if verification fails, diagnose the observed failure, choose the next action, fix it, and verify again.'
      : '',
    plan.successCriteria.length ? `Success criteria: ${plan.successCriteria.join(' | ')}.` : '',
    plan.preflightChecks.length
      ? `Preflight checks: ${plan.preflightChecks.join(' | ')}.`
      : '',
    plan.needsLocalFiles
      ? `Use filesystem RAG${plan.localQueries.length ? ` for: ${plan.localQueries.join(' | ')}` : ''}.`
      : 'Filesystem RAG is optional.',
    plan.needsWebResearch
      ? `Use web research${plan.webQueries.length ? ` for: ${plan.webQueries.join(' | ')}` : ''}.`
      : 'Web research is not initially required.',
    plan.verificationChecks.length
      ? `Verification goals: ${plan.verificationChecks.join(' | ')}.`
      : '',
    plan.steps.length ? `Plan: ${plan.steps.join(' → ')}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
