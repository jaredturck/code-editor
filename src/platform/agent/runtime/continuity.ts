// @ts-nocheck
/**
 * Implements the continuity portion of an agent session. It is separated from the session
 * runner so policy, continuity, limits, tools, and finalization can be reasoned about
 * independently.
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
} = Object.assign({}, config);

// Formats date key for stable display or serialization without changing its underlying meaning.
export function formatDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Formats time key for stable display or serialization without changing its underlying meaning.
export function formatTimeKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Normalizes text into one bounded line before it is stored as continuity metadata.
export function cleanSingleLine(text, maxLength = 200) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

// Evaluates whether is resume intent for the supplied value and current runtime state.
export function isResumeIntent(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;

  return [
    /\b(start\s+up\s+this\s+again)\b/i,
    /\b(resume|continue)\b.{0,40}\b(again|where\s+we\s+left\s+off|last\s+time)\b/i,
    /\b(pick\s+up\s+where\s+we\s+left\s+off)\b/i,
  ].some((pattern) => pattern.test(value));
}

// Notes review cadence (the periodic forced notes.list) was removed in Phase B:
// relevance-gated recall now surfaces only notes that relate to the current
// request, so there is nothing to "periodically review". See recallRelevantNotes.

// Continuity context is now minimal: whether this is an explicit resume, and
// today's date key for titling per-task continuity notes. What memory the model
// actually SEES is decided by relevance-gated recall (recallRelevantNotes), not by
// a daily-blob injection keyed off prompt length / conversation depth.
export function getContinuityContext({ userInput }) {
  return {
    resumeIntent: isResumeIntent(userInput),
    dateKey: formatDateKey(),
  };
}

// Evaluates whether should persist continuity note for the supplied value and current runtime
// state.
export function shouldPersistContinuityNote({
  userInput,
  stepHistory,
  continuityContext,
  chatMemoryActive = false,
}) {
  // Continuity now lives in the per-chat chat_memory (memory.md) the agent maintains
  // via chat.remember, plus the persisted transcript. So a cross-session continuity
  // NOTE is only worth writing when (a) the user is explicitly resuming earlier work,
  // or (b) there is NO chat session to hold the continuity (chat persistence off) and
  // the task was a genuine multi-step effort. When a chat session is active we skip the
  // note (except on resume) — that terse request/outcome blob was redundant with
  // chat_memory and only added recall noise.
  if (continuityContext?.resumeIntent) return true;
  if (chatMemoryActive) return false;
  if (!String(userInput || '').trim()) return false;
  const okToolSteps = Array.isArray(stepHistory)
    ? stepHistory.filter((s) => s?.ok && s.tool).length
    : 0;
  return okToolSteps >= 2;
}

// Seed keyword tags for recall from the request text (drops common stopwords).
export function deriveContinuityTags(text, max = 6) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'you',
    'are',
    'can',
    'please',
    'into',
    'from',
    'your',
    'our',
    'has',
    'have',
    'was',
    'were',
    'all',
    'any',
    'now',
    'then',
    'them',
    'they',
    'what',
    'when',
    'how',
    'why',
  ]);
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g) || [],
    ),
  )
    .filter((token) => !stop.has(token))
    .slice(0, max);
}

// Assembles step history label from lower-level state so callers receive one consistent
// representation.
export function buildStepHistoryLabel(stepHistory) {
  if (!Array.isArray(stepHistory) || !stepHistory.length) return 'none';
  const tools = stepHistory
    .filter((step) => step?.ok)
    .map((step) => String(step.tool || '').trim())
    .filter(Boolean);
  if (!tools.length) return 'none';
  return Array.from(new Set(tools)).slice(0, 8).join(', ');
}

// Persists continuity note using the storage contract owned by the agent session runtime.
export function persistContinuityNote({
  userInput,
  reply,
  stepHistory,
  skillContext,
  continuityContext,
  chatMemoryActive = false,
}) {
  if (
    !shouldPersistContinuityNote({ userInput, stepHistory, continuityContext, chatMemoryActive })
  ) {
    return null;
  }

  const dateKey = continuityContext?.dateKey || formatDateKey();
  const timestampLabel = formatTimeKey();
  const requestLine = cleanSingleLine(userInput, 240);
  const replyLine = cleanSingleLine(reply, 280);
  const toolsLine = buildStepHistoryLabel(stepHistory);
  const profile = String(skillContext?.profile || '').trim();
  const tags = deriveContinuityTags(userInput);

  // One note PER TASK (not a daily blob), titled by the request and tagged so
  // recall can later surface only the entries that relate to a new request.
  const content = [
    `CATEGORY: continuity`,
    tags.length ? `TAGS: ${tags.join(', ')}` : '',
    `SUMMARY: ${replyLine || requestLine || 'task'}`,
    '',
    `[${dateKey} ${timestampLabel}] Request: ${requestLine || 'n/a'}`,
    `Outcome: ${replyLine || 'n/a'}`,
    `Tools: ${toolsLine}`,
    profile ? `Skills Profile: ${profile}` : '',
    `Steps: ${Array.isArray(stepHistory) ? stepHistory.length : 0}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, CONTINUITY_NOTE_CHAR_LIMIT);

  const note = addNote({
    title: `Session: ${(requestLine || 'task').slice(0, 60)}`,
    category: 'continuity',
    tags,
    summary: (replyLine || requestLine || 'task').slice(0, 200),
    content,
    color: 'purple',
  });

  // Bound continuity notes so they never crowd out durable user notes.
  try {
    pruneNotesByCategory('continuity', MAX_CONTINUITY_NOTES);
  } catch {
    /* non-fatal */
  }

  return note;
}

// Usage accounting (estimateTokens / createUsageTracker / trackUsageSample /
// buildUsageSummary) moved to @/platform/agent/usageMetrics (imported above) — W5.

// extractKeywords — moved to @/platform/agent/ (imported above)

// normalizeSkill — moved to @/platform/agent/ (imported above)

// scoreSkill — moved to @/platform/agent/ (imported above)

// selectSkillsForPrompt — moved to @/platform/agent/ (imported above)

// // ── Reflex skill injection — moved to @/platform/agent/ (imported above)

// loadSkillContext — moved to @/platform/agent/ (imported above)
