/**
 * Stable per-agent colors for the multi-model transparency UI (Workstream D).
 *
 * Every trace / tool / todo event can be attributed to the model that produced it; the
 * console renders per-model lanes and color-codes the todo list by owner. Colors must be
 * STABLE for a given role/agent across a session (and across sessions) so the legend stays
 * meaningful — hence a deterministic mapping, not a random palette.
 */

// Fixed colors for the three known roles (the common case) so they read consistently.
const ROLE_COLORS: Readonly<Record<string, string>> = {
  orchestrator: '#6C9EFF', // blue — the owner/controller
  executor: '#34D399', // green — heavy work
  scout: '#F59E0B', // amber — fast lookups
  consultant: '#A855F7', // purple — peer consult
};

// Palette for any other agent ids, picked deterministically by hashing the id.
const EXTRA_PALETTE: readonly string[] = [
  '#F472B6',
  '#22D3EE',
  '#FB923C',
  '#A3E635',
  '#C084FC',
  '#2DD4BF',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // 32-bit
  }
  return Math.abs(hash);
}

/**
 * Deterministic color for an agent role or id. Known roles get their fixed color; anything
 * else is hashed into a stable palette slot. Empty input → the neutral orchestrator color.
 */
export function colorForAgent(roleOrId: unknown): string {
  const key = String(roleOrId || '')
    .trim()
    .toLowerCase();
  if (!key) return ROLE_COLORS.orchestrator;
  if (ROLE_COLORS[key]) return ROLE_COLORS[key];
  return EXTRA_PALETTE[hashString(key) % EXTRA_PALETTE.length];
}

/** Short uppercase label for an agent badge (e.g. "EXECUTOR" → "EXEC"). */
export function agentBadgeLabel(roleOrId: unknown): string {
  const key = String(roleOrId || '').trim();
  if (!key) return '';
  if (key.toLowerCase() === 'orchestrator') return 'OWNER';
  return key.length > 8 ? key.slice(0, 8) : key;
}
