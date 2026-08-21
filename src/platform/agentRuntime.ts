/**
 * Exports the stable renderer-facing agent API while the implementation is split across
 * focused runtime modules. This facade keeps existing imports working as the session
 * runner, policy, tools, and finalization code evolve.
 */

import { getToolDefinitions } from '@/platform/agent/toolCatalog';
import { runAgentSession as runAgentSessionImpl } from '@/platform/agent/runtime/sessionRunner';

export interface AgentSessionInput {
  userInput: string;
  screenContext?: string | null;
  conversation?: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  todos?: Array<Record<string, unknown>>;
  maxSteps?: number | null;
  onEvent?: (event: Record<string, unknown>) => void;
  onApprovalRequest?: (request: Record<string, unknown>) => unknown | Promise<unknown>;
  abortSignal?: AbortSignal | null;
}

export interface AgentSessionResult {
  reply: string;
  timeline: Array<Record<string, unknown>>;
  todos: Array<Record<string, unknown>>;
  steps: number;
  stepHistory: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  skills: Record<string, unknown>;
  reward: unknown;
  safety: Record<string, unknown>;
  summary: Record<string, unknown>;
}

type RunAgentSessionImplementation = (input: AgentSessionInput) => Promise<AgentSessionResult>;

// Runs one complete agent session, including model calls, tool execution, approvals, limits,
// persistence, and finalization.
export function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  return (runAgentSessionImpl as RunAgentSessionImplementation)(input);
}

// Returns agent tool definitions without requiring callers to know where or how it is stored.
export function getAgentToolDefinitions() {
  return getToolDefinitions();
}
