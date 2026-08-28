/**
 * Implements the runtime support portion of an agent session. It is separated from the
 * session runner so policy, continuity, limits, tools, and finalization can be reasoned about
 * independently.
 */

// Central compatibility barrel for the extracted runtime policies.
export * from '@/platform/agent/runtime/config'
export * from '@/platform/agent/runtime/continuity'
export * from '@/platform/agent/runtime/todoTrace'
export * from '@/platform/agent/runtime/capabilityPolicy'
export { inferForcedToolActionForRequest } from '@/platform/agent/runtime/modelIntentPolicy'
export * from '@/platform/agent/runtime/webSearchPolicy'
export * from '@/platform/agent/runtime/limitPolicy'
export * from '@/platform/agent/runtime/safetyPolicy'

import { withEditorNativeToolScope } from '@/platform/agent/editorNativeToolScope'
import { buildCapabilitySnapshot as buildBaseCapabilitySnapshot } from '@/platform/agent/runtime/capabilityPolicy'
import { toToolResultContent as baseToolResultContent } from '@/platform/agent/runtime/config'

type CapabilitySnapshotInput = Parameters<typeof buildBaseCapabilitySnapshot>[0]

const DEFAULT_MODEL_TOOL_RESULT_CAP = 24000

/** Keeps editor-native workspace verification tools in the same permission/capability pipeline. */
export function buildCapabilitySnapshot(input: CapabilitySnapshotInput) {
  return buildBaseCapabilitySnapshot({
    ...input,
    settings: withEditorNativeToolScope(input.settings),
  })
}

/**
 * Keep individual tool results small enough for local models to retain the surrounding task.
 * The base renderer still appends pagination guidance whenever the result is truncated.
 */
export function toToolResultContent(result: unknown, options: { cap?: number; toolName?: string } = {}) {
  return baseToolResultContent(result, {
    ...options,
    cap: Number.isFinite(Number(options.cap)) ? Number(options.cap) : DEFAULT_MODEL_TOOL_RESULT_CAP,
  })
}
