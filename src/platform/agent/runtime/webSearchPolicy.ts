// @ts-nocheck
/**
 * Builds the permitted web-search provider chain, tracks search budgets and caches within a
 * session, and coordinates site-level approval state for web research.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.
import { getKey } from '@/platform/keyStore';
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
} = Object.assign({}, config, continuity, todoTrace, capabilityPolicy);

// Converts path for policy into the canonical representation expected by later code.
export function normalizePathForPolicy(pathInput) {
  return String(pathInput || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

// Converts path token into the canonical representation expected by later code.
export function normalizePathToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Evaluates whether is likely relative path for the supplied value and current runtime state.
export function isLikelyRelativePath(pathInput) {
  const text = String(pathInput || '').trim();
  if (!text) return false;
  if (text.startsWith('/') || text.startsWith('~/') || text === '~') return false;
  return true;
}

// Removes duplicate strings while preserving first-seen order.
export function dedupeStrings(items) {
  const seen = new Set();
  const output = [];

  items.forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    output.push(value);
  });

  return output;
}

// Converts web search query key into the canonical representation expected by later code.
export function normalizeWebSearchQueryKey(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

/**
 * Maps configured web-search provider names and aliases onto the supported provider
 * identifiers used by the bridge. Unknown or empty values are rejected rather than silently
 * selecting an unintended paid service.
 */

export function normalizeWebProviderId(value, fallback = WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  if (!token) return fallback;

  if (token === 'google') return 'google_cse';
  if (token === 'ddg') return 'duckduckgo';

  const known = new Set([
    'duckduckgo',
    'google_cse',
    'tavily',
    'exa',
    'serper',
    'brave',
    'serpapi',
  ]);

  return known.has(token) ? token : fallback;
}

/**
 * Builds an ordered, duplicate-free web-search fallback list from the user's settings. The
 * primary provider stays first while unsupported entries are removed before any research
 * request is attempted.
 */

export function normalizeWebProviderList(
  value,
  fallbackList = WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
) {
  const input = Array.isArray(value) ? value : String(value || '').split(',');

  const seen = new Set();
  const output = [];

  input.forEach((entry) => {
    const providerId = normalizeWebProviderId(entry, '');
    if (!providerId || seen.has(providerId)) return;
    seen.add(providerId);
    output.push(providerId);
  });

  if (output.length) return output;

  const fallbackSeen = new Set();
  return fallbackList
    .map((entry) => normalizeWebProviderId(entry, ''))
    .filter((entry) => {
      if (!entry || fallbackSeen.has(entry)) return false;
      fallbackSeen.add(entry);
      return true;
    });
}

// Converts web provider settings into the canonical representation expected by later code.
export function normalizeWebProviderSettings(settings) {
  return {
    googleCseApiKey: getKey('search-google-cse'),
    googleCseCx: String(settings?.search_web_google_cse_cx || '').trim(),
    tavilyApiKey: getKey('search-tavily'),
    exaApiKey: getKey('search-exa'),
    serperApiKey: getKey('search-serper'),
    serpApiApiKey: getKey('search-serpapi'),
    braveApiKey: getKey('search-brave'),
  };
}

/**
 * Evaluates whether has configured provider credentials for the supplied value and current
 * runtime state.
 */

export function hasConfiguredProviderCredentials(providerId, providerSettings) {
  switch (providerId) {
    case 'duckduckgo':
      return true;
    case 'google_cse':
      return Boolean(providerSettings.googleCseApiKey && providerSettings.googleCseCx);
    case 'tavily':
      return Boolean(providerSettings.tavilyApiKey);
    case 'exa':
      return Boolean(providerSettings.exaApiKey);
    case 'serper':
      return Boolean(providerSettings.serperApiKey);
    case 'brave':
      return Boolean(providerSettings.braveApiKey);
    case 'serpapi':
      return Boolean(providerSettings.serpApiApiKey);
    default:
      return false;
  }
}

// Evaluates whether has configured paid fallback providers for the supplied value and current
// runtime state.
export function hasConfiguredPaidFallbackProviders(providerList, providerSettings) {
  const candidates = Array.isArray(providerList) ? providerList : [];

  return candidates.some((providerId) => {
    if (!WEB_SEARCH_PAID_PROVIDER_IDS.has(providerId)) return false;
    return hasConfiguredProviderCredentials(providerId, providerSettings);
  });
}

// Assembles web search provider policy from lower-level state so callers receive one consistent
// representation.
export function buildWebSearchProviderPolicy(settings, approvalState) {
  const primaryProvider = normalizeWebProviderId(
    settings?.search_web_primary_provider,
    WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER,
  );
  const fallbackProviders = normalizeWebProviderList(
    settings?.search_web_fallback_chain,
    WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
  ).filter((providerId) => providerId !== primaryProvider);

  const requirePaidFallbackConfirmation =
    settings?.search_web_require_paid_fallback_confirmation !== false;
  const allowPaidFallback =
    !requirePaidFallbackConfirmation || Boolean(approvalState?.allowPaidSearchFallback);

  const providerSettings = normalizeWebProviderSettings(settings);

  return {
    providerPolicy: {
      primaryProvider,
      fallbackProviders,
      allowPaidFallback,
    },
    providerSettings,
    requirePaidFallbackConfirmation,
  };
}

// Selects or derives web search call budget from the available settings, input, and runtime
// context.
export function resolveWebSearchCallBudget(settings) {
  const configured = Number(settings?.agent_search_web_budget);
  if (!Number.isFinite(configured)) return SEARCH_WEB_DEFAULT_CALL_BUDGET;
  return Math.max(1, Math.min(SEARCH_WEB_MAX_CALL_BUDGET, Math.round(configured)));
}

// Creates web search session state with the state and dependencies needed by its consumers.
export function createWebSearchSessionState(settings) {
  return {
    maxCalls: resolveWebSearchCallBudget(settings),
    callsUsed: 0,
    queryHistory: [],
    cache: new Map(),
  };
}

// Persists web search query in the durable memory owned by the current chat.
export function rememberWebSearchQuery(state, queryKey) {
  if (!state || !queryKey) return;

  const history = Array.isArray(state.queryHistory) ? state.queryHistory : [];
  const nextHistory = [queryKey, ...history.filter((entry) => entry !== queryKey)].slice(0, 8);
  state.queryHistory = nextHistory;
}

// Returns web search cache without requiring callers to know where or how it is stored.
export function getWebSearchCache(state, queryKey) {
  if (!state || !queryKey) return null;
  if (!(state.cache instanceof Map)) return null;
  return state.cache.get(queryKey) || null;
}

// Changes web search cache and performs any related synchronization required by the feature.
export function setWebSearchCache(state, queryKey, payload) {
  if (!state || !queryKey || !payload) return;
  if (!(state.cache instanceof Map)) return;

  state.cache.set(queryKey, payload);

  if (state.cache.size > 10) {
    const oldestKey = state.cache.keys().next().value;
    if (oldestKey) state.cache.delete(oldestKey);
  }
}
