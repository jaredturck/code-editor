// @ts-nocheck
/**
 * Applies path, command, and tool restrictions before agent actions execute. It combines
 * universal secret and system protections with the selected safety profile and explicit
 * user settings.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.
import { callAIWithMeta } from '@/platform/aiService';
import {
  scoreSession,
  recordReward,
  recordToolHeatmap,
  recordDelegationMetrics,
} from '@/platform/skillRewards';
import {
  listDirectory,
  findFiles,
  readTextFile,
  writeTextFile,
  executeTerminalCommand,
  launchLocalCommand,
  getAutomationCapabilities,
  searchWebResearch,
  listSkillDefinitions,
  powerRipgrep,
  powerStat,
  powerFind,
  powerFd,
  powerLocate,
  powerDiff,
  powerPatch,
  powerWebFetch,
  powerEnvInspect,
  powerClipboardRead,
  powerClipboardWrite,
  powerScript,
  chatsReadMemory,
  chatsWriteMemory,
  chatsRecall,
  subagentReadOutput,
} from '@/platform/desktopBridge';
import {
  addNote,
  deleteNote,
  readNotes,
  updateNote,
  queryNotes,
  recallRelevantNotes,
  pruneNotesByCategory,
  recordUserPreferenceNote,
  clearSessionScopedNotes,
} from '@/platform/notesStorage';
import { resolveActiveSkillProfile, inferModelFamily } from '@/platform/skillProfiles';
import { resolveContextWindow, supportsNativeTools } from '@/platform/modelProfiles';
import { buildJsonSchemaTools } from '@/platform/agent/toolSchema';
import { createToolGuard } from '@/platform/agent/toolGuard';
import {
  buildControllerSystemPrompt,
  buildControllerStateHeader,
} from '@/platform/agent/controllerPrompt';
import {
  normalizeDecision,
  mapNativeMetaToDecision,
  looksLikeControllerSchemaText,
  recoverDecisionFromSchemaText,
} from '@/platform/agent/controllerDecision';
import {
  estimateTokens,
  createUsageTracker,
  trackUsageSample,
  buildUsageSummary,
} from '@/platform/agent/usageMetrics';
import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore';
import {
  handleAgentDelegate,
  handleAgentRecall,
  handleAgentStatus,
  handleAgentRoster,
  handleAgentBroadcast,
  handleAgentVerify,
  evaluateDelegationResult,
  ensureSubAgentLoop,
  resolveAgentId,
  detectOrchestrationMode,
  resolveCurrentRole,
  subscribeSubAgentEvents,
} from '@/platform/orchestrationClient';
import {
  extractJsonObject,
  toPreview,
  trimMessageContent,
  sanitizeJsonTextForParsing,
  tryParseJsonCandidate,
  collectBalancedJsonObjects,
} from '@/platform/agent/agentJsonUtils';
import {
  extractKeywords,
  normalizeSkill,
  scoreSkill,
  selectSkillsForPrompt,
  checkReflexSkills,
  loadSkillContext,
} from '@/platform/agent/agentSkillEngine';
import {
  DEFAULT_AGENT_READ_LINE_COUNT,
  DEFAULT_TOOL_TIMEOUT_MS,
  PERMISSION_TIER,
  TOOL_BY_NAME,
  TOOL_DEFINITIONS,
  getToolDefinitions,
  getToolPermissionKey,
  getToolTimeoutMs as getCatalogToolTimeoutMs,
  isLeanTool,
  isToolRisky,
  normalizeToolAliasKey,
  resolveCatalogToolRequest,
} from '@/platform/agent/toolCatalog';

import * as config from '@/platform/agent/runtime/config';
import * as continuity from '@/platform/agent/runtime/continuity';
import * as todoTrace from '@/platform/agent/runtime/todoTrace';
import * as capabilityPolicy from '@/platform/agent/runtime/capabilityPolicy';
import * as webSearchPolicy from '@/platform/agent/runtime/webSearchPolicy';
import * as limitPolicy from '@/platform/agent/runtime/limitPolicy';
const {
  MAX_AGENT_STEPS,
  AGENT_STEP_HARD_CAP,
  MAX_PROMPT_MESSAGE_CHARS,
  MAX_TOOL_RESULT_CHARS,
  STATEFUL_TOOL_RESULT_CHAR_CAP,
  DEFAULT_SKILLS_TOKEN_BUDGET,
  DEFAULT_SKILLS_MAX_ACTIVE,
  DEFAULT_SKILLS_MIN_RELEVANCE_SCORE,
  MAX_TERMINAL_COMMAND_LENGTH,
  MAX_FILE_WRITE_LENGTH,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_SKILL_CARD_COUNT,
  MAX_AGENT_READ_LINE_COUNT,
  CONTINUITY_NOTE_CHAR_LIMIT,
  MAX_CONTINUITY_NOTES,
  SEARCH_WEB_DEFAULT_RESULTS,
  SEARCH_WEB_MAX_RESULTS,
  SEARCH_WEB_DEFAULT_SOURCES,
  SEARCH_WEB_MAX_SOURCES,
  SEARCH_WEB_DEFAULT_CALL_BUDGET,
  SEARCH_WEB_MAX_CALL_BUDGET,
  SEARCH_WEB_UNLIMITED_CALL_BUDGET,
  WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER,
  WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
  WEB_SEARCH_PAID_PROVIDER_IDS,
  SESSION_STEP_BUDGET_HARD_CAP,
  SESSION_STEP_BUDGET_CONTINUE_INCREMENT,
  SESSION_STEP_BUDGET_EXTEND_INCREMENT,
  SEARCH_BUDGET_CONTINUE_INCREMENT,
  SEARCH_BUDGET_EXTEND_INCREMENT,
  TOOL_TIMEOUT_CONTINUE_BOOST_MS,
  TOOL_TIMEOUT_EXTEND_BOOST_MS,
  TOOL_TIMEOUT_UNLIMITED_MS,
  INSUFFICIENT_ACCESS_REPLY,
  AGENT_STATES,
  CONTEXT_BUDGET_WARN_RATIO,
  WEB_SEARCH_BUDGET_BY_ROLE,
  USER_CORRECTION_PATTERNS,
  TIER_2_BLOCKED_PATTERNS,
  TIER_3_APPROVAL_PATTERNS,
  ALLOWED_MODULES,
  DANGEROUS_COMMAND_PATTERNS,
  NETWORK_COMMAND_PATTERNS,
  PIPE_TO_SHELL_PATTERNS,
  SUDO_COMMAND_PATTERN,
  FORK_BOMB_PATTERN,
  PATH_TRAVERSAL_PATTERN,
  DOCUMENTS_ALIAS_TOKENS,
  BLOCKED_READ_PATH_PATTERNS,
  BLOCKED_WRITE_PATH_PATTERNS,
  STRICT_WRITE_PATH_PATTERNS,
  detectUserCorrection,
  estimateContextTokensUsed,
  resolveModelContextWindow,
  resolveAgentToolset,
  useStatefulLoop,
  toToolResultContent,
  formatDateKey,
  formatTimeKey,
  cleanSingleLine,
  isResumeIntent,
  getContinuityContext,
  shouldPersistContinuityNote,
  deriveContinuityTags,
  buildStepHistoryLabel,
  persistContinuityNote,
  normalizeTodoStatus,
  normalizeTodo,
  summarizeRequestForTodo,
  buildSeedTodos,
  createTodoTool,
  createTraceTool,
  summarizeTree,
  clampNumber,
  resolveSafetyConfig,
  hasExplicitUserApproval,
  inferToolNameFromAliasKey,
  resolveToolRequest,
  evaluateToolAccess,
  buildCapabilitySnapshot,
  isCapabilityOrPermissionError,
  isMissingPathError,
  buildInsufficientAccessReply,
  looksLikeInsufficientAccessReply,
  looksLikeToolAccessLimitationReply,
  isImperativeActionRequest,
  extractLaunchTargetFromRequest,
  escapeSingleQuotedShellArg,
  buildExecutableProbeCommand,
  fallbackForcedToolAction,
  inferForcedToolActionForRequest,
  extractFindQueryFromText,
  inferFindQuery,
  shouldUseGlobalPathFallback,
  extractFirstPathFromSummary,
  buildBestEffortToolSummaryReply,
  normalizePathForPolicy,
  normalizePathToken,
  isLikelyRelativePath,
  dedupeStrings,
  normalizeWebSearchQueryKey,
  normalizeWebProviderId,
  normalizeWebProviderList,
  normalizeWebProviderSettings,
  hasConfiguredProviderCredentials,
  hasConfiguredPaidFallbackProviders,
  buildWebSearchProviderPolicy,
  resolveWebSearchCallBudget,
  createWebSearchSessionState,
  rememberWebSearchQuery,
  getWebSearchCache,
  setWebSearchCache,
  normalizeApprovalDecisionToken,
  normalizeApprovalResponse,
  classifyLimitIssue,
  buildLimitDecisionOptions,
  resolveToolTimeoutMs,
  runWithTimeout,
  waitMs,
  buildFindFallbackPaths,
} = Object.assign(
  {},
  config,
  continuity,
  todoTrace,
  capabilityPolicy,
  webSearchPolicy,
  limitPolicy,
);

// Selects or derives agent root base from the available settings, input, and runtime context.
export function resolveAgentRootBase(settings) {
  const wd = String(settings?.agent_working_dir || '').trim();
  return wd || '~';
}

// Re-root a model-supplied path: absolute and ~-relative paths are honored as-is;
// "." / "" / relative paths resolve under the working root (home by default).
export function applyAgentRoot(rawPath, settings) {
  const base = resolveAgentRootBase(settings);
  const p = String(rawPath || '').trim();
  if (!p) return p; // let the caller decide on empty
  if (p === '.' || p === './') return base;
  if (p.startsWith('/') || p.startsWith('~')) return p;
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}${p.replace(/^\.\//, '')}`;
}

/**
 * Rejects agent file operations that violate protected-path or safety-profile rules after
 * applying the configured working root.
 */

export function assertSafePath(pathInput, { operation = 'read', settings } = {}) {
  const requested = String(pathInput || '').trim();
  if (!requested) {
    throw new Error('Path is required.');
  }

  // Re-root relative paths under the agent's working directory (home by default).
  const rawPath = applyAgentRoot(requested, settings);

  if (rawPath.includes('\0')) {
    throw new Error('Path contains invalid null bytes.');
  }

  const normalizedPath = normalizePathForPolicy(rawPath);
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  if (pathSegments.includes('.git')) {
    throw new Error('Git metadata is managed by Source Control and is not available through agent file tools.');
  }

  // ── Universal hardening (ALL profiles, including power) ───────────────────
  // Secrets must never be read and system/key dirs must never be written, even
  // with elevated capability — these are the exfiltration / persistence vectors
  // we lock down before sudo. Independent of the safety profile.
  if (
    operation === 'read' &&
    BLOCKED_READ_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))
  ) {
    throw new Error(
      'Reading secret/key paths (e.g. .ssh, .gnupg, /etc/shadow) is blocked for safety.',
    );
  }
  if (operation === 'write' || operation === 'cwd') {
    if (PATH_TRAVERSAL_PATTERN.test(normalizedPath)) {
      throw new Error('Path traversal on write is blocked for safety.');
    }
    if (BLOCKED_WRITE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
      throw new Error(
        'Writing to system or key directories (e.g. /etc, /usr, .ssh) is blocked for safety.',
      );
    }
  }

  // ── Strict-profile-only extras ────────────────────────────────────────────
  const safety = resolveSafetyConfig(settings, MAX_AGENT_STEPS);
  if (safety.profile === 'strict' && (operation === 'write' || operation === 'cwd')) {
    if (STRICT_WRITE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
      throw new Error(
        'Writing to shell startup / autostart files is blocked by the strict safety profile.',
      );
    }
  }

  return rawPath;
}

/**
 * Evaluates a terminal command against universal secret, system-write, network, package,
 * and privilege restrictions plus the active safety profile. It rejects unsafe commands
 * before they reach the bridge rather than relying on shell failure as a policy mechanism.
 */

export function assertSafeCommand(command, settings, context = 'terminal', approvalState = null) {
  const text = String(command || '').trim();
  if (!text) {
    throw new Error('Command is required.');
  }

  // Source Control owns repository mutation for the one Git repository at the workspace root.
  // Agent shell commands may inspect Git state, but Git writes are host-managed so the model
  // cannot accidentally create nested repositories, bypass the baseline, or rewrite history.
  // This is deterministic command safety enforcement, not user-intent classification.
  const mutatesEditorManagedGit =
    /(?:^|[;&|\n]\s*)(?:(?:env|command)\s+)*(?:\S*[\/])?git(?:\s+-C\s+\S+|\s+-c\s+\S+|\s+--(?:git-dir|work-tree|namespace|config-env)(?:=\S+|\s+\S+))*\s+(?:init|clone|add|commit|reset|clean|checkout|switch|restore|rm|mv|merge|rebase|cherry-pick|revert|tag|stash|worktree|submodule|remote|fetch|pull|push|branch|config|update-index|apply|am)(?:\s|$)/i.test(text);
  if (mutatesEditorManagedGit) {
    throw new Error(
      'Git mutations are managed by Source Control. Agent terminal Git is read-only; use status, diff, log, show, rev-parse, ls-files, grep, or blame for evidence.',
    );
  }

  if (text.length > MAX_TERMINAL_COMMAND_LENGTH) {
    throw new Error('Command is too long for safe execution.');
  }

  const blocked = DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
  if (blocked) {
    throw new Error('Command blocked by safety policy.');
  }

  const safety = resolveSafetyConfig(settings, MAX_AGENT_STEPS);

  // ── Permission tier enforcement ──────────────────────────────────────────
  if (safety.tier1ReadOnly && context === 'terminal') {
    throw new Error('Terminal commands are blocked in read-only permission tier (Tier 0/1).');
  }
  if (safety.permissionTier <= PERMISSION_TIER.STANDARD) {
    const tier2Blocked = TIER_2_BLOCKED_PATTERNS.some((p) => p.test(text));
    if (tier2Blocked) {
      throw new Error(
        'Command blocked by Tier 2 policy. Network/disk/user-management commands require Tier 3.',
      );
    }
  }
  if (safety.auditLog) {
    try {
      const ts = new Date().toISOString().slice(0, 19);
      addNote({
        title: `Audit: ${ts}`,
        category: 'error-log',
        content: `CATEGORY: error-log\nTAGS: audit,tier3\nSUMMARY: Tier 3 cmd\n\n[${ts}] ${text}`,
        color: 'yellow',
        sessionScoped: true,
      });
    } catch {
      /* non-fatal */
    }
  }

  const allowElevatedCommand = Boolean(approvalState?.allowElevatedCommands);
  const allowNetworkCommand = Boolean(approvalState?.allowNetworkCommands);
  const allowShellPassthrough = Boolean(approvalState?.allowShellPassthrough);
  if (SUDO_COMMAND_PATTERN.test(text) && safety.blockSudo && !allowElevatedCommand) {
    throw new Error('Commands using sudo are blocked by safety settings.');
  }

  if (FORK_BOMB_PATTERN.test(text)) {
    throw new Error('Command blocked by fork-bomb safety rule.');
  }

  if (PIPE_TO_SHELL_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error('Command blocked: pipe-to-shell execution is not allowed.');
  }

  if (!safety.allowNetworkCommands && !allowNetworkCommand) {
    const usesNetworkTool = NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
    if (usesNetworkTool) {
      throw new Error('Network-related commands are blocked by safety settings.');
    }
  }

  if (
    safety.profile === 'strict' &&
    context === 'launch' &&
    /(^|\s)(sh|bash|zsh)\s+-c(\s|$)/i.test(text) &&
    !allowShellPassthrough
  ) {
    throw new Error('Shell passthrough launch commands are blocked in strict safety profile.');
  }

  return text;
}

// Rejects a tool request that falls outside the active permission tier or safety profile.
export function assertAllowedTool(toolName) {
  const tool = TOOL_BY_NAME[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  if (!tool.internal) {
    const moduleKey = String(tool.module || '').toLowerCase();
    if (!ALLOWED_MODULES.has(moduleKey)) {
      throw new Error(`Tool module is not allowed: ${tool.module}`);
    }
  }

  return tool;
}
