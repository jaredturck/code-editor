/**
 * Provides the tool guard definitions or transformations shared by the agent runtime,
 * provider schemas, and UI. It helps keep model-facing behavior consistent across
 * native-tool and controller execution modes.
 */

type ToolArguments = Record<string, unknown>;

export interface ToolGuardResult {
  blocked: boolean;
  escalate?: boolean;
  reason?: string;
}

export interface ToolGuard {
  check(toolName: string, args: unknown): ToolGuardResult;
  record(toolName: string, args: unknown): void;
}

export interface ToolGuardOptions {
  maxRepeat?: number;
}

const EXEMPT_TOOL_NAMES = new Set<string>(['todo.update', 'trace.log']);

// Serializes tool arguments with stable key ordering for repetition detection.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/**
 * Tracks repeated tool calls within one agent session and blocks identical or overused
 * requests before they consume more local work. Repeated attempts to run an already blocked
 * call escalate the signal so the runtime can steer the model toward another action or a
 * final answer.
 */

export function createToolGuard({ maxRepeat = 4 }: ToolGuardOptions = {}): ToolGuard {
  const cap = Math.max(2, Number(maxRepeat) || 4);
  const counts = new Map<string, number>();
  let lastSignature: string | null = null;
  let blockedSignature: string | null = null;
  let blockedSignatureCount = 0;

  // Builds the stable tool-call signature used to detect repeated actions.
  const signature = (tool: string, args: unknown): string => {
    const normalizedArgs: ToolArguments =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as ToolArguments) : {};
    return `${tool}::${stableStringify(normalizedArgs)}`;
  };

  return {
    // Checks check against the policy owned by the agent tool and policy layer.
    check(toolName: string, args: unknown): ToolGuardResult {
      const name = String(toolName || '');
      if (EXEMPT_TOOL_NAMES.has(name)) return { blocked: false };

      const sig = signature(name, args);
      const consecutive = sig === lastSignature;
      const count = counts.get(sig) || 0;

      if (consecutive || count >= cap) {
        if (sig === blockedSignature) blockedSignatureCount += 1;
        else {
          blockedSignature = sig;
          blockedSignatureCount = 1;
        }

        const reason = consecutive
          ? `You just ran \`${name}\` with identical arguments and already have its result above. Do NOT repeat the same call. If the user asked for OTHER things (e.g. a different app, file, or command), do the NEXT one now — you may issue several tool calls at once. If everything is done, give your final answer.`
          : `\`${name}\` has already run ${count} times with these arguments this session. Stop repeating it — use the results you already have, move on to the next distinct action, or give your final answer.`;

        return { blocked: true, escalate: blockedSignatureCount >= 2, reason };
      }
      return { blocked: false };
    },

    // Appends one normalized entry to tool guard without making logging a required success path.
    record(toolName: string, args: unknown): void {
      const name = String(toolName || '');
      if (EXEMPT_TOOL_NAMES.has(name)) return;
      const sig = signature(name, args);
      counts.set(sig, (counts.get(sig) || 0) + 1);
      lastSignature = sig;
      blockedSignature = null;
      blockedSignatureCount = 0;
    },
  };
}
