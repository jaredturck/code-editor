/**
 * Implements the runtime support portion of an agent session. It is separated from the
 * session runner so policy, continuity, limits, tools, and finalization can be reasoned
 * about independently.
 */

// Central compatibility barrel for the extracted runtime policies.
export * from '@/platform/agent/runtime/config';
export * from '@/platform/agent/runtime/continuity';
export * from '@/platform/agent/runtime/todoTrace';
export * from '@/platform/agent/runtime/capabilityPolicy';
export { inferForcedToolActionForRequest } from '@/platform/agent/runtime/modelIntentPolicy';
export * from '@/platform/agent/runtime/webSearchPolicy';
export * from '@/platform/agent/runtime/limitPolicy';
export * from '@/platform/agent/runtime/safetyPolicy';

import { withEditorNativeToolScope } from '@/platform/agent/editorNativeToolScope';
import { buildCapabilitySnapshot as buildBaseCapabilitySnapshot } from '@/platform/agent/runtime/capabilityPolicy';

/** Keeps editor-native workspace verification tools in the same permission/capability pipeline. */
export function buildCapabilitySnapshot(input: Record<string, any>) {
  return buildBaseCapabilitySnapshot({
    ...input,
    settings: withEditorNativeToolScope(input?.settings),
  });
}
