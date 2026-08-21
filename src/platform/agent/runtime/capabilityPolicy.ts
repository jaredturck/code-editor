// @ts-nocheck
/**
 * Translates settings, permission tiers, model behavior, and request intent into the tools
 * an agent can use. It also detects insufficient-access outcomes and can construct safe
 * fallback actions or explanations.
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
import { isMeshEnabled, isPeerReviewEnabled, isOverwatchEnabled } from '@/platform/agent/meshConductor';
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
} = Object.assign({}, config, continuity, todoTrace);

/**
 * Condenses tree while retaining the information needed by the next stage.
 */

export function summarizeTree(node) {
  if (!node || typeof node !== 'object') {
    return { files: 0, dirs: 0, total: 0, topEntries: [] };
  }

  let files = 0;
  let dirs = 0;

  // Traverses the current structure recursively and accumulates matching entries.
  const walk = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.type === 'dir') {
      dirs += 1;
      (entry.children || []).forEach(walk);
    } else if (entry.type === 'file') {
      files += 1;
    }
  };

  walk(node);

  return {
    files,
    dirs,
    total: files + dirs,
    topEntries: Array.isArray(node.children)
      ? node.children.slice(0, 12).map((child) => child.name)
      : [],
  };
}

// Clamps number to the supported bounds.
export function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

/**
 * Selects or derives safety config from the available settings, input, and runtime context.
 */

export function resolveSafetyConfig(settings, maxSteps) {
  const profile =
    String(settings?.agent_safety_profile || 'strict').toLowerCase() === 'balanced'
      ? 'balanced'
      : 'strict';

  const configuredMaxSteps = clampNumber(
    settings?.agent_max_steps ?? MAX_AGENT_STEPS,
    1,
    AGENT_STEP_HARD_CAP,
  );
  // When the caller doesn't explicitly request a step ceiling, honor the
  // configured (UI) value directly. Previously this defaulted to MAX_AGENT_STEPS,
  // which silently capped every session at 6 regardless of the slider.
  const requestedMaxSteps =
    maxSteps === null || maxSteps === undefined
      ? configuredMaxSteps
      : clampNumber(maxSteps, 1, AGENT_STEP_HARD_CAP);

  // Resolve permission tier — per-role key or global fallback
  const currentRole = (() => {
    try {
      return resolveCurrentRole(settings);
    } catch {
      return 'executor';
    }
  })();
  const perRoleKey = `agent_permission_tier_${currentRole}`;
  const agentTierRaw = settings?.[perRoleKey] ?? settings?.agent_permission_tier;
  const defaultTier =
    currentRole === 'orchestrator'
      ? PERMISSION_TIER.POWER
      : currentRole === 'scout'
        ? PERMISSION_TIER.READ_ONLY
        : PERMISSION_TIER.STANDARD;
  const agentTier = Number.isFinite(Number(agentTierRaw))
    ? Math.max(0, Math.min(3, Number(agentTierRaw)))
    : defaultTier;

  return {
    profile,
    permissionTier: agentTier,
    blockSudo: agentTier < PERMISSION_TIER.POWER || settings?.agent_block_sudo !== false,
    allowNetworkCommands:
      agentTier >= PERMISSION_TIER.POWER
        ? settings?.agent_allow_network_commands !== false
        : settings?.agent_allow_network_commands === true,
    requireExplicitApproval: settings?.agent_require_explicit_approval === true,
    maxSteps: Math.min(configuredMaxSteps, requestedMaxSteps),
    tier0ReadOnly: agentTier === PERMISSION_TIER.LOCKED,
    tier1ReadOnly: agentTier <= PERMISSION_TIER.READ_ONLY,
    tier2BlockedPatterns: agentTier <= PERMISSION_TIER.STANDARD ? TIER_2_BLOCKED_PATTERNS : [],
    tier3ApprovalPatterns: agentTier === PERMISSION_TIER.POWER ? TIER_3_APPROVAL_PATTERNS : [],
    auditLog: agentTier === PERMISSION_TIER.POWER,
  };
}

// Evaluates whether has explicit user approval for the supplied value and current runtime state.
export function hasExplicitUserApproval(userInput) {
  const text = String(userInput || '').toLowerCase();
  if (!text) return false;
  return /\b(approve|approved|approval|go ahead|proceed|run it|execute it|yes run)\b/.test(text);
}

/**
 * Infers tool name from alias key when the caller has not supplied an explicit value.
 */

export function inferToolNameFromAliasKey(aliasKey) {
  const tokens = String(aliasKey || '')
    .split(/[_.]+/g)
    .filter(Boolean);
  if (!tokens.length) return '';

  const has = (...values) => values.some((value) => tokens.includes(value));

  if (
    has(
      'resource',
      'resources',
      'capability',
      'capabilities',
      'permission',
      'permissions',
      'tools',
      'tooling',
    )
  ) {
    return 'resources.list';
  }

  if (has('read', 'open', 'cat') && has('file', 'files', 'path', 'document', 'text')) {
    return 'files.read';
  }

  if (
    has('find', 'locate', 'match', 'regex', 'grep', 'pattern') &&
    has(
      'file',
      'files',
      'dir',
      'dirs',
      'directory',
      'folder',
      'folders',
      'path',
      'workspace',
      'text',
      'content',
    )
  ) {
    return 'files.find';
  }

  if (
    has('list', 'scan', 'tree', 'show') &&
    has('file', 'files', 'dir', 'dirs', 'directory', 'folder', 'folders', 'path', 'workspace')
  ) {
    return 'files.list';
  }

  if (
    has('write', 'save', 'create', 'append', 'edit', 'update') &&
    has('file', 'files', 'path', 'document', 'text')
  ) {
    return 'files.write';
  }

  if (has('terminal', 'shell', 'command', 'cmd', 'bash', 'sh', 'exec', 'execute', 'run')) {
    return 'terminal.exec';
  }

  if (has('search', 'web', 'lookup', 'research', 'google', 'bing')) {
    return 'search.web';
  }

  if (
    has('screen', 'display', 'automation', 'vision') &&
    has('capability', 'capabilities', 'check', 'status')
  ) {
    return 'screen.capabilities';
  }

  if (
    has('launch', 'start', 'open') &&
    has('app', 'application', 'program', 'command', 'script', 'url')
  ) {
    return 'launch.run';
  }

  if (
    has('approval', 'approve', 'permission', 'permissions') &&
    has('request', 'ask', 'prompt', 'confirm')
  ) {
    return 'approval.request';
  }

  if (has('skill', 'skills') && has('list', 'show', 'all')) {
    return 'skills.list';
  }

  if (has('notes', 'note') && has('list', 'show', 'all')) {
    return 'notes.list';
  }

  if (has('notes', 'note') && has('add', 'create', 'new')) {
    return 'notes.add';
  }

  if (has('notes', 'note') && has('update', 'edit', 'rename')) {
    return 'notes.update';
  }

  if (has('notes', 'note') && has('delete', 'remove')) {
    return 'notes.delete';
  }

  return '';
}

/**
 * Selects or derives tool request from the available settings, input, and runtime context.
 */

export function resolveToolRequest(requestedName) {
  const requested = String(requestedName || '').trim();
  if (!requested) {
    return {
      requested,
      resolved: '',
      matchedBy: 'none',
      error: 'Tool name is empty.',
    };
  }

  const catalogMatch = resolveCatalogToolRequest(requested);
  if (catalogMatch.resolved) {
    return {
      requested,
      resolved: catalogMatch.resolved,
      matchedBy: catalogMatch.matchedBy,
      error: '',
    };
  }

  const aliasKey = normalizeToolAliasKey(requested);
  const heuristicResolved = inferToolNameFromAliasKey(aliasKey);
  if (heuristicResolved && TOOL_BY_NAME[heuristicResolved]) {
    return {
      requested,
      resolved: heuristicResolved,
      matchedBy: 'heuristic',
      error: '',
    };
  }

  return {
    requested,
    resolved: '',
    matchedBy: 'none',
    error: `Unknown tool: ${requested}`,
  };
}

// Evaluates tool access to choose the result used by the agent session runtime.
export function evaluateToolAccess(
  toolName,
  { settings, safetyConfig, userApprovalGranted, sessionPermissionOverrides = null },
) {
  const name = String(toolName || '').trim();
  const tool = TOOL_BY_NAME[name];
  const sessionPermissions = sessionPermissionOverrides || {};

  if (!tool) {
    return {
      available: false,
      reason: `Tool is not defined: ${name}`,
      code: 'tool_not_defined',
      permissionKey: null,
    };
  }

  // Tagged-model-mesh tools (Workstream D) are advertised ONLY when the communication
  // bridge AND peer consultation are both enabled — so models never see them in a
  // single-model session. (Existing agent.delegate/* are gated at the broker by role.)
  if ((name === 'agent.find' || name === 'agent.consult') && !isMeshEnabled(settings)) {
    return {
      available: false,
      reason: 'Peer consultation is disabled. Enable it in Settings → Agents.',
      code: 'mesh_disabled',
      permissionKey: null,
    };
  }
  if (name === 'agent.review' && !isPeerReviewEnabled(settings)) {
    return {
      available: false,
      reason:
        'Multi-model peer review is off. Enable the bridge and set agent_peer_review in Settings → Agents.',
      code: 'review_disabled',
      permissionKey: null,
    };
  }
  if (name === 'agent.overwatch' && !isOverwatchEnabled(settings)) {
    return {
      available: false,
      reason:
        'No Overwatcher is configured. Assign a reasoning model to the Overwatcher role in Settings → Agents.',
      code: 'overwatch_disabled',
      permissionKey: null,
    };
  }

  if (!tool.internal) {
    const moduleKey = String(tool.module || '').toLowerCase();
    if (!ALLOWED_MODULES.has(moduleKey)) {
      return {
        available: false,
        reason: `Tool module is not allowed: ${tool.module}`,
        code: 'module_not_allowed',
        permissionKey: null,
      };
    }
  }

  const permissionKey = getToolPermissionKey(name);
  const permissionEnabled = {
    file_read: settings?.permissions_file_read === true || sessionPermissions.file_read === true,
    file_write: settings?.permissions_file_write === true || sessionPermissions.file_write === true,
    terminal_exec:
      settings?.permissions_terminal === true || sessionPermissions.terminal_exec === true,
  };
  const permissionReasons = {
    file_read: 'File System Read permission is disabled.',
    file_write: 'File System Write permission is disabled.',
    terminal_exec: 'Terminal Execution permission is disabled.',
  };

  if (permissionKey && permissionEnabled[permissionKey] !== true) {
    return {
      available: false,
      reason: permissionReasons[permissionKey] || `Permission is disabled for ${name}.`,
      code: 'permission_required',
      permissionKey,
    };
  }

  if (safetyConfig?.requireExplicitApproval && isToolRisky(name) && !userApprovalGranted) {
    return {
      available: false,
      reason: `Explicit approval is required for ${name} in this request.`,
      code: 'explicit_approval_required',
      permissionKey: null,
    };
  }

  return { available: true, reason: '', code: 'available', permissionKey };
}

/**
 * Summarizes the session’s effective permissions and tools so runtime decisions and prompts
 * use the same view of access.
 */

export function buildCapabilitySnapshot({
  settings,
  safetyConfig,
  userApprovalGranted,
  sessionPermissionOverrides = null,
}) {
  const sessionPermissions = sessionPermissionOverrides || {};
  const provider = String(settings?.ai_provider || 'unknown');
  const executionMode =
    provider === 'local' ? 'local-model-with-local-tools' : 'cloud-model-with-local-tools';

  const permissions = {
    file_read: settings?.permissions_file_read === true || sessionPermissions.file_read === true,
    file_write: settings?.permissions_file_write === true || sessionPermissions.file_write === true,
    terminal_exec:
      settings?.permissions_terminal === true || sessionPermissions.terminal_exec === true,
    screen_capture: settings?.permissions_screen_capture === true,
    mouse_control: settings?.permissions_mouse_control === true,
  };

  const tools = TOOL_DEFINITIONS.filter(
    (tool) => tool.name !== 'todo.update' && tool.name !== 'trace.log',
  ).map((tool) => {
    const access = evaluateToolAccess(tool.name, {
      settings,
      safetyConfig,
      userApprovalGranted,
      sessionPermissionOverrides: sessionPermissions,
    });
    return {
      name: tool.name,
      module: tool.module,
      description: tool.description,
      args: tool.args,
      risky: isToolRisky(tool.name),
      available: access.available,
      requestable: access.code === 'permission_required',
      permissionKey: access.permissionKey || null,
      reason: access.reason,
    };
  });

  const availableTools = tools.filter((tool) => tool.available).map((tool) => tool.name);
  const requestableTools = tools.filter((tool) => tool.requestable).map((tool) => tool.name);
  const advertisedTools = Array.from(new Set([...availableTools, ...requestableTools]));
  const unavailableTools = tools
    .filter((tool) => !tool.available)
    .map((tool) => ({
      name: tool.name,
      reason: tool.reason,
      requestable: tool.requestable,
      permissionKey: tool.permissionKey,
    }));

  return {
    provider,
    executionMode,
    permissions,
    safety: {
      profile: safetyConfig?.profile || 'strict',
      block_sudo: safetyConfig?.blockSudo !== false,
      allow_network_commands: Boolean(safetyConfig?.allowNetworkCommands),
      require_explicit_approval: Boolean(safetyConfig?.requireExplicitApproval),
      user_approved_for_risky_tools: Boolean(userApprovalGranted),
      max_steps: Number(safetyConfig?.maxSteps || MAX_AGENT_STEPS),
    },
    availableTools,
    requestableTools,
    advertisedTools,
    unavailableTools,
    tools,
  };
}

/**
 * Evaluates whether is capability or permission error for the supplied value and current
 * runtime state.
 */

export function isCapabilityOrPermissionError(message) {
  const text = String(message || '').toLowerCase();
  if (!text) return false;

  return [
    'permission is disabled',
    'permission denied',
    'tool module is not allowed',
    'explicit approval required',
    'explicit approval is required',
    'approval denied',
    'blocked by safety',
    'commands using sudo are blocked',
    'network-related commands are blocked',
    'pipe-to-shell execution is not allowed',
    'read path blocked by strict safety profile',
    'write path blocked by strict safety profile',
    'path traversal is blocked by strict safety profile',
  ].some((fragment) => text.includes(fragment));
}

// Evaluates whether is missing path error for the supplied value and current runtime state.
export function isMissingPathError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('enoent') || text.includes('no such file or directory');
}

// Assembles insufficient access reply from lower-level state so callers receive one consistent
// representation.
export function buildInsufficientAccessReply(stepHistory, capabilitySnapshot) {
  const blocked = Array.isArray(stepHistory)
    ? stepHistory.filter((step) => !step.ok && isCapabilityOrPermissionError(step.error)).slice(-4)
    : [];

  if (!blocked.length) return '';

  const reasons = Array.from(
    new Set(blocked.map((step) => String(step.error || '').trim()).filter(Boolean)),
  );

  const available = Array.isArray(capabilitySnapshot?.availableTools)
    ? capabilitySnapshot.availableTools.slice(0, 8)
    : [];

  const reasonText = reasons.length ? ` Details: ${reasons.join(' ')}` : '';
  const availableText = available.length ? ` Available tools: ${available.join(', ')}.` : '';

  return `${INSUFFICIENT_ACCESS_REPLY}${availableText}${reasonText}`;
}

// Determines whether a model reply indicates that required tools or permissions were unavailable.
export function looksLikeInsufficientAccessReply(text) {
  const value = String(text || '')
    .trim()
    .toLowerCase();
  if (!value) return false;
  return value.includes(INSUFFICIENT_ACCESS_REPLY.toLowerCase());
}

// Determines whether a model reply is reporting a tool-access limitation rather than completing the
// task.
export function looksLikeToolAccessLimitationReply(text) {
  const value = String(text || '')
    .trim()
    .toLowerCase();
  if (!value) return false;

  if (looksLikeInsufficientAccessReply(value)) {
    return true;
  }

  return [
    /\b(?:i|we)\s+(?:do\s+not|don't|cannot|can't|am\s+unable\s+to|lack)\s+(?:have\s+)?(?:access|permission|permissions)\b.{0,70}\b(?:tool|tools|filesystem|file\s+system|terminal|command|commands)\b/,
    /\b(?:no|without)\s+(?:access|permissions?)\b.{0,50}\b(?:tool|tools|filesystem|terminal|command|commands)\b/,
    /\bcan't\s+use\s+(?:any\s+)?tools?\b/,
    /\bdo\s+not\s+have\s+(?:any\s+)?tools?\b/,
    /\b(?:i|we)\s+(?:cannot|can't|am\s+unable\s+to|do\s+not)\s+(?:directly\s+)?(?:open|launch|start|run|execute)\s+(?:software|applications?|apps?|programs?)\b/,
    /\b(?:i|we)\s+(?:cannot|can't|do\s+not)\s+(?:directly\s+)?(?:control|access)\s+(?:your\s+)?(?:computer|system|device)\b/,
  ].some((pattern) => pattern.test(value));
}

// Evaluates whether is imperative action request for the supplied value and current runtime state.
export function isImperativeActionRequest(userInput) {
  const text = String(userInput || '')
    .trim()
    .toLowerCase();
  if (!text) return false;

  return /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:open|launch|start|run|execute|exec|list|find|search|read|write|create|delete|update|show|check|inspect|locate)\b/.test(
    text,
  );
}

// Finds launch target from request within a larger input for later policy or presentation logic.
export function extractLaunchTargetFromRequest(userInput) {
  const text = String(userInput || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  const match = text.match(
    /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:open|launch|start|run|execute|exec)\s+(?:the\s+)?(.+)$/i,
  );
  if (!match?.[1]) return '';

  return match[1]
    .replace(/\b(for\s+me|please)\b/gi, '')
    .replace(/[.?!]+$/g, '')
    .trim();
}

// Escapes single quoted shell arg for safe use in its target representation.
export function escapeSingleQuotedShellArg(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

// Assembles executable probe command from lower-level state so callers receive one consistent
// representation.
export function buildExecutableProbeCommand(targetText) {
  const target = String(targetText || '')
    .toLowerCase()
    .trim();
  if (!target) return '';

  const tokens = target
    .split(/[^a-z0-9._-]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (!tokens.length) return '';

  const phrase = tokens.join(' ');
  const candidates = Array.from(
    new Set(
      [
        phrase,
        phrase.replace(/\s+/g, ''),
        phrase.replace(/\s+/g, '-'),
        phrase.replace(/\s+/g, '_'),
        tokens[tokens.length - 1],
        tokens[0],
        ...tokens,
      ]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate && candidate.length >= 2 && candidate.length <= 40),
    ),
  );

  if (!candidates.length) return '';

  const quotedCandidates = candidates
    .map((candidate) => escapeSingleQuotedShellArg(candidate))
    .join(' ');
  return `for c in ${quotedCandidates}; do if command -v "$c" >/dev/null 2>&1; then echo "$c"; break; fi; done`;
}

// Builds a conservative fallback tool action when a required-tool response cannot be parsed.
export function fallbackForcedToolAction(userInput, capabilitySnapshot) {
  const text = String(userInput || '')
    .trim()
    .toLowerCase();
  const availableTools = new Set(
    Array.isArray(capabilitySnapshot?.advertisedTools)
      ? capabilitySnapshot.advertisedTools
      : Array.isArray(capabilitySnapshot?.availableTools)
        ? capabilitySnapshot.availableTools
        : [],
  );
  const hasVerb =
    /\b(open|launch|start|run|execute|exec|find|locate|search|list|show|read|write|create|delete|update|check|inspect)\b/.test(
      text,
    );

  if (!hasVerb) return null;

  const launchIntent = /\b(open|launch|start|run|execute|exec)\b/.test(text);
  if (launchIntent && availableTools.has('terminal.exec')) {
    const target = extractLaunchTargetFromRequest(userInput);
    const probe = buildExecutableProbeCommand(target);
    if (probe) {
      return {
        tool: 'terminal.exec',
        args: { command: probe },
        reason: 'Detected launch intent; probing executable candidates before finalizing.',
      };
    }
  }

  const searchIntent = /\b(find|locate|search)\b/.test(text);
  if (searchIntent && availableTools.has('files.find')) {
    const inferred = extractFindQueryFromText(userInput);
    const remainder = String(userInput || '')
      .replace(
        /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:find|locate|search(?:\s+for)?)\s+/i,
        '',
      )
      .trim();
    const query = (inferred || remainder || String(userInput || '').trim()).slice(0, 120);

    if (!query) {
      return null;
    }

    return {
      tool: 'files.find',
      args: { path: '.', query },
      reason: 'Detected search intent; forcing files.find before a final answer.',
    };
  }

  const listIntent =
    /\b(list|show)\b/.test(text) &&
    /\b(file|files|folder|folders|directory|directories|workspace)\b/.test(text);
  if (listIntent && availableTools.has('files.list')) {
    return {
      tool: 'files.list',
      args: { path: '.', depth: 3 },
      reason: 'Detected listing intent; forcing files.list before a final answer.',
    };
  }

  if (availableTools.has('resources.list')) {
    return {
      tool: 'resources.list',
      args: {},
      reason: 'Actionable request detected; checking runtime resources before finalizing.',
    };
  }

  return null;
}

/**
 * Infers forced tool action for request when the caller has not supplied an explicit value.
 */

export async function inferForcedToolActionForRequest({
  userInput,
  capabilitySnapshot,
  requestAI,
}) {
  if (!isImperativeActionRequest(userInput)) return null;

  const advertisedTools = Array.isArray(capabilitySnapshot?.advertisedTools)
    ? capabilitySnapshot.advertisedTools
    : capabilitySnapshot?.availableTools;
  const availableTools = Array.isArray(advertisedTools)
    ? advertisedTools.filter((name) => TOOL_BY_NAME[name])
    : [];

  if (!availableTools.length) {
    return null;
  }

  const availableToolSpecs = TOOL_DEFINITIONS.filter((tool) =>
    availableTools.includes(tool.name),
  ).map((tool) => ({
    name: tool.name,
    module: tool.module,
    description: tool.description,
    args: tool.args,
  }));

  try {
    const raw = await requestAI([
      {
        role: 'system',
        content: [
          'You are IRIS Tool Planner.',
          'The controller attempted to finalize too early on an actionable request.',
          'Choose exactly one available runtime tool action that best advances the request.',
          'Return strict JSON only with shape: {"tool":"...","args":{},"reason":"..."}.',
          'tool must be one of available_tools.',
          'Do not return a final user-facing answer.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          user_request: String(userInput || ''),
          available_tools: availableTools,
          tool_specs: availableToolSpecs,
        }),
      },
    ]);

    const parsed = extractJsonObject(raw);
    const plannerTool = String(parsed?.tool || parsed?.action?.tool || '').trim();
    const plannerArgs = parsed?.args && typeof parsed.args === 'object' ? parsed.args : {};
    const plannerReason = String(parsed?.reason || '').trim();

    if (plannerTool) {
      const resolution = resolveToolRequest(plannerTool);
      const resolvedTool = resolution.resolved;

      if (resolvedTool && availableTools.includes(resolvedTool)) {
        return {
          tool: resolvedTool,
          args: plannerArgs,
          reason: plannerReason || 'Planner selected a tool action for this actionable request.',
        };
      }
    }
  } catch {
    // Fall back to deterministic heuristics when planner step fails.
  }

  return fallbackForcedToolAction(userInput, capabilitySnapshot);
}

/**
 * Finds find query from text within a larger input for later policy or presentation logic.
 */

export function extractFindQueryFromText(input) {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  const quoted = text.match(/["'`](.{1,120}?)["'`]/);
  if (quoted?.[1]) {
    const value = quoted[1].trim();
    if (value && value.length <= 120) return value;
  }

  const direct = text.match(
    /\b(?:find|locate|search(?:\s+for)?)\s+(?:the\s+)?(.{1,120}?)(?:\s+(?:folder|directory|dir|file|path|location|named)\b|$)/i,
  );
  if (direct?.[1]) {
    const value = direct[1]
      .trim()
      .replace(/^[^a-z0-9]+|[^a-z0-9._\-/ ]+$/gi, '')
      .trim();
    if (value && value.length >= 2 && value.length <= 120) return value;
  }

  return '';
}

// Infers find query when the caller has not supplied an explicit value.
export function inferFindQuery({ args, userInput, todos }) {
  const byArgs = [args?.name, args?.target, args?.text, args?.needle]
    .map((value) => String(value || '').trim())
    .find(Boolean);
  if (byArgs) return byArgs;

  const fromUser = extractFindQueryFromText(userInput);
  if (fromUser) return fromUser;

  const todoText = Array.isArray(todos)
    ? todos.map((todo) => String(todo?.text || '')).join(' ')
    : '';

  const fromTodos = extractFindQueryFromText(todoText);
  if (fromTodos) return fromTodos;

  return '';
}

/**
 * Evaluates whether should use global path fallback for the supplied value and current
 * runtime state.
 */

export function shouldUseGlobalPathFallback({ pathInput, query, userInput, todos }) {
  const pathText = String(pathInput || '').trim();
  if (pathText !== '.' && pathText !== './') return false;

  const scopeText = [
    String(userInput || ''),
    ...(Array.isArray(todos) ? todos.map((todo) => String(todo?.text || '')) : []),
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(folder|directory|dir|location|path)\b/.test(scopeText)) {
    return true;
  }

  if (/\b(doc|docs|document|documents)\b/.test(scopeText)) {
    return true;
  }

  const normalizedQuery = String(query || '').trim();
  if (/^[a-z0-9._\- ]{2,80}$/i.test(normalizedQuery)) {
    return true;
  }

  return false;
}

// Finds first path from summary within a larger input for later policy or presentation logic.
export function extractFirstPathFromSummary(summary) {
  const text = String(summary || '');
  if (!text) return '';

  const firstResultPath = text.match(/"results"[\s\S]{0,240}?"path"\s*:\s*"([^"]+)"/i);
  if (firstResultPath?.[1]) return firstResultPath[1];

  const directPath = text.match(/"path"\s*:\s*"([^"]+)"/i);
  if (directPath?.[1]) return directPath[1];

  return '';
}

// Assembles best effort tool summary reply from lower-level state so callers receive one consistent
// representation.
export function buildBestEffortToolSummaryReply(stepHistory) {
  const history = Array.isArray(stepHistory) ? stepHistory : [];
  if (!history.length) return '';

  const successSteps = history.filter((step) => step?.ok);
  if (!successSteps.length) return '';

  const latestLaunch = [...successSteps].reverse().find((step) => step.tool === 'launch.run');
  if (latestLaunch) {
    return 'I attempted the requested launch action via local tools. If the app did not appear, I can retry with a different launch command.';
  }

  const latestFind = [...successSteps].reverse().find((step) => step.tool === 'files.find');
  if (latestFind) {
    const foundPath = extractFirstPathFromSummary(latestFind.summary);
    if (foundPath) {
      return `I found a likely match at ${foundPath}. I can list that directory next if you want.`;
    }
    return 'I completed a file search and found matches, but the final response formatting failed. Ask me to list the first match and I will continue.';
  }

  const latestList = [...successSteps].reverse().find((step) => step.tool === 'files.list');
  if (latestList) {
    const listedPath = extractFirstPathFromSummary(latestList.summary);
    if (listedPath) {
      return `I listed ${listedPath} successfully. I can continue with a deeper listing or file read from there.`;
    }
  }

  return '';
}
