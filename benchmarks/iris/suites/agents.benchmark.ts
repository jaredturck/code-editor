/** Benchmarks agent prompt, task-protocol, tool-schema, context, and JSON-recovery work. */

import {
  buildControllerSystemPrompt,
  buildControllerStateHeader,
} from '../../../src/platform/agent/controllerPrompt.js';
import {
  looksLikeControllerSchemaText,
  recoverDecisionFromSchemaText,
} from '../../../src/platform/agent/controllerDecision.js';
import {
  buildJsonSchemaTools,
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools,
} from '../../../src/platform/agent/toolSchema.js';
import { TOOL_DEFINITIONS } from '../../../src/platform/agent/toolCatalog.js';
import { estimateMessagesTokens, estimateTokenCount } from '../../../src/platform/chatContextBuilder.js';
import {
  getModelCapabilities,
  resolveContextWindow,
  resolveMaxOutputTokens,
} from '../../../src/platform/modelProfiles.js';
import {
  buildSubAgentModelMessages,
  parseSubAgentModelJson,
} from '../../../src/platform/subAgentRuntime.js';
import {
  buildSTP,
  buildSTPSystemPrompt,
  summariseSTP,
  validateSTPResult,
} from '../../../src/platform/stpBuilder.js';
import type { BenchmarkDefinition } from '../core/types.js';

/** Creates a large but bounded agent transcript for token-estimation and context-cost benchmarks. */
function transcript(turns = 200): Array<{ role: string; content: string }> {
  const messages = [{ role: 'system', content: 'IRIS benchmark system instructions.' }];
  for (let index = 0; index < turns; index += 1) {
    messages.push({
      role: index % 2 ? 'assistant' : 'user',
      content: `Benchmark turn ${index}. ${'The agent preserves relevant context and tool results. '.repeat(20)}`,
    });
  }
  return messages;
}

/** Creates a representative delegated task with tools, constraints, steps, and output schema. */
function delegatedTask() {
  return buildSTP({
    type: 'execute',
    goal: 'Inspect the project and return a verified implementation summary.',
    scope: 'Only authored source files under server and src.',
    constraints: [
      'Do not edit generated output.',
      'Preserve public contracts.',
      'Run tests before returning.',
    ],
    tools: {
      available: ['files.read', 'files.write', 'terminal.exec', 'search.ripgrep'],
      preferred: ['search.ripgrep', 'files.read'],
      forbidden: ['launch.run'],
    },
    steps: Array.from({ length: 12 }, (_, index) => ({
      action: index % 2 ? 'files.read' : 'search.ripgrep',
      args: index % 2 ? { path: `src/file-${index}.ts` } : { query: `symbol-${index}` },
    })),
    outputSchema: {
      summary: 'string',
      filesChanged: 'string[]',
      verification: 'string[]',
    },
    budget: {
      maxSteps: 20,
      maxTokens: 16000,
      timeoutMs: 120000,
      maxOutputChars: 12000,
    },
    context: { projectRoot: '/tmp/iris', branch: 'benchmark' },
    priority: 'normal',
    toAgent: 'executor',
  });
}

/** Measures CPU-side agent orchestration preparation without contacting a model. */
export const agentBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'agents.controller-prompt.compose',
    suite: 'Agent runtime',
    name: 'Controller system prompt composition',
    description:
      'Composes role, capability, trust-boundary, skill, delegation, mesh, and planning instructions.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 1000,
    run: () => {
      let prompt = '';
      for (let index = 0; index < 1000; index += 1) {
        prompt = buildControllerSystemPrompt({
          tier: index % 2 ? 'lean' : 'structured',
          orchestration: true,
          tags: ['reasoning', 'code', 'long-context'],
          role: 'orchestrator',
          meshEnabled: true,
          planning: true,
        });
      }
      return prompt;
    },
  },
  {
    id: 'agents.controller-state-header.compose',
    suite: 'Agent runtime',
    name: 'Controller state-header composition',
    description:
      'Builds the volatile per-step session context kept outside the stable system prompt.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 1000,
    run: () => {
      let header: string | unknown[] = '';
      for (let index = 0; index < 1000; index += 1) {
        header = buildControllerStateHeader({
          step: index % 20,
          maxSteps: 20,
          todos: [
            { id: '1', content: 'Inspect code', status: 'completed' },
            { id: '2', content: 'Run verification', status: 'in_progress' },
          ],
          activeSkills: ['typescript', 'electron'],
          role: 'orchestrator',
        } as any);
      }
      return header;
    },
  },
  {
    id: 'agents.tool-schema.all-providers',
    suite: 'Agent runtime',
    name: 'Canonical tool schema conversion',
    description:
      'Converts the complete tool catalog into JSON Schema, Anthropic, OpenAI, and Gemini definitions.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: TOOL_DEFINITIONS.length,
    run: () => {
      const json = buildJsonSchemaTools(TOOL_DEFINITIONS as any);
      return {
        json,
        anthropic: toAnthropicTools(json),
        openai: toOpenAITools(json),
        gemini: toGeminiTools(json),
      };
    },
  },
  {
    id: 'agents.stp.build-and-prompt',
    suite: 'Agent runtime',
    name: 'Structured Task Protocol construction',
    description: 'Normalizes a delegated task and renders the complete sub-agent system prompt.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 500,
    run: () => {
      let result: unknown;
      for (let index = 0; index < 500; index += 1) {
        const stp = delegatedTask();
        result = {
          prompt: buildSTPSystemPrompt(stp, ['Use repository conventions and verify behavior.'], {
            native: index % 2 === 0,
          }),
          summary: summariseSTP(stp),
          validation: validateSTPResult(
            { summary: 'ok', filesChanged: [], verification: [] },
            stp.output.schema,
          ),
        };
      }
      return result;
    },
  },
  {
    id: 'agents.context-token-estimation.200-turns',
    suite: 'Agent runtime',
    name: 'Conversation token estimation · 200 turns',
    description:
      'Estimates message and text token usage for a long retained conversation before compaction decisions.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 201,
    setup: () => ({ messages: transcript(200) }),
    run: (context) => ({
      messages: estimateMessagesTokens(context.messages),
      finalMessage: estimateTokenCount(context.messages.at(-1)?.content),
    }),
  },
  {
    id: 'agents.model-capability-resolution',
    suite: 'Agent runtime',
    name: 'Model capability and budget resolution',
    description:
      'Resolves tool protocol, context window, reasoning behavior, and output limits across model families.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 1000,
    setup: () => ({
      models: [
        ['anthropic', 'claude-sonnet-4-6'],
        ['openai', 'gpt-4o'],
        ['openai', 'o3'],
        ['gemini', 'gemini-2.0-flash'],
        ['local', 'qwen3:8b'],
        ['local', 'deepseek-r1:14b'],
      ],
    }),
    run: (context) => {
      let result: unknown;
      for (let index = 0; index < 1000; index += 1) {
        const [provider, model] = context.models[index % context.models.length];
        result = {
          capabilities: getModelCapabilities(provider, model),
          context: resolveContextWindow({
            ai_provider: provider,
            ai_model: model,
          } as any),
          output: resolveMaxOutputTokens(model, provider, {
            ai_provider: provider,
            ai_model: model,
          } as any),
        };
      }
      return result;
    },
  },
  {
    id: 'agents.controller-json-recovery',
    suite: 'Agent runtime',
    name: 'Controller JSON recovery · malformed wrappers',
    description:
      'Recovers bounded tool/final decisions from common prose and fenced schema output.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 2000,
    setup: () => ({
      values: [
        '```json\n{"thinking":"read","todo_updates":[],"action":{"type":"tool","tool":"files.read","args":{"path":"/tmp/a"}}}\n```',
        'Result: {"thinking":"done","todo_updates":[],"action":{"type":"final","message":"complete"}} thanks',
      ],
    }),
    run: (context) => {
      let result: unknown;
      for (let index = 0; index < 2000; index += 1) {
        const text = context.values[index % context.values.length];
        result = looksLikeControllerSchemaText(text) ? recoverDecisionFromSchemaText(text) : null;
      }
      return result;
    },
  },
  {
    id: 'agents.subagent-json-recovery',
    suite: 'Agent runtime',
    name: 'Sub-agent output JSON recovery',
    description:
      'Parses strict, fenced, and prose-wrapped delegated results and builds final model messages.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 2000,
    setup: () => ({ stp: delegatedTask() }),
    run: (context) => {
      let result: unknown;
      for (let index = 0; index < 2000; index += 1) {
        result = {
          parsed: parseSubAgentModelJson(
            index % 2
              ? '```json\n{"summary":"ok","filesChanged":[],"verification":[]}\n```'
              : 'Result follows: {"summary":"ok","filesChanged":[],"verification":[]} thanks',
          ),
          messages: buildSubAgentModelMessages(context.stp, 'system prompt', 'step output'),
        };
      }
      return result;
    },
  },
];
