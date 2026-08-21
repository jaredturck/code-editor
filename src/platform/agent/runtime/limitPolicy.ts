// @ts-nocheck
/**
 * Controls step, timeout, and extension behavior for long-running agent sessions. It turns
 * limit conditions into user-facing choices rather than silently abandoning productive
 * work.
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
} = Object.assign({}, config, continuity, todoTrace, capabilityPolicy, webSearchPolicy);

/**
 * Maps the different labels an approval UI or model may return onto the small set of limit
 * decisions understood by the runtime. This keeps continue, extend, unlimited, and deny
 * behavior consistent across approval sources.
 */

export function normalizeApprovalDecisionToken(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  if (!token) return '';

  if (['approve', 'approved', 'allow', 'grant', 'yes', 'ok', 'proceed'].includes(token))
    return 'approve';
  if (['continue', 'continue_once', 'continue-once', 'once', 'retry'].includes(token))
    return 'continue';
  if (
    ['extend', 'extend_budget', 'extend-budget', 'increase_budget', 'more_budget'].includes(token)
  )
    return 'extend';
  if (
    [
      'unlimited',
      'unlimited_session',
      'unlimited-for-session',
      'no_limits',
      'disable_limits',
    ].includes(token)
  )
    return 'unlimited';
  if (['deny', 'denied', 'disapprove', 'reject', 'stop', 'no'].includes(token)) return 'deny';

  return token;
}

/**
 * Converts a raw limit-approval response into the runtime's decision plus optional budget
 * changes. Missing or malformed responses fail closed so a timed-out approval cannot
 * silently grant more work.
 */

export function normalizeApprovalResponse(rawResponse) {
  if (rawResponse && typeof rawResponse === 'object') {
    const decision = normalizeApprovalDecisionToken(
      rawResponse.decision || rawResponse.choice || rawResponse.selection || rawResponse.action,
    );

    const approved =
      rawResponse.approved === true ||
      ['approve', 'continue', 'extend', 'unlimited'].includes(decision);

    return {
      approved,
      decision: decision || (approved ? 'approve' : 'deny'),
    };
  }

  if (typeof rawResponse === 'string') {
    const decision = normalizeApprovalDecisionToken(rawResponse);
    const approved = ['approve', 'continue', 'extend', 'unlimited'].includes(decision);
    return {
      approved,
      decision: decision || (approved ? 'approve' : 'deny'),
    };
  }

  const approved = Boolean(rawResponse);
  return {
    approved,
    decision: approved ? 'approve' : 'deny',
  };
}

// Determines whether the classify limit issue for the agent session runtime.
export function classifyLimitIssue({ toolName, message }) {
  const tool = String(toolName || '').trim();
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  if (!lower) return null;

  if (tool === 'search.web' && lower.includes('budget reached')) {
    const budgetMatch = raw.match(/\((\d+)\s*\/\s*(\d+)\)/);
    return {
      kind: 'search_budget',
      label: 'search budget',
      context: {
        callsUsed: budgetMatch ? Number(budgetMatch[1]) : null,
        callBudget: budgetMatch ? Number(budgetMatch[2]) : null,
      },
    };
  }

  if (lower.includes('timed out after') || lower.includes('timeout')) {
    return {
      kind: 'tool_timeout',
      label: 'tool timeout',
      context: {},
    };
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('429') ||
    lower.includes('throttl')
  ) {
    const waitSecondsMatch = lower.match(/retry in(?: about)?\s+(\d+)s/);
    const retryAfterMs = waitSecondsMatch ? Math.max(0, Number(waitSecondsMatch[1]) * 1000) : 0;

    return {
      kind: 'rate_limit',
      label: 'rate limit',
      context: {
        retryAfterMs,
      },
    };
  }

  if (
    lower.includes('limit reached') ||
    lower.includes('budget exceeded') ||
    lower.includes('max limit') ||
    lower.includes('exceeded maximum')
  ) {
    return {
      kind: 'generic_limit',
      label: 'runtime limit',
      context: {},
    };
  }

  return null;
}

// Assembles limit decision options from lower-level state so callers receive one consistent
// representation.
export function buildLimitDecisionOptions(limitKind) {
  const kind = String(limitKind || '').toLowerCase();

  const continueLabel = kind === 'step_budget' ? 'Continue task' : 'Continue once';
  const continueDescription =
    kind === 'step_budget'
      ? 'Allow one more planning step and continue this task.'
      : 'Retry now with the minimum extra budget needed.';

  const extendLabel = kind === 'tool_timeout' ? 'Extend timeout' : 'Extend budget';
  const extendDescription =
    kind === 'step_budget'
      ? `Add ${SESSION_STEP_BUDGET_EXTEND_INCREMENT} more steps for this run.`
      : 'Increase the current limit and keep going.';

  const recommended = kind === 'step_budget' ? 'extend' : 'continue';

  return [
    {
      id: 'continue',
      label: continueLabel,
      description: continueDescription,
      recommended: recommended === 'continue',
    },
    {
      id: 'extend',
      label: extendLabel,
      description: extendDescription,
      recommended: recommended === 'extend',
    },
    {
      id: 'unlimited',
      label: 'Unlimited session',
      description: 'Use high session limits for this run.',
      recommended: false,
    },
    {
      id: 'deny',
      label: 'Disapprove',
      description: 'Stop extending limits and continue with current constraints.',
      recommended: false,
    },
  ];
}

// Selects or derives tool timeout ms from the available settings, input, and runtime context.
export function resolveToolTimeoutMs(toolName) {
  return getCatalogToolTimeoutMs(toolName);
}

/**
 * Runs with timeout from initialization through completion, including its cleanup behavior.
 */

export async function runWithTimeout(promise, timeoutMs, message) {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => {
        reject(new Error(message));
      },
      Math.max(1000, Number(timeoutMs) || DEFAULT_TOOL_TIMEOUT_MS),
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Waits for milliseconds without allowing the surrounding workflow to wait indefinitely.
export async function waitMs(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (!ms) return;

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Assembles find fallback paths from lower-level state so callers receive one consistent
// representation.
export function buildFindFallbackPaths(pathInput, { includeGlobalFallback = false } = {}) {
  const rawPath = String(pathInput || '').trim();
  if (!rawPath) return [];

  const fallbackPaths = [];

  if ((rawPath === '.' || rawPath === './') && includeGlobalFallback) {
    fallbackPaths.push('~/Documents');
    fallbackPaths.push('~');
    return dedupeStrings(fallbackPaths);
  }

  if (rawPath === '.' || rawPath === './') return [];

  const leaf =
    rawPath
      .split(/[\\/]+/g)
      .filter(Boolean)
      .pop() || rawPath;
  const leafToken = normalizePathToken(leaf);

  if (DOCUMENTS_ALIAS_TOKENS.has(leafToken)) {
    fallbackPaths.push('~/Documents');
  }

  if (isLikelyRelativePath(rawPath)) {
    fallbackPaths.push(`~/Documents/${rawPath}`);
    fallbackPaths.push(`~/${rawPath}`);
  }

  return dedupeStrings(fallbackPaths);
}

// The agent's filesystem root. Defaults to the user's home (~) so the assistant
// searches the whole home dir by default; narrowed to a working directory when
// the user sets one with the /dir chat command (settings.agent_working_dir).
