// @ts-nocheck
/**
 * Implements the config portion of an agent session. It is separated from the session
 * runner so policy, continuity, limits, tools, and finalization can be reasoned about
 * independently.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.
import { markUntrustedExternalContent } from '@/platform/security'

import { resolveContextWindow, supportsNativeTools } from '@/platform/modelProfiles'

import { estimateTokens } from '@/platform/agent/usageMetrics'

export const MAX_AGENT_STEPS = 12
export const AGENT_STEP_HARD_CAP = 60
// Duration-based session budget (replaces the steps system as the user-facing limit): the run
// works for this many minutes before a chat popup asks whether to continue. Steps are no longer
// surfaced or used as the budget — they only bound the loop as an infinite-loop safety net.
export const AGENT_SESSION_MINUTES_DEFAULT = 15
// Absolute loop-iteration safety ceiling for duration mode. The duration budget is the real
// limiter; this only guards against a runaway loop if the duration gate somehow never fires.
export const SESSION_STEP_ABSOLUTE_CEILING = 1000
export const MAX_PROMPT_MESSAGE_CHARS = 20000
export const MAX_TOOL_RESULT_CHARS = 24000
// Stateful loop: how much of a tool result the model sees in its tool_result turn
// before truncation (with an explicit "more available" marker). Far larger than
// the legacy 300-char stepHistory preview so the model can actually reason about
// real output; capped to protect the context window (compaction handles growth).
// Raised so the model can ingest large file reads / command output in one step.
export const STATEFUL_TOOL_RESULT_CHAR_CAP = 80000
export const DEFAULT_SKILLS_TOKEN_BUDGET = 2200
export const DEFAULT_SKILLS_MAX_ACTIVE = 4
export const DEFAULT_SKILLS_MIN_RELEVANCE_SCORE = 3
export const MAX_TERMINAL_COMMAND_LENGTH = 7500
export const MAX_FILE_WRITE_LENGTH = 800000
export const ARTIFACT_PREVIEW_CHARS = 120000
export const MAX_NOTE_CONTENT_LENGTH = 24000
export const MAX_SKILL_CARD_COUNT = 24
export const MAX_AGENT_READ_LINE_COUNT = 6000
export const CONTINUITY_NOTE_CHAR_LIMIT = 11000
// Per-task continuity notes are bounded so they never crowd out durable user
// notes; recall then surfaces only the ones relevant to the current request.
export const MAX_CONTINUITY_NOTES = 40
export const SEARCH_WEB_DEFAULT_RESULTS = 6
export const SEARCH_WEB_MAX_RESULTS = 16
export const SEARCH_WEB_DEFAULT_SOURCES = 4
export const SEARCH_WEB_MAX_SOURCES = 10
export const SEARCH_WEB_DEFAULT_CALL_BUDGET = 2
export const SEARCH_WEB_MAX_CALL_BUDGET = 4
export const SEARCH_WEB_UNLIMITED_CALL_BUDGET = 9999
export const WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER = 'duckduckgo'
export const WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS = ['google_cse', 'tavily', 'exa', 'serper', 'brave', 'serpapi']
export const WEB_SEARCH_PAID_PROVIDER_IDS = new Set(['tavily', 'exa', 'serper', 'brave', 'serpapi'])
export const SESSION_STEP_BUDGET_HARD_CAP = AGENT_STEP_HARD_CAP
export const SESSION_STEP_BUDGET_CONTINUE_INCREMENT = 1
export const SESSION_STEP_BUDGET_EXTEND_INCREMENT = 3
export const SEARCH_BUDGET_CONTINUE_INCREMENT = 1
export const SEARCH_BUDGET_EXTEND_INCREMENT = 2
export const TOOL_TIMEOUT_CONTINUE_BOOST_MS = 30000
export const TOOL_TIMEOUT_EXTEND_BOOST_MS = 90000
export const TOOL_TIMEOUT_UNLIMITED_MS = 300000

export const INSUFFICIENT_ACCESS_REPLY =
  "I don't have the permissions or tools to effectively complete your request right now."

// ── Agent State Machine ─────────────────────────────────────────────────────
export const AGENT_STATES = {
  IDLE: 'idle',
  RUNNING: 'running',
  DELEGATED_PAUSE: 'delegated_pause',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETE: 'complete',
  FAILED: 'failed',
  STOPPED: 'stopped',
}

// ── Context Budget ───────────────────────────────────────────────────────────
export const CONTEXT_BUDGET_WARN_RATIO = 0.15 // auto-summarize at 15% remaining

// ── Per-agent search budget ───────────────────────────────────────────────────
export const WEB_SEARCH_BUDGET_BY_ROLE = {
  orchestrator: 4,
  executor: 3,
  scout: 1,
}

// ── User Correction Detection ───────────────────────────────────────────────
export const USER_CORRECTION_PATTERNS = [
  /\b(no[,.]?\s|don't|dont|instead|actually|wrong|not like that|that's not)\b/i,
  /\bi (want|prefer|need) it to\b/i,
  /\b(stop doing|please don't|please dont)\b/i,
]

// ── Permission Tiers ─────────────────────────────────────────────────────────
export const TIER_2_BLOCKED_PATTERNS = [
  /(^|\s)(curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet)\b/i,
  /(^|\s)(dd|mkfs|fdisk|parted|mount|umount)\b/i,
  /(^|\s)(crontab|at\s|batch)\b/i,
  /(^|\s)(iptables|ufw|firewall-cmd)\b/i,
  /(^|\s)(useradd|usermod|userdel|groupadd|passwd)\b/i,
  /chmod\s+[0-9]*7[0-9]*/i,
  /chown\s+root/i,
]

export const TIER_3_APPROVAL_PATTERNS = [
  /(^|\s)sudo\b/i,
  /(curl|wget)[^|]*\|[^|]*(sh|bash|zsh)/i,
  /\brm\s+-rf?\s+\/[a-z]/i,
  /(^|\s)(dd|mkfs|fdisk)\b/i,
]

export const ALLOWED_MODULES = new Set(['files', 'terminal', 'notes', 'screen', 'search', 'launch'])

export const DANGEROUS_COMMAND_PATTERNS = [
  /(^|\s)rm\s+-rf\s+\/$/i,
  /(^|\s)rm\s+-rf\s+\/\s/i,
  /(^|\s)mkfs(\.|\s|$)/i,
  /(^|\s)shutdown(\s|$)/i,
  /(^|\s)reboot(\s|$)/i,
  /(^|\s)poweroff(\s|$)/i,
  /(^|\s)dd\s+if=/i,
]

export const NETWORK_COMMAND_PATTERNS = [/(^|\s)(curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet)\b/i]

export const PIPE_TO_SHELL_PATTERNS = [/(curl|wget)[^\n]{0,500}\|\s*(sh|bash|zsh|fish)\b/i]

export const SUDO_COMMAND_PATTERN = /(^|\s)sudo(\s|$)/i
export const FORK_BOMB_PATTERN = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*;\s*\}\s*;\s*:/
export const PATH_TRAVERSAL_PATTERN = /(^|\/)\.\.(\/|$)/
export const DOCUMENTS_ALIAS_TOKENS = new Set(['doc', 'docs', 'document', 'documents', 'mydocument', 'mydocuments'])

export const BLOCKED_READ_PATH_PATTERNS = [
  /^\/etc\/shadow(\/|$)/i,
  /^\/etc\/sudoers(\/|$)/i,
  /^\/root(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  // .env and .env.<env> (secrets), but allow .env.example / .sample / .template.
  /(^|\/)\.env(\.(?!example|sample|template|dist|schema)[\w-]+)?$/i,
  // Private SSH keys + cert/key bundles.
  /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i,
  /\.(pem|p12|pfx|key)$/i,
]

// Critical write targets — blocked at EVERY safety profile (system dirs + key
// stores). Classic privilege-escalation / backdoor vectors; never legitimately
// needed by a coding assistant via files.write (system edits go through sudo,
// which is itself approval-gated). Kept under the historical name so the runtime
// barrel re-exports stay stable.
export const BLOCKED_WRITE_PATH_PATTERNS = [
  /^\/(etc|bin|sbin|usr|boot|proc|sys|dev|root)(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
]

// Sensitive-but-sometimes-legitimate write targets (e.g. "add an alias to my
// .bashrc") — blocked only under the strict profile.
export const STRICT_WRITE_PATH_PATTERNS = [
  /(^|\/)\.(bashrc|bash_profile|zshrc|profile)(\/|$)/i,
  /(^|\/)\.config\/autostart(\/|$)/i,
]

// Controller prompts now live in agent/controllerPrompt.js (W1) — one
// tier-aware builder replaces the old CONTROLLER_SYSTEM_PROMPT (JSON) +
// NATIVE_CONTROLLER_SYSTEM_PROMPT (native) blobs. The per-session prompt
// strings are built once inside runAgentSession (stable across steps → caches).
// ── Debrief + adaptive budget helpers ────────────────────────────────────────

// W4: the reward-driven debrief injection and adaptive step budget were removed
// (observability-only). Reward/heatmap/delegation metrics are still RECORDED for
// the Training dashboard, but they no longer mutate the prompt or the step budget
// at runtime — skill improvement moves to an offline eval pass, not online drift.

export function detectUserCorrection(userInput) {
  const text = String(userInput || '')
  return USER_CORRECTION_PATTERNS.some((p) => p.test(text))
}

// Estimates context tokens used for policy or budgeting decisions in the agent session runtime.
export function estimateContextTokensUsed(systemPrompt, messages) {
  const systemTokens = estimateTokens(systemPrompt)
  const msgTokens = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + estimateTokens(content)
  }, 0)
  return systemTokens + msgTokens
}

// Selects or derives model context window from the available settings, input, and runtime context.
export function resolveModelContextWindow(settings) {
  // Unified onto modelProfiles.resolveContextWindow — single source of truth.
  return resolveContextWindow(settings)
}

// Tool definitions and metadata are centralized in @/platform/agent/toolCatalog.

// ── Terminal-first lean toolset (W2) ─────────────────────────────────────────
// Tools advertised to capable models. Terminal.exec is primary; dedicated tools
// remain only where shell is inefficient or unsafe: structured content I/O
// (read/write/patch), web, app state (launch/clipboard/screen), notes/memory,
// orchestration, skills (progressive disclosure), and control. The redundant
// find/grep/ls/stat/env helpers are deliberately omitted — a capable model uses
// `terminal.exec` (find, rg, ls, stat, ps) for those. They stay registered and
// executable (and are advertised in the 'structured' tier for weak/local models)
// as a one-release safety net per the agreed cutover plan.

/**
 * Resolve the advertised tool surface for the session.
 * 'auto' → lean for capable native-tool models, structured otherwise.
 * @returns {'lean'|'structured'}
 */
export function resolveAgentToolset(settings) {
  const mode = String(settings?.agent_toolset || 'auto').toLowerCase()
  if (mode === 'lean' || mode === 'structured') return mode
  const capable =
    supportsNativeTools(settings?.ai_provider, settings?.ai_model) && settings?.native_tools_enabled !== false
  return capable ? 'lean' : 'structured'
}

// ── Stateful-loop gate ───────────────────────────────────────────────────────
// The stateful conversational loop (persistent messages[], real tool_result
// turns) only makes sense when the provider supports native tool-calling — it IS
// a native-tools conversation. The 'agent_stateful_loop' setting controls it:
//   'off'  → legacy single-shot-per-step loop
//   'on'   → stateful loop whenever native tools are usable
//   'auto' → same as 'on', and now the DEFAULT: use the stateful append-only loop
//            whenever native tools are usable; fall back to the legacy loop otherwise.
// Falls back to the legacy loop whenever native tools aren't available, so weak/
// local models are unaffected.
export function useStatefulLoop(settings) {
  const mode = String(settings?.agent_stateful_loop || 'auto').toLowerCase()
  if (mode === 'off') return false
  const nativeCapable =
    supportsNativeTools(settings?.ai_provider, settings?.ai_model) && settings?.native_tools_enabled !== false
  return nativeCapable && (mode === 'on' || mode === 'auto')
}

// Render a tool result into the content string the model sees in its tool_result
// turn. Unlike the legacy stepHistory preview (300 chars), this keeps the full
// output up to a generous cap and, when it truncates, appends an explicit marker
// telling the model how much was cut and how to page the rest — so it can recover
// from truncation instead of reasoning blind (the core "doesn't bounce back from
// truncations" fix). Honors a tool result's own pagination hints when present.
export function toToolResultContent(result, { cap = STATEFUL_TOOL_RESULT_CHAR_CAP, toolName = '' } = {}) {
  const rawText = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  const text = markUntrustedExternalContent(toolName, rawText)
  if (!text) return '(no output)'
  if (text.length <= cap) return text

  const shown = text.slice(0, cap)
  const remaining = text.length - cap
  // Surface a concrete next-offset so a follow-up read can continue cleanly. For
  // file/command results that already carry offset/hasMore, prefer those signals.
  const nextOffset = Number.isFinite(Number(result?.nextOffset))
    ? Number(result.nextOffset)
    : Number.isFinite(Number(result?.offset))
      ? Number(result.offset) + 1
      : cap
  const hasMoreHint = result && typeof result === 'object' && 'hasMore' in result ? Boolean(result.hasMore) : true
  const guidance = hasMoreHint
    ? `\n\n…[truncated ${remaining} more chars — there is more output. Continue from offset ${nextOffset} (re-read with a higher offset / next page) if you need the rest.]`
    : `\n\n…[truncated ${remaining} more chars.]`
  return shown + guidance
}

// toPreview — moved to @/platform/agent/ (imported above)

// trimMessageContent — moved to @/platform/agent/ (imported above)

// sanitizeJsonTextForParsing — moved to @/platform/agent/ (imported above)

// tryParseJsonCandidate — moved to @/platform/agent/ (imported above)

// collectBalancedJsonObjects — moved to @/platform/agent/ (imported above)

// extractJsonObject — moved to @/platform/agent/ (imported above)
