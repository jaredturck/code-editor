/**
 * evalTasks.js
 * A small fixed set of realistic, multi-step tasks for the offline eval harness
 * (W4). These replace the retired online reward/mutation loop: instead of
 * mutating skills/prompts at runtime off a noisy keyword proxy, we run this suite
 * on demand, human-review the report, and improve skills/tools/prompts offline.
 *
 * Each task carries a `prompt` and an optional `check(session)` predicate that
 * inspects the finished session ({ reply, timeline, steps, summary }) for a
 * coarse success signal. Checks are intentionally lenient — they flag obvious
 * failures, not exact-match correctness (per Anthropic's "evaluate with realistic
 * tasks" guidance: meaningful multi-step work, not toy operations).
 */

export interface EvalUsage {
  promptTokens?: unknown;
  lastPromptTokens?: unknown;
  completionTokens?: unknown;
  cacheHitRatio?: unknown;
  nativeToolAdoption?: unknown;
  [key: string]: unknown;
}

export interface EvalRunSummary {
  usage?: EvalUsage;
  stepsAttempted?: unknown;
  toolFailures?: unknown;
  invalidArgErrors?: unknown;
  redundantToolCalls?: unknown;
  [key: string]: unknown;
}

export interface EvalStep {
  tool?: unknown;
  [key: string]: unknown;
}

export interface EvalTimelineEvent {
  type?: unknown;
  tool?: unknown;
  argsPreview?: unknown;
  [key: string]: unknown;
}

export interface EvalSession {
  reply?: unknown;
  timeline?: EvalTimelineEvent[];
  steps?: EvalStep[] | number;
  summary?: EvalRunSummary | null;
}

export interface EvalTask {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  check?: (session: EvalSession) => boolean;
}

const _reply = (session: EvalSession): string => String(session?.reply || '').toLowerCase();
const _toolsUsed = (session: EvalSession): string[] =>
  (Array.isArray(session?.steps) ? session.steps : []).map((step) => String(step?.tool || ''));
const _usedAnyTool = (session: EvalSession, names: string[]): boolean =>
  _toolsUsed(session).some((tool) => names.includes(tool));
// Determines whether the run used a terminal command matching the supplied pattern.
const _usedTerminalMatching = (session: EvalSession, pattern: RegExp): boolean =>
  (Array.isArray(session?.timeline) ? session.timeline : []).some(
    (event) =>
      event?.type === 'tool_call' &&
      /terminal\.exec/.test(String(event?.tool || '')) &&
      pattern.test(String(event?.argsPreview || '')),
  );

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'list-workspace',
    title: 'List the working directory',
    prompt: 'List the files and folders in the current working directory.',
    tags: ['files', 'terminal'],
    check: (session) =>
      _usedTerminalMatching(session, /\bls\b|\bfind\b/) ||
      _usedAnyTool(session, ['files.list', 'files.find']),
  },
  {
    id: 'find-string',
    title: 'Search for a string across files',
    prompt:
      'Search this project for where the string "runAgentSession" is defined and tell me the file path.',
    tags: ['search', 'terminal'],
    check: (session) =>
      _reply(session).includes('agentruntime') ||
      _usedTerminalMatching(session, /rg|grep/) ||
      _usedAnyTool(session, ['search.ripgrep', 'files.find']),
  },
  {
    id: 'read-and-summarize',
    title: 'Read a file and summarize it',
    prompt: 'Read package.json in the working directory and summarize what scripts are available.',
    tags: ['files'],
    check: (session) =>
      _usedAnyTool(session, ['files.read']) || _usedTerminalMatching(session, /cat|sed|head/),
  },
  {
    id: 'conceptual-no-tools',
    title: 'Answer a conceptual question directly',
    prompt:
      'In one sentence, what is the difference between prompt caching and context compaction?',
    tags: ['knowledge'],
    // Should answer directly from model knowledge — ideally few/no tool calls.
    check: (session) =>
      _reply(session).length > 20 &&
      (Array.isArray(session?.steps) ? session.steps.length <= 2 : true),
  },
  {
    id: 'multi-step-inspect',
    title: 'Multi-step: locate then inspect',
    prompt: 'Find the largest JavaScript file under src/lib and report its line count.',
    tags: ['files', 'terminal', 'multi-step'],
    check: (session) =>
      /\d/.test(_reply(session)) &&
      (_usedTerminalMatching(session, /find|wc|ls|du/) ||
        _usedAnyTool(session, ['files.find', 'files.stat', 'files.list'])),
  },
  {
    id: 'deep-file-content',
    title: 'Reason over deep file content',
    // Discriminates the stateful loop from the legacy single-shot loop: the target
    // value (12000) lives thousands of chars into agentRuntime.js — far past the
    // legacy loop's 300-char tool-result preview, which it never surfaces to the
    // model. The stateful loop feeds the full tool_result, so it can answer. Run
    // the suite with agent_stateful_loop 'off' vs 'on' to see the gap.
    prompt:
      'Read src/lib/agentRuntime.js and tell me the exact numeric value assigned to the STATEFUL_TOOL_RESULT_CHAR_CAP constant.',
    tags: ['files', 'long-context', 'stateful-loop'],
    check: (session) => _reply(session).includes('12000') || _reply(session).includes('12,000'),
  },
];

export default EVAL_TASKS;
