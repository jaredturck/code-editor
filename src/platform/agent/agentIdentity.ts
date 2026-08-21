/**
 * Agent identity helpers.
 *
 * Agent roles describe responsibility (orchestrator / executor / scout).
 * Provider and model values describe the AI implementation assigned to a role.
 * Keeping these concepts separate lets orchestration route by role while model
 * selection remains independently configurable.
 */

import { getKey, normalizeKeyId } from '@/platform/keyStore';

export const AGENT_ROLE_IDS = ['orchestrator', 'executor', 'scout', 'overwatcher'] as const;

export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];

export interface AgentRoleBinding {
  provider: string;
  model: string;
  /** Which of the provider's keys this role uses (Key 1/2/…); defaults to "1". Lets concurrent
   *  agents use DIFFERENT keys so they don't share one provider's rate limit. */
  keyId?: string;
}

export type AgentRoleAssignments = Partial<Record<AgentRoleId, AgentRoleBinding>>;

/**
 * One configured model in the flat agent mesh (the canonical `agent_models` store). Each entry
 * is a single model "card": a (provider, model, key) bound to a role/tier, with its own ability
 * tags. Multiple entries may share a role; exactly one per role is the `primary` (the
 * orchestrator's primary is the answering model). Older per-role settings are converted once
 * by settingsStorage before runtime code receives them. The `id` is derived from identity
 * (role+provider+model+key) so it is stable for React keys without becoming a second source of
 * truth.
 */
export interface AgentModelEntry {
  id: string;
  role: AgentRoleId;
  provider: string;
  model: string;
  /** Which provider key slot this model uses (Key 1/2/…) so concurrent agents avoid one rate limit. */
  keyId: string;
  /** The role's primary binding (one per role); the orchestrator's primary is the answerer. */
  primary: boolean;
  /** Custom ability tags the user added to THIS model (lowercased, deduped). */
  tags: string[];
  /** Auto-derived ability tags the user suppressed for THIS model. */
  disabledTags: string[];
}

export interface AgentIdentity {
  role: AgentRoleId;
  provider: string;
  model: string;
  keyId: string;
  explicitlyAssigned: boolean;
}

type SettingsLike = {
  ai_provider?: unknown;
  ai_model?: unknown;
  agent_models?: unknown;
  [key: string]: unknown;
};

const ROLE_ALIASES: Readonly<Record<string, AgentRoleId>> = Object.freeze({
  orchestrator: 'orchestrator',
  claude: 'orchestrator',
  anthropic: 'orchestrator',

  executor: 'executor',
  deepseek: 'executor',
  opencode: 'executor',
  coder: 'executor',

  scout: 'scout',
  local: 'scout',
  ollama: 'scout',
  lmstudio: 'scout',

  overwatcher: 'overwatcher',
  overwatch: 'overwatcher',
  supervisor: 'overwatcher',
  guide: 'overwatcher',
});

function identityText(value: unknown): string {
  return String(value ?? '');
}

function roleLookupText(value: unknown): string {
  return identityText(value).trim().toLowerCase();
}

// Mirrors the historical provider/model comparisons exactly: lowercase only,
// without changing whitespace or the persisted assignment values.
function legacyComparableText(value: unknown): string {
  return String(value || '').toLowerCase();
}

// Evaluates whether is agent role id for the supplied value and current runtime state.
export function isAgentRoleId(value: unknown): value is AgentRoleId {
  return AGENT_ROLE_IDS.includes(roleLookupText(value) as AgentRoleId);
}

/**
 * Convert a role name or supported legacy provider/model alias into a role.
 * Unknown or empty values preserve the historical executor fallback.
 */
export function normalizeAgentRole(
  value: unknown,
  fallback: AgentRoleId = 'executor',
): AgentRoleId {
  return ROLE_ALIASES[roleLookupText(value)] ?? fallback;
}

function computeEntryId(role: string, provider: string, model: string, keyId: string): string {
  return `${role}:${provider}:${model}:${keyId}`.toLowerCase();
}

function asTagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((tag) =>
          String(tag || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Normalize one raw model entry; null when it carries neither a provider nor a model. */
function normalizeModelEntry(raw: unknown): AgentModelEntry | null {
  const r = asRecord(raw);
  const provider = identityText(r.provider).trim();
  const model = identityText(r.model).trim();
  if (!provider && !model) return null;
  const role = normalizeAgentRole(r.role, 'executor');
  const keyId = normalizeKeyId(r.keyId);
  return {
    id: computeEntryId(role, provider, model, keyId),
    role,
    provider,
    model,
    keyId,
    primary: r.primary === true,
    tags: asTagArray(r.tags),
    disabledTags: asTagArray(r.disabledTags),
  };
}

/**
 * The canonical flat agent-model list. Older role fields are converted and deleted during settings hydration, so runtime role selection
 * reads only `agent_models`. De-duped by role+provider+model+key so the
 * SAME model on different keys — or in different roles — are DISTINCT agents (the old
 * provider+model de-dup collapsed those, dropping multi-key peers and a same-model Overwatcher),
 * with exactly one primary per role.
 */
export function readAgentModels(settings: SettingsLike | null | undefined): AgentModelEntry[] {
  const raw = settings?.agent_models;
  const source = Array.isArray(raw)
    ? raw.map(normalizeModelEntry).filter((entry): entry is AgentModelEntry => entry !== null)
    : [];

  const seen = new Set<string>();
  const primaryByRole = new Set<AgentRoleId>();
  const out: AgentModelEntry[] = [];
  for (const entry of source) {
    const dedup = computeEntryId(entry.role, entry.provider, entry.model, entry.keyId);
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    let primary = entry.primary;
    if (primary && primaryByRole.has(entry.role)) primary = false;
    if (primary) primaryByRole.add(entry.role);
    out.push({ ...entry, primary });
  }
  // Guarantee each role with ≥1 model has exactly one primary (promote the first if none flagged).
  for (const entry of out) {
    if (!primaryByRole.has(entry.role)) {
      entry.primary = true;
      primaryByRole.add(entry.role);
    }
  }
  return out;
}

/** True when at least one model with a provider is bound to the given role. */
export function hasAgentRoleModel(
  settings: SettingsLike | null | undefined,
  role: AgentRoleId,
): boolean {
  return readAgentModels(settings).some((entry) => entry.role === role && Boolean(entry.provider));
}

/**
 * Derive the legacy per-role primary-binding map from the flat model list, so existing callers
 * (resolveAgentIdentity / getAgentRoleBinding / resolveCurrentAgentRole) keep working unchanged.
 */
export function readAgentRoleAssignments(
  settings: SettingsLike | null | undefined,
): AgentRoleAssignments {
  const assignments: AgentRoleAssignments = {};
  for (const entry of readAgentModels(settings)) {
    if (entry.primary && !assignments[entry.role]) {
      assignments[entry.role] = {
        provider: entry.provider,
        model: entry.model,
        keyId: entry.keyId,
      };
    }
  }
  return assignments;
}

// Returns agent role binding without requiring callers to know where or how it is stored.
export function getAgentRoleBinding(
  settings: SettingsLike | null | undefined,
  roleInput: unknown,
): AgentRoleBinding | null {
  const role = normalizeAgentRole(roleInput);
  return readAgentRoleAssignments(settings)[role] ?? null;
}

/**
 * Resolve the provider/model currently backing a role. When no explicit role
 * assignment exists, retain the existing behavior by falling back to the active
 * settings provider/model.
 */
export function resolveAgentIdentity(
  roleInput: unknown,
  settings: SettingsLike | null | undefined,
): AgentIdentity {
  const role = normalizeAgentRole(roleInput);
  const binding = getAgentRoleBinding(settings, role);
  const explicitlyAssigned = Boolean(binding?.provider);

  return {
    role,
    provider: explicitlyAssigned
      ? identityText(binding?.provider)
      : identityText(settings?.ai_provider),
    model: explicitlyAssigned
      ? identityText(binding?.model || settings?.ai_model)
      : identityText(settings?.ai_model),
    // Which key slot this role uses (only meaningful when explicitly bound); "1" otherwise.
    keyId: explicitlyAssigned ? normalizeKeyId(binding?.keyId) : '1',
    explicitlyAssigned,
  };
}

/** Apply a role's provider/model to a settings object without mutating it. */
export function applyAgentIdentityToSettings<T extends SettingsLike>(
  settings: T,
  identity: AgentIdentity,
): T {
  if (!identity.explicitlyAssigned) return settings;

  return {
    ...settings,
    ai_provider: identity.provider,
    ai_model: identity.model || settings.ai_model,
    // Bind the role provider's OWN key — and the SPECIFIC key slot (Key 1/2/…) this role was
    // assigned — so concurrent agents (teamwork / peer review) each use a different key and don't
    // share one provider's rate limit. Empty when unset → a clear "API key not configured".
    ai_runtime_api_key: getKey(identity.provider, identity.keyId),
  };
}

// Selects or derives agent role settings from the available settings, input, and runtime context.
export function resolveAgentRoleSettings<T extends SettingsLike>(
  roleInput: unknown,
  settings: T,
): { identity: AgentIdentity; settings: T } {
  const identity = resolveAgentIdentity(roleInput, settings);
  return {
    identity,
    settings: applyAgentIdentityToSettings(settings, identity),
  };
}

/**
 * Identify which configured role is backed by the active provider/model.
 * The fallback logic is intentionally identical to the previous runtime logic.
 */
export function resolveCurrentAgentRole(settings: SettingsLike | null | undefined): AgentRoleId {
  const provider = legacyComparableText(settings?.ai_provider);
  const model = legacyComparableText(settings?.ai_model);
  const assignments = readAgentRoleAssignments(settings);

  for (const role of AGENT_ROLE_IDS) {
    const binding = assignments[role];
    if (!binding) continue;

    const assignedProvider = identityText(binding.provider);
    const assignedModel = identityText(binding.model);
    if (assignedProvider === provider && (assignedModel === model || !assignedModel)) {
      return role;
    }
  }

  if (provider === 'anthropic' || model.includes('claude')) return 'orchestrator';
  if (
    provider === 'local' ||
    ['llama', 'gemma', 'phi', 'mistral'].some((family) => model.includes(family))
  ) {
    return 'scout';
  }
  return 'executor';
}

/**
 * Preserve the old provider/model-derived agent identifier for compatibility.
 * This is a model-family identity, not an orchestration role.
 */
export function resolveLegacyAgentId(settings: SettingsLike | null | undefined): string {
  const provider = legacyComparableText(settings?.ai_provider);
  const model = legacyComparableText(settings?.ai_model);

  if (provider === 'anthropic' || model.includes('claude')) return 'claude';
  if (provider === 'opencode' || provider === 'deepseek' || model.includes('deepseek')) {
    return 'deepseek';
  }
  if (provider === 'local') return 'local';
  if (model.includes('gpt') || provider === 'openai') return 'openai';
  if (model.includes('gemini') || provider === 'gemini') return 'gemini';

  return 'unknown';
}
