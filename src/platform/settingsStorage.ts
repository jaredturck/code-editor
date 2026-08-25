/**
 * Defines the complete normalized settings contract and the compatibility rules used when
 * values are loaded from older storage. All settings consumers should rely on this module's
 * defaults rather than creating feature-specific fallback values.
 */

import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore'
import { DEFAULT_AI_MODEL, DEFAULT_AI_PROVIDER_ID } from '@/platform/providers/providerRegistry'
import { AGENT_ROLE_IDS, readAgentModels, type AgentModelEntry, type AgentRoleId } from '@/platform/agent/agentIdentity'
import { normalizeKeyId } from '@/platform/keyStore'

const SETTINGS_STORAGE_KEY = 'iris_settings'

export const DEFAULT_IRIS_SETTINGS = {
  ai_provider: DEFAULT_AI_PROVIDER_ID,
  ai_api_key: '',
  ai_opencode_url: 'https://opencode.ai/zen/v1',
  ai_local_url: 'http://localhost:11434',
  ai_model: DEFAULT_AI_MODEL,
  skills_enabled: true,
  skills_auto_switch: true,
  skills_active_profile: '',
  skills_token_budget: 2200,
  skills_max_active: 4,
  skills_min_relevance_score: 3,
  agent_safety_profile: 'strict',
  agent_block_sudo: true,
  agent_allow_network_commands: false,
  agent_require_explicit_approval: false,
  // Internal loop safety ceiling only — NOT a user-facing budget. The duration budget governs
  // when a run pauses for the user; this just bounds the loop and auto-extends quietly toward the
  // absolute cap so a long-but-legitimate task keeps running. (The steps system was removed.)
  agent_max_steps: 12,
  // When the model finalizes with todos still open (stopped mid-task), nudge it once to finish
  // or reconcile them before accepting.
  agent_finish_open_todos: true,
  // Tool over-abuse guard: max times the SAME tool call (same args) may run in a
  // session before it's blocked. Blind consecutive repeats are always blocked
  // regardless. Raise per model family if a capable model legitimately needs more.
  agent_tool_repeat_cap: 4,
  // Native provider tool-calling for capable models (Claude/GPT/Gemini/OpenRouter).
  // When false, the runtime uses the JSON-in-text controller for every model.
  native_tools_enabled: true,
  // Tool surface advertised to the controller (W2 — terminal-first).
  //   'auto'       → 'lean' for capable native-tool models, 'structured' for weak/local
  //   'lean'       → terminal-first minimal set (terminal + content I/O + web/skills/agent)
  //   'structured' → full set incl. the redundant files.*/search.* helpers
  // The redundant helpers stay registered + executable as a one-release safety
  // net; 'lean' simply stops advertising them so capable models go terminal-first.
  agent_toolset: 'auto',
  // Live token streaming of the controller call (Anthropic + OpenAI-compatible).
  // When false, responses arrive whole. Other providers ignore it gracefully.
  streaming_enabled: true,
  // Encrypted chat persistence is a mandatory desktop security contract. The key is
  // retained for compatibility with older settings objects, but normalization always
  // forces it on and the settings UI does not offer an insecure in-memory mode.
  chat_persistence_enabled: true,
  // Stateful conversational agent loop (the real multi-turn loop: persistent
  // messages[], the model sees its own tool_use turns + full tool_result outputs,
  // reasons across steps, recovers from truncation/errors, streams thinking live).
  //   'off'  → legacy single-shot-per-step loop (re-summarizes state each step)
  //   'auto' → stateful loop for native-tool-capable models, legacy otherwise
  //   'on'   → stateful loop whenever native tools are usable
  // Default 'auto' (cutover 2026-06-10): every model in the lineup is native-tool
  // capable, so they all run the real multi-turn loop. Set to 'off' to revert.
  agent_stateful_loop: 'auto',
  // Complexity-aware model routing (Workstream B) — off until a multi-model pool is configured.
  agent_model_routing: 'off',
  // The chat-selected answering model is locked for the current conversation. Local selections
  // create a hard local-only execution boundary; cloud selections use hybrid local assistance.
  agent_execution_policy: 'hybrid',
  agent_replay_enabled: true,
  agent_replay_max_runs: 40,
  // Duration-based session budget (minutes). The agent works this long before a chat popup
  // asks whether to continue; "Continue" doubles the budget, or enter a custom number of
  // minutes after which it stops. Replaces the old steps-based budget as the user-facing limit.
  agent_session_minutes: 15,
  // Multi-agent orchestration — disabled by default until role assignments are configured
  agent_multi_enabled: false,
  // Standby pool behavior (§2). 'eager' = every connectable bound model gets a worker loop at
  // session start so all agents are active and ready (each on its own key, no shared rate limit);
  // 'lazy' = register them but only spin a model's loop up on first delegation (lighter on local
  // RAM). Either way each agent runs on its OWN key.
  agent_standby_mode: 'eager',
  // Model failover (§F3). A rate-limited / failing model is swapped for the best healthy model by
  // task fit (context compacted, run continues) instead of stopping. Applies to the main agent AND
  // sub-agents (native + non-native loops). A red card shows each switch. Needs ≥2 configured models.
  //   'off'     → never fail over (stop on failure)
  //   'limited' → up to agent_failover_attempts switches per run
  //   'exhaust' → keep switching until the capable/healthy models run out
  agent_failover_mode: 'limited',
  agent_failover_attempts: 4,
  // Adaptive health checks only probe degraded/suspended models; healthy live requests update
  // their own status and do not require frequent background traffic.
  agent_health_check_enabled: true,
  agent_health_check_healthy_interval_ms: 60 * 60 * 1000,
  agent_health_check_degraded_interval_ms: 5 * 60 * 1000,
  // Canonical flat agent-model list. Older per-role fields are migrated once during settings
  // hydration and are not retained. Each entry is one model card:
  // { id, role, provider, model, keyId, primary, tags, disabledTags }. Lets the
  // same model run on different keys as distinct concurrent agents.
  agent_models: null,
  // Per-provider models discovered when a key is tested (provider id → string[]).
  // Shared between the Keys tab and the Agents tab role model selectors.
  discovered_models: {},
  // Last explicit credential test result per provider/key. The GUI reads this cached state and
  // never re-tests providers merely because Settings or Chat was opened.
  provider_key_validation: {},
  // Small user-curated model shortlist per provider. Full provider catalogs remain discovery data.
  provider_selected_models: {},
  // The detected local runtime controls whether IRIS may offer Ollama download actions.
  local_runtime_kind: '',
  // Per-role permission tiers (also editable in the Permissions tab).
  agent_permission_tier_orchestrator: 3,
  agent_permission_tier_executor: 2,
  agent_permission_tier_scout: 1,
  agent_permission_tier_overwatcher: 1,
  // ── Tagged model mesh / peer consultation (Workstream D) — gated by agent_multi_enabled.
  // Lets a model consult/delegate to a peer that knows more (discovered by tag). Soft caps
  // escalate via the normal limit-approval flow; each agent runs under its OWN role tier.
  // Peer consultation rides on the bridge: ON by default once multi-agent is enabled, so models
  // can actually reach agent.find/consult. Set false to explicitly opt out. (§3 — was a silent trap.)
  agent_peer_consult_enabled: true,
  // High but finite mesh safeguards. These are circuit breakers, not normal task budgets.
  agent_consult_max: 40,
  agent_consult_depth: 10,
  agent_consult_peer_repeat_max: 6,
  // Every remote inference call (delegate, consult, retry, and final synthesis) shares this budget.
  agent_cloud_request_budget: 50,
  agent_peer_review: 'suggested', // off | suggested | always — final multi-model code review
  // Overwatcher supervisor: when a reasoning model is assigned to the overwatcher role it always
  // gives an up-front complexity read. With this ON it ALSO runs in the background during a
  // session (event-driven — on drift) to keep steering the active agent.
  agent_overwatch_continuous: false,
  // Planning mode (toggled by /plan): forces every task to be planned first. The configured
  // loaded agents co-plan the task, the plan awaits the user's approval, then it executes. Replaces
  // the old teamwork mode. Persists until /plan turns it off.
  agent_planning_mode: false,
  // Force session alive: when ON, a chat's agent session does NOT end on its final response — the
  // loop parks awaiting your next message and continues in the SAME session, so no context (loaded
  // skills, todos, the live thread) is lost between turns. Scoped per chat; leaving the chat closes
  // the live session. Applies to capable (native-tool) models. Default off.
  force_session_alive: false,
  // Which roles may be loaded onto the team/standby pool. null = all delegatable roles (default);
  // an array is an explicit allowlist (e.g. ['executor','scout'] to keep extra orchestrators out of
  // the team). The primary orchestrator is always the lead and the overwatcher is governed
  // separately — this only filters the delegatable worker pool.
  agent_team_roles: null,
  // Context window budget — warn/auto-summarize at this fraction of remaining tokens
  context_budget_warn_ratio: 0.15,
  // Shared Chat/Notes speech-to-text configuration. Local Granite remains the secure default;
  // cloud providers are used only after explicit selection and a first-use upload notice.
  audio_provider: 'local',
  audio_model: 'gabegoodhart/granite4.1-speech:2b',
  audio_key_id: '1',
  audio_local_fallback: true,
  audio_cloud_notice_ack: false,
  // Extended thinking — Anthropic claude-3-5+ only
  extended_thinking: false,
  thinking_budget_tokens: 8000,
  // Effort (Anthropic adaptive-thinking models + reasoning models): controls
  // thinking depth, token spend, and tool-call consolidation. low|medium|high|
  // xhigh|max. Default 'high' (Anthropic's own default for agentic work).
  reasoning_effort: 'high',
  // Heavy-work output cap. 0 = use each model's tuned default (Claude 32K, etc.).
  // Set higher to let the agent write long reports/files in a single tool call
  // without the args being truncated at the output limit; clamped per-call to the
  // model's real ceiling (Opus/Fable 128K, Sonnet 64K) so it never 400s.
  agent_max_output_tokens: 0,
  // ── Web access guard ────────────────────────────────────────────────────────
  // When on, the agent must get per-site approval before INGESTING a site's
  // content — web.fetch, the pages search.web reads, and curl/wget in terminal.exec.
  // The search-engine query itself is treated as infrastructure and passes. Approve
  // a site permanently / for this session / all sites for this session, or deny.
  agent_web_site_guard: true,
  // Domains permanently allowed by the guard (host or "*.host"). Grows when the
  // user picks "allow this site permanently"; trusted-source domains seed it.
  agent_web_allowed_domains: [],
  // ── Package-install guard ────────────────────────────────────────────────────
  // When on, the agent must get approval before installing each dependency
  // (pip/npm/yarn/pnpm/bun/cargo/gem/go and friends) via terminal.exec. Approve a
  // package for this run / always / all packages this run, or deny.
  agent_package_install_guard: true,
  // When on, a raw `pip install` that would hit the global/system Python is
  // blocked in favor of a project-local .venv (the user can still waive it per run).
  agent_package_require_venv: true,
  // Packages permanently allowed by the guard. Grows when the user picks
  // "always allow <package>"; normalized (no version specifier) on match.
  agent_package_allowed: [],
  search_web_primary_provider: 'duckduckgo',
  search_web_fallback_chain: 'google_cse,tavily,exa,serper,brave,serpapi',
  search_web_require_paid_fallback_confirmation: true,
  search_web_google_cse_api_key: '',
  search_web_google_cse_cx: '',
  search_web_tavily_api_key: '',
  search_web_exa_api_key: '',
  search_web_serper_api_key: '',
  search_web_serpapi_api_key: '',
  search_web_brave_api_key: '',
  connection_status: 'untested',
  permissions_file_read: false,
  permissions_file_write: false,
  permissions_terminal: false,
  permissions_screen_capture: false,
  permissions_mouse_control: false,
  permissions_microphone: false,
  _permission_consent_v1: true,
  // Agent filesystem root. Empty = the user's home (~). Set via the /dir chat
  // command to scope agent file/terminal operations to a working directory.
  agent_working_dir: '',
}

/** @deprecated Internal compatibility alias; new code should use DEFAULT_IRIS_SETTINGS. */
export const DEFAULT_ORB_SETTINGS = DEFAULT_IRIS_SETTINGS

export type OrbSettings = Omit<
  typeof DEFAULT_IRIS_SETTINGS,
  'discovered_models' | 'agent_models' | 'agent_team_roles' | 'provider_key_validation' | 'provider_selected_models'
> & {
  agent_team_roles: AgentRoleId[] | null
  discovered_models: Record<string, string[]>
  agent_models: AgentModelEntry[] | null
  provider_key_validation: Record<
    string,
    import('@/platform/providers/providerConfiguration').ProviderKeyValidationRecord
  >
  provider_selected_models: Record<string, string[]>
  _stateful_cutover_v1?: boolean
  _permission_consent_v1?: boolean
  [key: string]: unknown
}

type PartialOrbSettings = Record<string, unknown> | null | undefined

export type PersistentPermissionKey =
  | 'file_read'
  | 'file_write'
  | 'terminal_exec'
  | 'screen_capture'
  | 'mouse_control'
  | 'microphone'
  | 'sudo'
  | 'network_commands'

export interface BridgePermissionState {
  fileRead: boolean
  fileWrite: boolean
  terminal: boolean
  launcher: boolean
  automation: boolean
  screenCapture: boolean
  microphone: boolean
}

const PERSISTENT_PERMISSION_KEYS = new Set<PersistentPermissionKey>([
  'file_read',
  'file_write',
  'terminal_exec',
  'screen_capture',
  'mouse_control',
  'microphone',
  'sudo',
  'network_commands',
])

// Normalizes permission identifiers carried by approval requests before they update settings.
export function normalizePersistentPermissionKeys(value: unknown): PersistentPermissionKey[] {
  const input = Array.isArray(value) ? value : value ? [value] : []
  return Array.from(
    new Set(
      input
        .map((key) =>
          String(key || '')
            .trim()
            .toLowerCase(),
        )
        .filter((key): key is PersistentPermissionKey =>
          PERSISTENT_PERMISSION_KEYS.has(key as PersistentPermissionKey),
        ),
    ),
  )
}

// Converts approved capability identifiers into the persistent settings they own.
export function buildPersistentPermissionPatch(permissionKeys: unknown): Partial<OrbSettings> {
  const patch: Partial<OrbSettings> = {}
  for (const key of normalizePersistentPermissionKeys(permissionKeys)) {
    if (key === 'file_read') patch.permissions_file_read = true
    if (key === 'file_write') patch.permissions_file_write = true
    if (key === 'terminal_exec') patch.permissions_terminal = true
    if (key === 'screen_capture') patch.permissions_screen_capture = true
    if (key === 'mouse_control') patch.permissions_mouse_control = true
    if (key === 'microphone') patch.permissions_microphone = true
    if (key === 'sudo') patch.agent_block_sudo = false
    if (key === 'network_commands') patch.agent_allow_network_commands = true
  }
  return patch
}

// Builds the exact Electron-owned bridge capability state represented by renderer settings.
export function buildBridgePermissionState(settings: Partial<OrbSettings> | OrbSettings): BridgePermissionState {
  return {
    fileRead: settings.permissions_file_read === true,
    fileWrite: settings.permissions_file_write === true,
    terminal: settings.permissions_terminal === true,
    launcher: settings.permissions_terminal === true,
    automation: settings.permissions_mouse_control === true,
    screenCapture: settings.permissions_screen_capture === true,
    microphone: settings.permissions_microphone === true,
  }
}

const LEGACY_AGENT_SETTING_KEYS = new Set([
  'agent_role_assignment',
  'agent_role_models',
  'agent_role_tags',
  'agent_role_tags_disabled',
])

const RETIRED_SETTING_KEYS = new Set([
  'chat_auto_title',
  'chat_max_retained',
  'agent_dev_mode',
  'max_note_chars',
  'orb_size',
  'appearance_theme',
  'appearance_accent',
  'orb_texture',
  'hotkey',
  'vision_auto_execute',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
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
  )
}

function legacyAgentModels(settings: Record<string, unknown>): AgentModelEntry[] {
  const assignment = asRecord(settings.agent_role_assignment)
  const extras = asRecord(settings.agent_role_models)
  const tags = asRecord(settings.agent_role_tags)
  const disabled = asRecord(settings.agent_role_tags_disabled)
  const output: AgentModelEntry[] = []

  const append = (role: AgentRoleId, raw: unknown, primary: boolean): void => {
    const value = asRecord(raw)
    const provider = String(value.provider || '').trim()
    const model = String(value.model || '').trim()
    if (!provider && !model) return
    const keyId = normalizeKeyId(value.keyId)
    const entryTags = normalizedTags(value.tags)
    const entryDisabledTags = normalizedTags(value.disabledTags)
    output.push({
      id: `${role}:${provider}:${model}:${keyId}`.toLowerCase(),
      role,
      provider,
      model,
      keyId,
      primary,
      tags: entryTags.length ? entryTags : normalizedTags(tags[role]),
      disabledTags: entryDisabledTags.length ? entryDisabledTags : normalizedTags(disabled[role]),
    })
  }

  for (const role of AGENT_ROLE_IDS) {
    append(role, assignment[role], true)
    const roleExtras = extras[role]
    if (Array.isArray(roleExtras)) roleExtras.forEach((entry) => append(role, entry, false))
  }
  return output
}

function hasLegacyAgentSettings(settings: Record<string, unknown>): boolean {
  return Array.from(LEGACY_AGENT_SETTING_KEYS).some((key) => settings[key] != null)
}

/**
 * Merges persisted settings with the current defaults while preserving additional values
 * written by newer features. It also performs one-time compatibility migrations without
 * retaining the retired fields.
 */

function normalizeSettings(settings: PartialOrbSettings): OrbSettings {
  const normalized = { ...DEFAULT_IRIS_SETTINGS } as OrbSettings

  if (!settings || typeof settings !== 'object') {
    return normalized
  }

  const hasPermissionConsentMarker = Object.prototype.hasOwnProperty.call(settings, '_permission_consent_v1')

  const migratedAgentModels =
    (!Array.isArray(settings.agent_models) || settings.agent_models.length === 0) && hasLegacyAgentSettings(settings)
      ? legacyAgentModels(settings)
      : []

  // Apply all known default keys from saved settings
  for (const key of Object.keys(DEFAULT_IRIS_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== undefined) {
      normalized[key] = settings[key]
    }
  }

  // Preserve forward-compatible extra keys, while deliberately dropping retired role fields.
  for (const key of Object.keys(settings)) {
    if (
      !LEGACY_AGENT_SETTING_KEYS.has(key) &&
      !RETIRED_SETTING_KEYS.has(key) &&
      !(key in normalized) &&
      settings[key] !== undefined
    ) {
      normalized[key] = settings[key]
    }
  }

  // One-time stateful-loop cutover (2026-06-10). Existing installs persisted the
  // old default `agent_stateful_loop: 'off'` (writeOrbSettings stores the full
  // object), which would otherwise pin the legacy loop forever. Upgrade a persisted
  // 'off' to 'auto' ONCE; a version marker means a later MANUAL revert to 'off'
  // (which carries the marker) is respected and not re-flipped.
  if (!normalized._stateful_cutover_v1) {
    if (normalized.agent_stateful_loop === 'off') normalized.agent_stateful_loop = 'auto'
    normalized._stateful_cutover_v1 = true
  }

  // Earlier builds enabled file-read and screen-capture defaults without an explicit user
  // grant. Revoke those legacy defaults once so every capability begins fail-closed and future
  // approvals reflect real consent stored in encrypted settings.
  if (!hasPermissionConsentMarker) {
    normalized.permissions_file_read = false
    normalized.permissions_file_write = false
    normalized.permissions_terminal = false
    normalized.permissions_screen_capture = false
    normalized.permissions_mouse_control = false
    normalized.permissions_microphone = false
    normalized.agent_block_sudo = true
    normalized.agent_allow_network_commands = false
    normalized._permission_consent_v1 = true
  }

  normalized.chat_persistence_enabled = true

  if (migratedAgentModels.length) {
    normalized.agent_models = readAgentModels({
      agent_models: migratedAgentModels,
    })
  } else if (Array.isArray(normalized.agent_models)) {
    normalized.agent_models = readAgentModels({
      agent_models: normalized.agent_models,
    })
  }

  // The orchestrator's primary model (Settings → Agents) IS the active model. Sync
  // ai_provider/ai_model to it so chat, connection detection, and the runtime all use the model
  // configured in the Agents menu instead of a stale backup. ai_model remains only a fallback for
  // when no orchestrator model is bound. The API key is resolved per-provider at call time, so
  // syncing provider/model here is sufficient (no secret handling needed).
  const agentModels = Array.isArray(normalized.agent_models) ? normalized.agent_models : []
  const orchestratorPrimary =
    agentModels.find((entry) => entry?.role === 'orchestrator' && entry?.primary && entry?.provider) ||
    agentModels.find((entry) => entry?.role === 'orchestrator' && entry?.provider)
  if (orchestratorPrimary?.provider) {
    normalized.ai_provider = orchestratorPrimary.provider as OrbSettings['ai_provider']
    if (orchestratorPrimary.model) normalized.ai_model = String(orchestratorPrimary.model)
  }

  // Credentials are owned exclusively by Electron safeStorage. Compatibility fields remain
  // in the shape so older callers do not break, but secrets are never accepted into SQLite.
  normalized.ai_api_key = ''
  normalized.search_web_google_cse_api_key = ''
  normalized.search_web_tavily_api_key = ''
  normalized.search_web_exa_api_key = ''
  normalized.search_web_serper_api_key = ''
  normalized.search_web_serpapi_api_key = ''
  normalized.search_web_brave_api_key = ''

  return normalized
}

// Reads orb settings and converts it into the representation used by the settings compatibility
// contract.
export function readOrbSettings(): OrbSettings {
  const parsed = readStorageJson<Record<string, unknown> | null>(SETTINGS_STORAGE_KEY, null)
  const normalized = normalizeSettings(parsed)
  if (parsed && hasLegacyAgentSettings(parsed)) {
    writeStorageJson(SETTINGS_STORAGE_KEY, normalized)
  }
  return normalized
}

// ── Immediate-apply broadcast ──────────────────────────────────────────────────

// Module-level subscribers notified the instant settings are written, so live runtime state
// (e.g. the sub-agent standby loops) can re-resolve provider/model/key/tier WITHOUT an app
// restart. The React settings context already re-renders consumers; this covers the
// module-singleton consumers that captured a one-time snapshot.
type SettingsChangeListener = (settings: OrbSettings) => void
const settingsChangeListeners = new Set<SettingsChangeListener>()

// Subscribes to settings writes; returns an unsubscribe function.
export function subscribeSettingsChanged(listener: SettingsChangeListener): () => void {
  if (typeof listener !== 'function') return () => {}
  settingsChangeListeners.add(listener)
  return () => settingsChangeListeners.delete(listener)
}

function notifySettingsChanged(settings: OrbSettings): void {
  for (const listener of settingsChangeListeners) {
    try {
      listener(settings)
    } catch {
      /* listener errors are non-fatal */
    }
  }
}

// Persists orb settings while preserving the storage and compatibility rules of this module.
export function writeOrbSettings(settings: PartialOrbSettings): OrbSettings {
  const normalized = normalizeSettings(settings)
  writeStorageJson(SETTINGS_STORAGE_KEY, normalized)
  notifySettingsChanged(normalized)
  return normalized
}
