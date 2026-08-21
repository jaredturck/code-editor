/**
 * Provides the controller decision definitions or transformations shared by the agent
 * runtime, provider schemas, and UI. It helps keep model-facing behavior consistent across
 * native-tool and controller execution modes.
 */

import { extractJsonObject } from '@/platform/agent/agentJsonUtils';
import type { ControllerDecision, ProviderMeta } from '@/platform/agent/types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Converts loosely structured controller output into the two actions the runtime
 * understands: a tool request or a final response. Missing or malformed fields fall back to
 * a final text reply so weaker models cannot leave the loop with an ambiguous decision
 * shape.
 */

export function normalizeDecision(rawDecision: unknown, rawText: unknown): ControllerDecision {
  if (!isRecord(rawDecision)) {
    return {
      thinking: '',
      todoUpdates: [],
      action: { type: 'final', message: String(rawText || '').trim() },
    };
  }

  const thinking = String(rawDecision.thinking || '').trim();
  const todoUpdates = Array.isArray(rawDecision.todo_updates)
    ? rawDecision.todo_updates.filter(isRecord)
    : [];

  const actionObject = isRecord(rawDecision.action) ? rawDecision.action : rawDecision;
  const actionType = String(actionObject.type || '').toLowerCase();

  if (actionType === 'tool') {
    return {
      thinking,
      todoUpdates,
      action: {
        type: 'tool',
        tool: String(actionObject.tool || '').trim(),
        args: isRecord(actionObject.args) ? actionObject.args : {},
      },
    };
  }

  const finalMessage = String(
    actionObject.message || actionObject.final || rawDecision.final || rawDecision.message || '',
  ).trim();

  return {
    thinking,
    todoUpdates,
    action: { type: 'final', message: finalMessage },
  };
}

/**
 * Maps native meta to decision into the representation required by another layer.
 */

export function mapNativeMetaToDecision(
  meta: ProviderMeta | null | undefined,
): ControllerDecision | null {
  const toolCalls = Array.isArray(meta?.toolCalls) ? meta.toolCalls : [];

  if (toolCalls.length > 0) {
    const first = toolCalls[0];
    return {
      thinking: String(meta?.thinkingText || meta?.text || '').trim(),
      todoUpdates: [],
      action: {
        type: 'tool',
        tool: String(first?.name || '').trim(),
        args: isRecord(first?.args) ? first.args : {},
      },
    };
  }

  const finalMessage = String(meta?.text || '').trim();
  if (!finalMessage) return null;

  return {
    thinking: '',
    todoUpdates: [],
    action: { type: 'final', message: finalMessage },
  };
}

// Determines whether model text appears to echo the controller schema instead of making a decision.
export function looksLikeControllerSchemaText(text: unknown): boolean {
  const value = String(text || '').trim();
  if (!value) return false;

  return [
    /"thinking"\s*:/i,
    /"todo_updates"\s*:/i,
    /"action"\s*:/i,
    /"type"\s*:\s*"tool"/i,
    /"tool"\s*:/i,
  ].some((pattern) => pattern.test(value));
}

// Recovers decision from schema text from common malformed model output without widening the
// accepted schema.
export function recoverDecisionFromSchemaText(text: unknown): ControllerDecision | null {
  if (!looksLikeControllerSchemaText(text)) return null;

  const parsed = extractJsonObject(text);
  if (!parsed) return null;

  const recovered = normalizeDecision(parsed, '');
  if (recovered.action.type === 'tool' && recovered.action.tool) return recovered;
  // Also salvage a final ANSWER wrapped in controller-schema JSON, so the model's real
  // message is surfaced instead of being discarded as a schema leak.
  if (recovered.action.type === 'final' && recovered.action.message) return recovered;
  return null;
}
