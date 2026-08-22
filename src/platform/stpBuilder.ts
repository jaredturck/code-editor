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

export type STPTaskType = 'execute' | 'discover' | 'summarize' | 'verify' | 'compile';
export type STPPriority = 'high' | 'normal' | 'low';

export interface STPAgentIdentity {
  role: string;
  provider: string;
  model: string;
  /** Which provider key slot the member uses (for health tracking + failover). */
  keyId?: string;
}

export interface STPStepInput extends Record<string, unknown> {
  order?: number;
  action?: string;
  args?: Record<string, unknown>;
  onEmpty?: string;
  onError?: string;
}

export interface STPStep {
  order: number;
  action: string;
  args: Record<string, unknown>;
  onEmpty: string;
  onError: string;
}

export interface STPBuildInput {
  type?: unknown;
  goal?: unknown;
  scope?: unknown;
  constraints?: unknown;
  tools?: {
    /** Omit available for tier defaults; pass [] to explicitly grant no tools. */
    available?: unknown;
    preferred?: unknown;
    forbidden?: unknown;
  } | null;
  skills?: {
    load?: unknown;
    variant?: unknown;
  } | null;
  steps?: unknown;
  outputSchema?: unknown;
  budget?: {
    maxSteps?: unknown;
    maxTokens?: unknown;
    timeoutMs?: unknown;
    maxOutputChars?: unknown;
  } | null;
  context?: unknown;
  priority?: unknown;
  toAgent?: unknown;
  agentIdentity?: unknown;
}

export interface STPTask {
  stp: string;
  taskId: string;
  type: STPTaskType;
  priority: STPPriority;
  toAgent: string;
  agentIdentity?: STPAgentIdentity;
  createdAt: number;
  objective: {
    goal: string;
    scope: string;
    constraints: string[];
  };
  tools: {
    mode: 'auto' | 'explicit';
    available: string[];
    preferred: string[];
    forbidden: string[];
  };
  skills: {
    load: string[];
    variant: 'simple' | 'default';
  };
  steps: STPStep[];
  output: {
    schema: Record<string, unknown>;
    maxChars: number;
    format: 'json';
  };
  budget: {
    maxSteps: number;
    maxTokens: number;
    timeoutMs: number;
  };
  context: Record<string, unknown>;
  onComplete: {
    notifyAgent: string;
    summarizeResult: boolean;
  };
}

interface STPSystemPromptOptions {
  native?: boolean;
}

const STP_VERSION = '1.0';
const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_OUTPUT_CHARS = 6000;

// ── Utility ───────────────────────────────────────────────────────────────────

function generateTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older runtimes
  const hex = (n: number) =>
    Math.floor(Math.random() * n)
      .toString(16)
      .padStart(2, '0');
  return [
    Array.from({ length: 4 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 2 }, () => hex(256)).join(''),
    Array.from({ length: 6 }, () => hex(256)).join(''),
  ].join('-');
}

// Converts string array into the canonical representation expected by later code.
function normalizeStringArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

// Converts constraints into the canonical representation expected by later code.
function normalizeConstraints(value: unknown): string[] {
  return normalizeStringArray(value, 16);
}

// Converts steps into the canonical representation expected by later code.
function normalizeSteps(value: unknown): STPStep[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((step): step is STPStepInput => (step && typeof step === 'object') as boolean)
    .map((step, index) => ({
      order: Number.isFinite(Number(step.order)) ? Number(step.order) : index + 1,
      action: String(step.action || '').trim(),
      args: step.args && typeof step.args === 'object' ? step.args : {},
      onEmpty: String(step.onEmpty || '').trim(),
      onError: String(step.onError || '').trim(),
    }))
    .slice(0, 24);
}

// Converts priority into the canonical representation expected by later code.
function normalizePriority(value: unknown): STPPriority {
  const p = String(value || 'normal').toLowerCase();
  if (p === 'high' || p === 'low') return p;
  return 'normal';
}

// Converts type into the canonical representation expected by later code.
function normalizeType(value: unknown): STPTaskType {
  const valid = new Set<STPTaskType>(['execute', 'discover', 'summarize', 'verify', 'compile']);
  const t = String(value || 'execute').toLowerCase();
  return valid.has(t as STPTaskType) ? (t as STPTaskType) : 'execute';
}

// Converts agent identity into the canonical representation expected by later code.
function normalizeAgentIdentity(value: unknown): STPAgentIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const role = String((value as Record<string, unknown>).role || '').trim();
  const provider = String((value as Record<string, unknown>).provider || '').trim();
  const model = String((value as Record<string, unknown>).model || '').trim();
  if (!role && !provider && !model) return null;

  const keyId = String((value as Record<string, unknown>).keyId || '').trim();
  return keyId ? { role, provider, model, keyId } : { role, provider, model };
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build a fully normalised STP task object.
 *
 * @param {object} params
 * @param {string} params.type             - 'execute' | 'discover' | 'summarize' | 'verify' | 'compile'
 * @param {string} params.goal             - One sentence describing success
 * @param {string} [params.scope]          - Boundary / depth of the task
 * @param {string[]} [params.constraints]  - Hard limits the sub-agent must respect
 * @param {object} [params.tools]          - { available, preferred, forbidden }
 * @param {object} [params.skills]         - { load: string[], variant: 'simple'|'default' }
 * @param {object[]} [params.steps]        - Explicit step list (optional — if omitted, agent reasons autonomously)
 * @param {object} [params.outputSchema]   - Shape the result must conform to
 * @param {object} [params.budget]         - { maxSteps, maxTokens, timeoutMs, maxOutputChars }
 * @param {object} [params.context]        - { projectRoot, relevantNotes, priorResults, ... }
 * @param {string} [params.priority]       - 'high' | 'normal' | 'low'
 * @param {string} [params.toAgent]        - Target role; legacy aliases remain accepted by orchestration
 * @param {object} [params.agentIdentity]   - Explicit { role, provider, model } for new role-based callers
 * @returns {object} Fully normalised STP task object
 */
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
  const taskId = generateTaskId();
  const normalizedAgentIdentity = normalizeAgentIdentity(agentIdentity);

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
      schema:
        outputSchema && typeof outputSchema === 'object'
          ? (outputSchema as Record<string, unknown>)
          : {},
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
  };
}

/**
 * Build an STP system prompt string from a task object.
 * This is what sub-agents actually receive as their system prompt.
 * Runs ~400 tokens vs 1500+ for full-spec prompts.
 *
 * @param {object} stp - Output of buildSTP()
 * @param {string[]} [injectedSkillInstructions] - Pre-rendered skill instruction blocks
 * @returns {string}
 */
export function buildSTPSystemPrompt(
  stp: STPTask,
  injectedSkillInstructions: string[] = [],
  options: STPSystemPromptOptions = {},
) {
  const lines = [
    `You are an IRIS Sub-Agent executing task ${stp.taskId}.`,
    `OBJECTIVE: ${stp.objective.goal}`,
  ];

  if (stp.objective.scope) {
    lines.push(`SCOPE: ${stp.objective.scope}`);
  }

  if (stp.objective.constraints.length > 0) {
    lines.push('CONSTRAINTS:');
    stp.objective.constraints.forEach((c, i) => {
      lines.push(`  ${i + 1}. ${c}`);
    });
  }

  if (stp.context && Object.keys(stp.context).length > 0) {
    const contextText = JSON.stringify(stp.context, null, 2).slice(0, 12000);
    lines.push('SHARED CONTEXT FROM THE ORCHESTRATOR:');
    lines.push(contextText);
    lines.push(
      'Treat this as working evidence from the parent run. Reason from it, but verify live workspace state when the task depends on facts that may have changed.',
    );
  }

  if (stp.tools.available.length > 0) {
    lines.push(`AVAILABLE TOOLS: ${stp.tools.available.join(', ')}`);
  }

  if (stp.tools.preferred.length > 0) {
    lines.push(`PREFERRED TOOLS: ${stp.tools.preferred.join(', ')}`);
  }

  if (stp.tools.forbidden.length > 0) {
    lines.push(`FORBIDDEN TOOLS: ${stp.tools.forbidden.join(', ')} — do NOT call these.`);
  }

  lines.push(`MAX OUTPUT: ${stp.output.maxChars} chars`);

  if (Object.keys(stp.output.schema).length > 0) {
    lines.push(`OUTPUT SCHEMA: ${JSON.stringify(stp.output.schema)}`);
    lines.push('Return ONLY a JSON object matching this schema when complete.');
  }

  if (injectedSkillInstructions.length > 0) {
    lines.push('');
    lines.push('ACTIVE SKILLS:');
    injectedSkillInstructions.forEach((block) => lines.push(block));
  }

  if (stp.steps.length > 0) {
    lines.push('');
    lines.push('Complete these in order:');
    stp.steps.forEach((step) => {
      const argsStr = Object.keys(step.args).length > 0 ? ` args=${JSON.stringify(step.args)}` : '';
      const onEmptyStr = step.onEmpty ? ` [if empty: ${step.onEmpty}]` : '';
      const onErrorStr = step.onError ? ` [on error: ${step.onError}]` : '';
      lines.push(`  ${step.order}. ${step.action}${argsStr}${onEmptyStr}${onErrorStr}`);
    });
  } else {
    lines.push('Reason autonomously within the tool and budget constraints above.');
  }

  lines.push('');
  if (options.native) {
    // Native tool-calling: call tools natively for actions; return the final
    // result as JSON text (hybrid keeps the existing output-schema validation).
    lines.push(
      'Call the AVAILABLE TOOLS natively to do the work. Before a tool call, put one brief sentence of reasoning in your text.',
    );
    if (Object.keys(stp.output.schema).length > 0) {
      lines.push(
        'When the task is complete, STOP calling tools and reply with ONLY the final JSON object matching the OUTPUT SCHEMA above — plain text, no markdown.',
      );
    } else {
      lines.push('When the task is complete, reply with your final result as plain text.');
    }
  } else {
    lines.push('Always respond with strict JSON only. No markdown.');
    lines.push(
      'Every response MUST include a "thinking" string field with your brief reasoning for this turn (what you are doing and why), alongside either {"tool","args"} to call a tool or the final output object. Example: {"thinking":"Listing the dir to find configs","tool":"files.list","args":{"path":"."}}.',
    );
  }

  return lines.join('\n');
}

/**
 * Validate a result object against a task's output schema.
 * Returns { valid: boolean, missing: string[] }.
 *
 * @param {object} result
 * @param {object} schema - From stp.output.schema
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateSTPResult(
  result: unknown,
  schema: Record<string, unknown> | null | undefined,
) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return { valid: true, missing: [] };
  }

  if (!result || typeof result !== 'object') {
    return { valid: false, missing: Object.keys(schema) };
  }

  const missing = Object.keys(schema).filter(
    (key) => !(key in (result as Record<string, unknown>)),
  );

  return { valid: missing.length === 0, missing };
}

/**
 * Build a compact summary string from an STP for logging and timeline display.
 *
 * @param {object} stp
 * @returns {string}
 */
export function summariseSTP(stp: STPTask) {
  const typeLabel = String(stp.type || 'execute');
  const goal = String(stp.objective?.goal || '').slice(0, 120);
  const stepCount = Array.isArray(stp.steps) ? stp.steps.length : 0;
  const agentLabel = String(stp.toAgent || 'unknown');
  const stepsLabel = stepCount > 0 ? ` (${stepCount} explicit steps)` : ' (autonomous)';
  return `[STP ${typeLabel} → ${agentLabel}]${stepsLabel}: ${goal}`;
}
