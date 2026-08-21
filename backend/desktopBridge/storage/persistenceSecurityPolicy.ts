/**
 * Defines which encrypted renderer-state records stay sealed during application bootstrap.
 * These keys carry per-chat autonomous-run state or extended run history and are fetched only
 * when the user opens the corresponding chat/history surface.
 */

const CHAT_SESSION_KEY_PREFIX = 'iris_chat_session_';
const COMPACT_AGENT_RUNS_KEY = 'iris_agent_runs';
const EXTENDED_AGENT_RUNS_KEY = 'iris_agent_runs_full';

export function isLazyRendererStateKey(key: string): boolean {
  const normalized = String(key || '').trim();
  return (
    normalized === COMPACT_AGENT_RUNS_KEY ||
    normalized === EXTENDED_AGENT_RUNS_KEY ||
    normalized.startsWith(CHAT_SESSION_KEY_PREFIX)
  );
}

export function filterRendererBootstrapValues(
  values: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (isLazyRendererStateKey(key)) continue;
    if (typeof value === 'string') filtered[key] = value;
  }
  return filtered;
}

export function normalizeRequestedDurableStoreKeys(keys: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(keys) ? keys : [])
        .map((key) => String(key || '').trim())
        .filter((key) => key.length > 0 && key.length <= 240 && isLazyRendererStateKey(key)),
    ),
  ).slice(0, 64);
}

export { CHAT_SESSION_KEY_PREFIX, COMPACT_AGENT_RUNS_KEY, EXTENDED_AGENT_RUNS_KEY };
