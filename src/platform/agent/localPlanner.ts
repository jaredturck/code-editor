/**
 * Best-effort local preflight planning. It asks one configured local model for a
 * compact structured plan only; tool execution remains in the main controller.
 */

import { callAIWithMeta } from '@/platform/aiService';
import { readAgentModels } from '@/platform/agent/agentIdentity';

export interface LocalPreflightPlan {
  taskType: string;
  developmentTask: boolean;
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
  [key: string]: unknown;
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

export function shouldRunLocalPlanning(userInput: string): boolean {
  const text = String(userInput || '').trim();
  if (text.length < 24) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)[.!\s]*$/i.test(text)) return false;
  return true;
}

export async function buildLocalPreflightPlan(
  userInput: string,
  conversation: Array<{ role?: string; content?: unknown }>,
  settings: SettingsLike,
  signal?: AbortSignal | null,
): Promise<LocalPreflightPlan | null> {
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
    'Create a compact execution preflight for an AI agent. Return JSON only.',
    'Do not expose chain-of-thought. Provide decisions, search queries, and observable steps.',
    'Schema:',
    '{"taskType":"answer|research|code_change|file_task|other","developmentTask":boolean,"needsLocalFiles":boolean,"needsWebResearch":boolean,"localQueries":string[],"webQueries":string[],"preflightChecks":string[],"verificationChecks":string[],"steps":string[]}',
    'Set developmentTask=true when the request creates, changes, fixes, refactors, configures, or extends software rather than merely explaining code.',
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
        content: 'You are IRIS local planner. Produce concise structured plans, not final answers.',
      },
      { role: 'user', content: prompt },
    ],
    {
      ...settings,
      ai_provider: 'local',
      ai_model: planner.model,
      ai_runtime_api_key: '',
      agent_max_output_tokens: 900,
    },
    { signal: signal || undefined },
  );
  const parsed = parsePlannerJson(String(meta?.text || ''));
  if (!parsed) return null;
  return {
    taskType: String(parsed.taskType || 'other'),
    developmentTask: parsed.developmentTask === true,
    needsLocalFiles: parsed.needsLocalFiles === true,
    needsWebResearch: parsed.needsWebResearch === true,
    localQueries: normalizeStrings(parsed.localQueries, 6),
    webQueries: normalizeStrings(parsed.webQueries, 6),
    preflightChecks: normalizeStrings(parsed.preflightChecks, 8),
    verificationChecks: normalizeStrings(parsed.verificationChecks, 8),
    steps: normalizeStrings(parsed.steps, 12),
  };
}

export function formatLocalPreflightPlan(plan: LocalPreflightPlan | null): string {
  if (!plan) return '';
  const parts = [
    `Local preflight: task=${plan.taskType}.`,
    plan.developmentTask
      ? 'Development lifecycle: inspect the current project and toolchain first; prepare only what is missing; implement; verify against the real environment; diagnose and fix any failures; then verify again before finishing.'
      : '',
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
