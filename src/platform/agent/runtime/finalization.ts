// @ts-nocheck
/**
 * Converts the completed session state into the final assistant reply, controller payload,
 * and run summary. It handles incomplete-looking answers and preserves usage, todo, trace,
 * and reward information.
 */

// Transitional extraction: behavior is preserved verbatim while runtime contracts are typed incrementally.
import { UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security';
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

import * as runtimeSupport from '@/platform/agent/runtime/runtimeSupport';
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
  normalizeTodoStatus,
  normalizeTodo,
  summarizeRequestForTodo,
  buildSeedTodos,
  formatDateKey,
  formatTimeKey,
  cleanSingleLine,
  isResumeIntent,
  getContinuityContext,
  shouldPersistContinuityNote,
  deriveContinuityTags,
  buildStepHistoryLabel,
  persistContinuityNote,
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
  resolveAgentRootBase,
  applyAgentRoot,
  assertSafePath,
  assertSafeCommand,
  assertAllowedTool,
} = runtimeSupport;

// Determines whether the final reply incorrectly claims that no user request was provided.
export function looksLikeMissingRequestReply(text, userInput) {
  const latestRequest = String(userInput || '').trim();
  if (!latestRequest) return false;

  const reply = String(text || '').toLowerCase();
  if (!reply) return false;

  const missingRequestSignals = [
    /has not provided (any )?(specific )?(request|task|context|instruction)/,
    /no specific (request|task|context|instruction)/,
    /no (actual )?(request|task|instruction)/,
    /without (a )?(specific )?(request|task|context|instruction)/,
  ];

  const clarificationSignals = [
    /ask(ing)? (the )?user (for )?(clarification|details)/,
    /ask the user what they would like me to do/,
    /please provide (the )?(details|specifics) of (the )?(task|problem|request|instruction)/,
    /please provide .*?(task|problem|request).*?(details|you need solved|you are working with)/,
    /how can i help/,
    /what would you like me to do/,
    /i will respond by/,
    /self-correction/,
  ];

  const claimsMissingRequest = missingRequestSignals.some((pattern) => pattern.test(reply));
  if (!claimsMissingRequest) return false;

  return clarificationSignals.some((pattern) => pattern.test(reply));
}

// Synthesizes final reply from the completed agent steps and available result data.
export async function synthesizeFinalReply({
  userInput,
  conversation,
  stepHistory,
  capabilitySnapshot,
  capabilityBlocked = false,
  disallowCapabilityClaims = false,
  requestAI,
}) {
  const condensedHistory = stepHistory.length
    ? stepHistory
        .slice(-10)
        .map((item) => `- ${item.tool}: ${item.ok ? item.summary : `error ${item.error}`}`)
        .join('\n')
    : '- No tools were executed.';

  const capabilityHint = Array.isArray(capabilitySnapshot?.availableTools)
    ? capabilitySnapshot.availableTools.join(', ')
    : '';

  const messages = [
    {
      role: 'system',
      content: [
        'You are IRIS. Provide a concise, direct response grounded in available tool results.',
        UNTRUSTED_CONTENT_SYSTEM_RULES,
        disallowCapabilityClaims
          ? 'Do not claim missing tools or permissions in this reply. Describe what happened and provide a concrete next step.'
          : capabilityBlocked
            ? `If permissions or tool availability prevent completion, use this exact sentence first: "${INSUFFICIENT_ACCESS_REPLY}".`
            : 'Only mention permission/tool limitations when explicit tool errors indicate capability restrictions.',
        'The latest user request is already provided below. Do not claim the user gave no request unless that request is empty.',
        'Do not return JSON, tool schemas, or controller actions. Respond in plain natural language only.',
      ].join(' '),
    },
    ...conversation.slice(-6).map((message) => ({
      role: message.role,
      content: trimMessageContent(message.content),
    })),
    {
      role: 'user',
      content: [
        `Latest user request: ${userInput}`,
        `Tool summary:\n${condensedHistory}`,
        `Available tools: ${capabilityHint || 'unknown'}`,
        `Capability blocked in this run: ${capabilityBlocked ? 'yes' : 'no'}`,
        'Respond to the user now.',
      ].join('\n\n'),
    },
  ];

  const synthesized = String((await requestAI(messages)) || '').trim();
  if (synthesized) return synthesized;

  // The model produced nothing — never hand back an empty final. Summarize what
  // actually happened so the run ends with a useful, honest reply rather than dead air.
  const okSteps = stepHistory.filter((s) => s.ok);
  if (okSteps.length) {
    const last = okSteps[okSteps.length - 1];
    return `I worked through ${stepHistory.length} step(s) (${okSteps.length} successful) but couldn't compose a full summary. Latest result: ${String(
      last.summary || last.tool || 'completed a step',
    ).slice(0, 400)}. Tell me how you'd like to proceed.`;
  }
  return 'I could not produce a complete answer this time. Could you rephrase or add a bit more detail so I can try again?';
}

// Assembles controller payload from lower-level state so callers receive one consistent
// representation.
export function buildControllerPayload({
  userInput,
  conversation,
  todos,
  stepHistory,
  stepIndex,
  skillContext,
  continuityContext,
  relevantMemory = [],
  chatMemory = '',
  webSearchState,
  safetyConfig,
  sessionStepBudget,
  userApprovalGranted,
  capabilitySnapshot,
  toolset = 'structured',
}) {
  return {
    user_request: userInput,
    // No step counter is surfaced to the model (it confuses pacing); the runtime owns
    // pacing via the duration budget. previous_steps below is real action history, not a count.
    recent_messages: conversation.slice(-8).map((message) => ({
      role: message.role,
      content: trimMessageContent(message.content),
    })),
    todos,
    previous_steps: stepHistory.slice(-8),
    // Advertise tools that are immediately available plus tools whose only missing
    // requirement is a user permission grant. The broker still enforces the role tier and
    // pauses requestable tools for the persistent permission popup before execution.
    // In the 'lean' toolset (W2) the redundant files.*/search.* helpers remain hidden.
    tools: TOOL_DEFINITIONS.filter((tool) => {
      const alwaysOn = tool.name === 'todo.update' || tool.name === 'trace.log';
      const advertisedTools = Array.isArray(capabilitySnapshot?.advertisedTools)
        ? capabilitySnapshot.advertisedTools
        : capabilitySnapshot?.availableTools;
      const allowed =
        alwaysOn || (Array.isArray(advertisedTools) && advertisedTools.includes(tool.name));
      if (!allowed) return false;
      if (toolset === 'lean' && !alwaysOn) return isLeanTool(tool.name);
      return true;
    }).map((tool) => ({
      name: tool.name,
      module: tool.module,
      internal: Boolean(tool.internal),
      description: tool.description,
      args: tool.args,
    })),
    skills: {
      enabled: Boolean(skillContext?.enabled),
      profile: skillContext?.profile || '',
      token_budget: Number(skillContext?.tokenBudget || 0),
      max_active: Number(skillContext?.maxActive || 0),
      tokens_used: Number(skillContext?.tokensUsed || 0),
      available: Number(skillContext?.available || 0),
      cards: Array.isArray(skillContext?.cards) ? skillContext.cards : [],
      active_skills: Array.isArray(skillContext?.active)
        ? skillContext.active.map((skill) => ({
            id: skill.id,
            title: skill.title,
            summary: skill.summary,
            triggers: skill.triggers,
            instructions: skill.instructions,
            examples: skill.examples,
          }))
        : [],
    },
    // Relevance-gated recall: only the durable notes that actually relate to this
    // request (recallRelevantNotes), plus whether it's an explicit resume. No
    // daily-blob injection — memory reaches the model only when it's relevant.
    relevant_memory: {
      resume_intent: Boolean(continuityContext?.resumeIntent),
      notes: Array.isArray(relevantMemory) ? relevantMemory : [],
    },
    // The chat's durable encrypted memory — always surfaced so the agent keeps
    // sight of the plan; maintained via chat.remember; earlier history via chat.recall.
    chat_memory: String(chatMemory || ''),
    memory_hygiene: {
      web_search_calls_used: Number.isFinite(Number(webSearchState?.callsUsed))
        ? Number(webSearchState.callsUsed)
        : 0,
      web_search_call_budget: Number.isFinite(Number(webSearchState?.maxCalls))
        ? Number(webSearchState.maxCalls)
        : SEARCH_WEB_DEFAULT_CALL_BUDGET,
      web_search_calls_remaining: Number.isFinite(Number(webSearchState?.maxCalls))
        ? Math.max(0, Number(webSearchState.maxCalls) - Number(webSearchState?.callsUsed || 0))
        : SEARCH_WEB_DEFAULT_CALL_BUDGET,
      web_search_recent_queries: Array.isArray(webSearchState?.queryHistory)
        ? webSearchState.queryHistory.slice(0, 6)
        : [],
    },
    // The full capability snapshot is no longer serialized into every per-step payload —
    // it was the largest redundant chunk. `tools` above already lists what's available;
    // a tool/permission limit is surfaced only when a call is actually blocked
    // (capabilityPolicy). This is the A5/A6 per-step token cut.
    // The controller output schema + json-only / one-tool-per-step rules now
    // live in the system prompt (agent/controllerPrompt.js, 'structured' tier),
    // so they are no longer re-narrated in every per-step payload.
    constraints: {
      guardrails: {
        safety_profile: safetyConfig?.profile || 'strict',
        block_sudo: safetyConfig?.blockSudo !== false,
        allow_network_commands: Boolean(safetyConfig?.allowNetworkCommands),
        require_explicit_approval: Boolean(safetyConfig?.requireExplicitApproval),
        user_approved_for_risky_tools: Boolean(userApprovalGranted),
        max_steps: Number.isFinite(Number(sessionStepBudget))
          ? Number(sessionStepBudget)
          : Number.isFinite(Number(safetyConfig?.maxSteps))
            ? Number(safetyConfig.maxSteps)
            : MAX_AGENT_STEPS,
      },
    },
  };
}

// Assembles run summary from lower-level state so callers receive one consistent representation.
export function buildRunSummary({
  timeline,
  stepHistory,
  startedAt,
  skillContext,
  safetyConfig,
  userApprovalGranted,
  usage,
}) {
  const toolCalls = timeline.filter((event) => event.type === 'tool_call').length;
  const toolResults = timeline.filter((event) => event.type === 'tool_result');
  const toolSuccesses = toolResults.filter((event) => event.status === 'ok').length;
  const toolFailures = toolResults.filter((event) => event.status !== 'ok').length;
  const capabilityBlocks = stepHistory.filter(
    (step) => !step.ok && isCapabilityOrPermissionError(step.error),
  ).length;
  const toolRetries = stepHistory.filter((step) => step.retried).length;
  // Invalid-argument failures → a signal that a tool's description/schema needs
  // sharpening (per Anthropic's "analyze tool-calling metrics" guidance).
  const invalidArgErrors = stepHistory.filter(
    (step) =>
      !step.ok &&
      /invalid|argument|required|missing|schema|expected|must be|parse/i.test(
        String(step.error || ''),
      ),
  ).length;
  // Consecutive same-tool calls — a proxy for redundant/thrashing tool use.
  let redundantToolCalls = 0;
  for (let i = 1; i < stepHistory.length; i += 1) {
    if (stepHistory[i]?.tool && stepHistory[i].tool === stepHistory[i - 1]?.tool)
      redundantToolCalls += 1;
  }

  return {
    durationMs: Math.max(0, Date.now() - startedAt),
    stepsAttempted: stepHistory.length,
    toolCalls,
    toolSuccesses,
    toolFailures,
    capabilityBlocks,
    toolRetries,
    invalidArgErrors,
    redundantToolCalls,
    todoUpdates: timeline.filter((event) => event.type === 'todo').length,
    thinkingEvents: timeline.filter((event) => event.type === 'thinking').length,
    skillsProfile: skillContext?.profile || '',
    activeSkills: Array.isArray(skillContext?.active) ? skillContext.active.length : 0,
    safetyProfile: safetyConfig?.profile || 'strict',
    networkCommandsAllowed: Boolean(safetyConfig?.allowNetworkCommands),
    sudoBlocked: safetyConfig?.blockSudo !== false,
    explicitApprovalRequired: Boolean(safetyConfig?.requireExplicitApproval),
    explicitApprovalGranted: Boolean(userApprovalGranted),
    stepBudget: Number.isFinite(Number(safetyConfig?.maxSteps))
      ? Number(safetyConfig.maxSteps)
      : MAX_AGENT_STEPS,
    usage: usage || buildUsageSummary(null),
  };
}
