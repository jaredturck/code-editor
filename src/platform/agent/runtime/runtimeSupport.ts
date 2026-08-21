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
export * from '@/platform/agent/runtime/webSearchPolicy';
export * from '@/platform/agent/runtime/limitPolicy';
export * from '@/platform/agent/runtime/safetyPolicy';
