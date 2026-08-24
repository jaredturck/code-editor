// @ts-nocheck
/**
 * Runs one complete agent session from provider selection through tool use, optional
 * delegation, and finalization. It chooses the native-tool or controller loop, maintains
 * the model thread and budgets, and reports every user-visible state transition through
 * callbacks.
 */

// Transitional extraction: behavior is preserved verbatim while runtime contracts are typed incrementally.
import { markUntrustedExternalContent, UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security'
import { callAIWithMeta } from '@/platform/aiService'
import { scoreSession, recordReward, recordToolHeatmap } from '@/platform/skillRewards'
import {
  listSkillDefinitions,
  chatsReadMemory,
  pullLocalOllamaModel,
} from '@/platform/desktopBridge'
import {
  recallRelevantNotes,
  recordUserPreferenceNote,
  clearSessionScopedNotes,
} from '@/platform/notesStorage'
import { inferModelFamily } from '@/platform/skillProfiles'
import { supportsNativeTools } from '@/platform/modelProfiles'
import { buildJsonSchemaTools } from '@/platform/agent/toolSchema'
import { createToolGuard } from '@/platform/agent/toolGuard'
import { buildControllerSystemPrompt, buildControllerStateHeader } from '@/platform/agent/controllerPrompt'
import {
  normalizeDecision,
  mapNativeMetaToDecision,
  looksLikeControllerSchemaText,
  recoverDecisionFromSchemaText,
} from '@/platform/agent/controllerDecision'
import { createUsageTracker, trackUsageSample, buildUsageSummary } from '@/platform/agent/usageMetrics'
import { writeOrbSettings } from '@/platform/settingsStorage'
import {
  syncStandbyPool,
  detectOrchestrationMode,
  subscribeSubAgentEvents,
} from '@/platform/orchestrationClient'
import {
  applyAgentIdentityToSettings,
  getAgentRoleBinding,
  resolveAgentRoleSettings,
} from '@/platform/agent/agentIdentity'
import {
  extractJsonObject,
  toPreview,
} from '@/platform/agent/agentJsonUtils'
import {
  checkReflexSkills,
  loadSkillContext,
} from '@/platform/agent/agentSkillEngine'
import {
  TOOL_BY_NAME,
} from '@/platform/agent/toolCatalog'

import * as runtimeSupport from '@/platform/agent/runtime/runtimeSupport'
import { createModuleBroker } from '@/platform/agent/runtime/toolBroker'
import { createMeshConductor, isMeshEnabled } from '@/platform/agent/meshConductor'
import { deriveModelTags, buildAgentRoster } from '@/platform/agent/modelTags'
import {
  recordModelFailure,
  recordModelSuccess,
  pickFailoverModel,
  resolveFailoverPolicy,
} from '@/platform/agent/modelHealth'
import { startModelHealthMonitor } from '@/platform/agent/modelHealthMonitor'
import { recommendRecoveryModel } from '@/platform/agent/modelRecovery'
import { isModelRoutingEnabled, estimateTaskComplexity, pickModelForComplexity } from '@/platform/agent/modelRouting'
import { tagsForRole, runOverwatch, hasOverwatcher, runTeamworkPlanning } from '@/platform/agent/meshClient'
import { colorForAgent } from '@/platform/agentColors'
import { buildLocalPreflightPlan, formatLocalPreflightPlan } from '@/platform/agent/localPlanner'
import {
  RUNTIME_CLOUD_USAGE_STATE_KEY,
  buildCloudRequestSettings,
  buildHybridExecutionPlan,
  canUseCloud,
  createCloudUsageState,
  getCloudUsageState,
  selectCloudConsultModel,
} from '@/platform/agent/cloudUsagePolicy'
import {
  looksLikeMissingRequestReply,
  synthesizeFinalReply,
  buildControllerPayload,
  buildRunSummary,
} from '@/platform/agent/runtime/finalization'
const {
  SEARCH_WEB_DEFAULT_CALL_BUDGET,
  SEARCH_WEB_UNLIMITED_CALL_BUDGET,
  AGENT_SESSION_MINUTES_DEFAULT,
  SEARCH_BUDGET_CONTINUE_INCREMENT,
  SEARCH_BUDGET_EXTEND_INCREMENT,
  TOOL_TIMEOUT_CONTINUE_BOOST_MS,
  TOOL_TIMEOUT_EXTEND_BOOST_MS,
  TOOL_TIMEOUT_UNLIMITED_MS,
  AGENT_STATES,
  CONTEXT_BUDGET_WARN_RATIO,
  detectUserCorrection,
  estimateContextTokensUsed,
  resolveModelContextWindow,
  resolveAgentToolset,
  useStatefulLoop: shouldUseStatefulLoop,
  toToolResultContent,
  getContinuityContext,
  persistContinuityNote,
  createTodoTool,
  createTraceTool,
  resolveSafetyConfig,
  hasExplicitUserApproval,
  resolveToolRequest,
  buildCapabilitySnapshot,
  isCapabilityOrPermissionError,
  buildInsufficientAccessReply,
  looksLikeToolAccessLimitationReply,
  inferForcedToolActionForRequest,
  buildBestEffortToolSummaryReply,
  createWebSearchSessionState,
  normalizeApprovalDecisionToken,
  normalizeApprovalResponse,
  classifyLimitIssue,
  buildLimitDecisionOptions,
  resolveToolTimeoutMs,
  runWithTimeout,
  waitMs,
} = runtimeSupport

// A final answer that is really a CLARIFYING QUESTION the model is asking the user (so the run
// should pause and await an answer rather than end). Conservative: it must actually end with a
// question mark and be short enough to be a question, not a long answer that happens to contain one.
function looksLikeClarifyingQuestion(text) {
  const clean = String(text || '').trim()
  if (!clean.endsWith('?')) return false
  if (clean.length > 800) return false
  // Phrasings that signal the model is asking the user to decide/clarify.
  return /\b(could you|can you|would you|do you want|should i|which|what would you|please (clarify|confirm|specify|let me know)|let me know|are you|how would you|where should)\b/i.test(
    clean,
  )
}

/**
 * Builds the provider settings used by one agent request while preserving session-level
 * reasoning configuration and any explicit per-call overrides.
 */
export function buildAgentRequestSettings(settings, overrideSettings = {}) {
  const next = {
    ...settings,
    extended_thinking: settings?.extended_thinking === true,
    ...overrideSettings,
  }

  if (settings?.agent_local_only_enforced === true) {
    next.agent_local_only_enforced = true
    next.agent_execution_policy = 'local_only'
  }

  return next
}

/**
 * Prepends session attachments to the current (latest) user message in provider-compatible content
 * format. Text payloads remain bounded and image payloads retain their original data URLs.
 */
export function attachSessionFilesToMessages(messages, settings) {
  const toProviderContent = (message, files) => {
    const fileContext = files.map((file) => {
      if (file.type?.startsWith('image')) {
        return {
          type: 'image_url',
          image_url: { url: `data:${file.type};base64,${file.content}` },
        }
      }
      return {
        type: 'text',
        text: `[Attached file: ${file.name}]\n${String(file.content || '').slice(0, 8000)}`,
      }
    })
    const existingContent =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : [{ type: 'text', text: String(message.content || '') }]
    return { ...message, content: [...fileContext, ...existingContent] }
  }

  const hydrated = messages.map((message) => {
    const persisted = Array.isArray(message?.attachments) ? message.attachments : []
    return message?.role === 'user' && persisted.length ? toProviderContent(message, persisted) : message
  })

  const attachedFiles = Array.isArray(settings?.attached_files) ? settings.attached_files : []
  if (attachedFiles.length === 0) return hydrated
  const targetIndex = hydrated.reduce((latest, message, index) => (message.role === 'user' ? index : latest), -1)
  if (targetIndex < 0 || Array.isArray(hydrated[targetIndex]?.attachments)) return hydrated

  return hydrated.map((message, index) => (index === targetIndex ? toProviderContent(message, attachedFiles) : message))
}

/**
 * Records one provider response in the session usage tracker and keeps the tracker identity aligned
 * with the provider and model that actually served the request.
 */
export function recordAgentRequestUsage(usageTracker, meta, messages) {
  trackUsageSample(usageTracker, {
    usage: meta?.usage,
    messages,
    text: meta?.text,
  })
  if (meta?.provider) usageTracker.provider = String(meta.provider)
  if (meta?.model) usageTracker.model = String(meta.model)
}

/**
 * Resolves the effective timeout for one tool call from the base policy and session limit
 * overrides. Unlimited mode preserves the existing elevated timeout floor.
 */
export function resolveSessionToolTimeout(toolName, sessionLimitState) {
  const baseTimeoutMs = resolveToolTimeoutMs(toolName)
  if (sessionLimitState.unlimited) {
    return Math.max(baseTimeoutMs, TOOL_TIMEOUT_UNLIMITED_MS)
  }
  const boostMs = Number(sessionLimitState?.toolTimeoutBoostMs?.[toolName] || 0)
  return Math.max(1000, baseTimeoutMs + Math.max(0, boostMs))
}

/**
 * Creates the safety snapshot passed to the current agent step from immutable policy and mutable
 * session approval or limit state.
 */
export function buildSessionSafetySnapshot({ safetyConfig, sessionStepBudget, approvalState, sessionLimitState }) {
  return {
    ...safetyConfig,
    maxSteps: sessionStepBudget,
    userApprovalGranted: Boolean(approvalState.granted),
    allowElevatedCommands: Boolean(approvalState.allowElevatedCommands),
    allowPaidSearchFallback: Boolean(approvalState.allowPaidSearchFallback),
    unlimitedForSession: Boolean(sessionLimitState.unlimited),
  }
}

/**
 * Runs a complete agent turn from context preparation and provider selection through
 * iterative tool use, optional delegation, and final reply construction. It preserves one
 * coherent model thread while enforcing repetition, duration, context, and output
 * guards and reporting progress back to the chat UI.
 */

export async function runAgentSession({
  userInput,
  screenContext = null, // optional base64 JPEG data URL from live screen share
  conversation = [],
  settings,
  todos = [],
  maxSteps = null,
  onEvent,
  onApprovalRequest,
  // Force-session-alive (capable/native loop): commits the turn's final answer and parks the loop
  // awaiting the user's next message. Returns { text } to continue in the SAME session, or null to
  // close it (user left the chat / stopped). Only wired when settings.force_session_alive is on.
  onContinue = null,
  abortSignal = null,
}) {
  const requestedResponderSettings = settings
  const hybridExecution = buildHybridExecutionPlan(settings)
  const cloudUsageState = createCloudUsageState(requestedResponderSettings, Boolean(hybridExecution?.finalResponder))
  if (hybridExecution) {
    settings = hybridExecution.workingSettings
  }
  // The object is intentionally shared through settings clones so every remote inference — main
  // responder, delegated peer, retry, consultation, and final synthesis — consumes one budget.
  settings = { ...settings, [RUNTIME_CLOUD_USAGE_STATE_KEY]: cloudUsageState }

  // When multi-agent mode is enabled, the main loop IS the orchestrator — bind
  // the whole session (model routing AND permission-tier resolution) to the
  // orchestrator role's assigned provider/model so the tier set in the
  // Permissions tab (agent_permission_tier_orchestrator) and the model in the
  // Agents tab both take effect coherently.
  if (
    settings?.agent_primary_locked !== true &&
    settings?.agent_multi_enabled === true &&
    getAgentRoleBinding(settings, 'orchestrator')?.provider
  ) {
    settings = resolveAgentRoleSettings('orchestrator', settings).settings
  }

  // Complexity-aware model routing (Workstream B): when enabled, run this task on the
  // right-sized CONFIGURED model instead of always the orchestrator — trivial/context work
  // on the cheapest (often the local scout), hard reasoning on the strong orchestrator. We
  // route among ROLE PRIMARIES and bind via resolveAgentRoleSettings, so the routed model
  // keeps ITS role's permission tier (capability scales with the model, never widened). Off
  // by default; only acts when a multi-model pool is configured. Best-effort — any failure
  // falls back to the already-bound model.
  if (settings?.agent_primary_locked !== true && isModelRoutingEnabled(settings)) {
    try {
      const candidates = buildAgentRoster(settings)
        .filter((member) => member.primary)
        .map((member) => ({
          id: member.role,
          provider: member.provider,
          model: member.model,
        }))
      const picked = pickModelForComplexity(candidates, estimateTaskComplexity(userInput, conversation))
      if (picked?.id) {
        settings = resolveAgentRoleSettings(picked.id, settings).settings
      }
    } catch {
      /* routing is best-effort; keep the bound model on any error */
    }
  }

  const startedAt = Date.now()
  const timeline = []
  const stepHistory = []
  const sessionArtifacts = []
  const agentState = { current: AGENT_STATES.RUNNING }
  const safetyConfig = resolveSafetyConfig(settings, maxSteps)
  const initialApproval = hasExplicitUserApproval(userInput)
  const approvalState = {
    granted: initialApproval,
    allowElevatedCommands: initialApproval,
    allowNetworkCommands: false,
    allowShellPassthrough: false,
    allowPaidSearchFallback: false,
    sessionPermissionOverrides: {},
    // Web access guard (per-site): domains approved just for this run, plus a
    // blanket "allow all sites for this session" flag. Permanent approvals live
    // in settings.agent_web_allowed_domains.
    webSiteSessionDomains: new Set(),
    allowAllSitesForSession: false,
    // Package-install guard: per-package decisions for this run + a blanket
    // "approve all packages this run" flag. Permanent approvals live in
    // settings.agent_package_allowed; allowGlobalPythonInstall lets the user
    // waive the .venv requirement for the rest of the run.
    packageApprovedSession: new Set(),
    packageDeniedSession: new Set(),
    allowAllPackagesForSession: false,
    allowGlobalPythonInstall: false,
  }
  const sessionLimitState = {
    unlimited: false,
    toolTimeoutBoostMs: {},
  }
  let sessionStepBudget = safetyConfig.maxSteps
  let limitStopReason = ''
  // Duration-based session budget (replaces the steps system as the user-facing limit). The run
  // works for `sessionBudgetMs`; when it elapses, a chat check-in asks how to proceed —
  // Continue (DOUBLE the budget, exponential), Halt (stop), or Steer (type an instruction that is
  // injected, then continue). Reasoning turns are telemetry only; elapsed time and repetition guards control the loop.
  let sessionBudgetMs = Math.max(1, Number(settings?.agent_session_minutes) || AGENT_SESSION_MINUTES_DEFAULT) * 60000
  let sessionDeadline = Date.now() + sessionBudgetMs
  // A steering instruction the user typed at the time-threshold check-in; injected into the next
  // turn (like an Overwatcher steer) then cleared.
  let pendingUserSteer = ''
  // B1: a model that ends its turn with a clarifying QUESTION (plain text, no tool call) pauses for
  // the user's answer in the SAME session instead of ending the run. Shared by both loops; bounded
  // so a model that only ever asks can't loop forever.
  let questionAwaits = 0
  const MAX_QUESTION_AWAITS = 4
  // True while a question (the user.ask tool OR a final-text clarifying question) is outstanding.
  // While it is set the run is genuinely blocked on the user, so background steering — the
  // continuous Overwatcher — is held off until the answer comes in. Toggled by the wrapper below
  // so it covers EVERY question path (tool calls included), not just the final-text one.
  let questionPending = false
  if (onApprovalRequest) {
    const rawApprovalRequest = onApprovalRequest
    onApprovalRequest = async (request) => {
      const isQuestion = String(request?.requestType || '').toLowerCase() === 'question'
      if (isQuestion) questionPending = true
      try {
        return await rawApprovalRequest(request)
      } finally {
        if (isQuestion) questionPending = false
      }
    }
  }
  // Force session alive: when on (and an onContinue channel exists), the capable/native loop parks
  // on its final answer instead of returning, so the live thread continues across turns.
  const keepAlive = settings?.force_session_alive === true && typeof onContinue === 'function'
  let keepAliveCommitted = false
  const isUserCorrection = detectUserCorrection(userInput)
  // `let` (not const): main-agent failover (§F3) swaps the active model mid-run and re-resolves the
  // context window for the new model so compaction sizes to it.
  let modelContextWindow = resolveModelContextWindow(settings)
  // The model currently answering — tracked so failover can mark its health and exclude it when
  // picking a healthy replacement. Starts as the orchestrator answerer (settings is bound to it).
  let activeModel = {
    provider: String(settings?.ai_provider || ''),
    model: String(settings?.ai_model || ''),
    keyId: String(getAgentRoleBinding(settings, 'orchestrator')?.keyId || '1'),
  }
  let failoverSwitches = 0
  // Model override applied after a failover switch — both the stateful and structured loops pass it
  // to their model calls, so a switch takes effect without rebuilding the loop. Empty until a switch.
  const failoverOverride = {}
  // Shared failover (§F3): on a rate-limit/API error past retries, swap the active model for the best
  // healthy one by task fit, compact (the loops compact on the next iteration), and continue. Honors
  // the off / limited-N / exhaust policy. Returns true when it switched (caller resets + continues).
  // Tier-exhaustion offer (WS6): no healthy configured model remains → ask the user in chat whether
  // to load a recommended, available one. Returns a bindable pick on yes, or null (decline / no
  // interactive channel / nothing available) so the caller stops cleanly.
  const offerRecoveryModel = async (failing, rateLimited, step) => {
    if (!onApprovalRequest) return null
    const recommendation = await recommendRecoveryModel(settings, 'orchestrator', [failing])
    if (!recommendation) return null
    let answer = ''
    try {
      const response = await onApprovalRequest({
        modelId: String(settings?.ai_model || settings?.ai_provider || 'IRIS'),
        requestType: 'question',
        question:
          `Every model for this work is currently ${rateLimited ? 'rate-limited' : 'unavailable'}. ` +
          (recommendation.requiresDownload
            ? `No suitable installed replacement was found. Download ${recommendation.label} (${recommendation.downloadSize || 'size varies'}) and continue?`
            : `Load ${recommendation.label} and continue?`) +
          `\n\n${recommendation.reason}`,
        options: [
          {
            value: recommendation.requiresDownload
              ? `Download and use ${recommendation.label}`
              : `Load ${recommendation.label}`,
          },
          { value: 'No, stop' },
        ],
        allowOther: false,
        recommendedDecision: 'load',
      })
      answer = String(
        (response && typeof response === 'object' ? (response.answer ?? response.decision ?? '') : response) || '',
      )
        .trim()
        .toLowerCase()
    } catch {
      return null
    }
    if (!answer || /^(no|stop|cancel|deny)/.test(answer)) return null
    if (recommendation.requiresDownload) {
      try {
        onEvent?.({
          type: 'notice',
          summary: `Downloading ${recommendation.label} before retrying the task…`,
          at: Date.now(),
          step,
        })
        await pullLocalOllamaModel(recommendation.downloadBaseUrl, recommendation.model)
        const discovered = { ...(settings.discovered_models || {}) }
        const localModels = Array.from(
          new Set([recommendation.model, ...(Array.isArray(discovered.local) ? discovered.local : [])]),
        )
        discovered.local = localModels
        const entry = {
          id: `${recommendation.role}:local:${recommendation.model}:1`.toLowerCase(),
          role: recommendation.role,
          provider: 'local',
          model: recommendation.model,
          keyId: '1',
          primary: false,
          tags: [],
          disabledTags: [],
        }
        settings = {
          ...settings,
          discovered_models: discovered,
          agent_models: [...(Array.isArray(settings.agent_models) ? settings.agent_models : []), entry],
        }
        writeOrbSettings({
          ...settings,
          [RUNTIME_CLOUD_USAGE_STATE_KEY]: undefined,
        })
      } catch (error) {
        onEvent?.({
          type: 'notice',
          level: 'error',
          summary: `Could not download ${recommendation.label}: ${String(error?.message || error).slice(0, 180)}`,
          at: Date.now(),
          step,
        })
        return null
      }
    }
    onEvent?.({
      type: 'notice',
      summary: `Loading ${recommendation.label} (${recommendation.role}) to continue — recommended after the configured models were exhausted.`,
      at: Date.now(),
      step,
    })
    return {
      provider: recommendation.provider,
      model: recommendation.model,
      keyId: recommendation.keyId,
      role: recommendation.role,
    }
  }

  const tryFailover = async (error, step) => {
    const policy = resolveFailoverPolicy(settings)
    const errMsg = String(error?.message || error || '')
    const rateLimited = classifyLimitIssue({ message: errMsg })?.kind === 'rate_limit'
    recordModelFailure(activeModel.provider, activeModel.model, activeModel.keyId, {
      error: errMsg,
      rateLimited,
    })
    if (!policy.enabled || failoverSwitches >= policy.maxAttempts) return false
    let pick = pickFailoverModel(settings, activeModel, {
      preferRole: 'orchestrator',
    })
    // Tier exhausted: no healthy model is already configured for failover. Before stopping, offer to
    // LOAD a recommended, available model (WS6) — a different model with a valid key / installed
    // locally that isn't currently failing. The user decides; we never auto-add a model silently.
    if (!pick) {
      const recovery = await offerRecoveryModel(activeModel, rateLimited, step)
      if (!recovery) {
        onEvent?.({
          type: 'notice',
          level: 'error',
          summary: `${activeModel.model || 'The active model'} is ${rateLimited ? 'rate-limited' : 'failing'} and no healthy backup model is available — stopping. Add another model in Settings → Agents to enable failover.`,
          at: Date.now(),
          step,
        })
        return false
      }
      pick = recovery
    }
    failoverSwitches += 1
    const switchLabel =
      policy.maxAttempts >= 12 ? `switch ${failoverSwitches}` : `switch ${failoverSwitches}/${policy.maxAttempts}`
    onEvent?.({
      type: 'notice',
      level: 'error',
      summary: `${activeModel.model || 'active model'} is ${rateLimited ? 'rate-limited' : 'failing'} — switching to ${pick.model} (${pick.role}) and compacting context to continue (${switchLabel}).`,
      at: Date.now(),
      step,
    })
    const rebind = applyAgentIdentityToSettings(settings, {
      role: pick.role,
      provider: pick.provider,
      model: pick.model,
      keyId: pick.keyId,
      explicitlyAssigned: true,
    })
    failoverOverride.ai_provider = rebind.ai_provider
    failoverOverride.ai_model = rebind.ai_model
    failoverOverride.ai_api_key = rebind.ai_api_key
    activeModel = {
      provider: pick.provider,
      model: pick.model,
      keyId: pick.keyId,
    }
    modelContextWindow = resolveModelContextWindow({
      ...settings,
      ai_provider: pick.provider,
      ai_model: pick.model,
    })
    return true
  }

  // Put EVERY connectable roster member on standby (each bound to its OWN provider/model/key), not
  // just the executor/scout primaries — so all loaded models are active and ready, and delegated
  // work spreads across a role's keyed members instead of piling onto Key 1. The pool also
  // subscribes to settings writes so changes apply live without an app restart. (§2)
  let connectedMembers = []
  if (settings?.agent_multi_enabled === true) {
    // Keep the background health probe running (idempotent) so a model that went down last session
    // is excluded up front and a recovered one rejoins without wasting a live turn. (WS6)
    try {
      startModelHealthMonitor(settings)
    } catch {
      /* non-fatal */
    }
    try {
      const pool = syncStandbyPool(settings)
      connectedMembers = Array.isArray(pool.connected) ? pool.connected : []
      // A configured model that can't connect (usually a missing/mismatched key) used to be
      // dropped SILENTLY — the user saw "models configured" but an empty team. Surface each drop
      // with its reason so the cause is visible instead of guessed.
      for (const drop of pool.dropped || []) {
        onEvent?.({
          type: 'notice',
          summary: `${drop.member.model || drop.member.role} (${drop.member.id}) isn't joining the team — ${drop.reason}. Fix it in Settings → Agents to bring this model online.`,
          at: Date.now(),
        })
      }
    } catch {
      /* non-fatal */
    }
  }

  // Detect orchestration mode and inject into debrief
  let orchestrationModeNote = ''
  if (settings?.agent_multi_enabled === true) {
    try {
      const modeInfo = await detectOrchestrationMode()
      if (modeInfo.mode !== 'full') {
        const offlineStr = modeInfo.offline.length ? ` (${modeInfo.offline.join(', ')} offline)` : ''
        orchestrationModeNote = ` Orchestration mode: ${modeInfo.mode}${offlineStr}.`
      }
    } catch {
      /* non-fatal */
    }
    // Name each connected member by its MEMBER id (executor, executor#2, …) with its model, so the
    // lead can address ALL loaded models — not just a single role. (Previously the pool was
    // collapsed to two role names, so the lead never knew the other keyed members existed.)
    if (connectedMembers.length) {
      const memberList = connectedMembers
        .map((m) => {
          const tagStr = Array.isArray(m.tags) && m.tags.length ? `, ${m.tags.slice(0, 3).join('/')}` : ''
          return `${m.id} [${m.model}${tagStr}]`
        })
        .join('; ')
      orchestrationModeNote += ` Connected sub-agents (delegate to a specific one by its member id): ${memberList}.`
      // A visible "team connected" summary so the user can SEE every model that came online.
      onEvent?.({
        type: 'notice',
        summary: `Team online (${connectedMembers.length}): ${connectedMembers.map((m) => `${m.id} → ${m.model}`).join(', ')}.`,
        at: Date.now(),
      })
    } else {
      orchestrationModeNote += ` No sub-agents are connected — handle the task directly.`
    }
  }

  // Planning mode is decided up front so the Overwatcher always gets the FIRST read in a planned
  // run (not only when the heuristic happens to rate the task non-trivial).
  const planningActive = settings?.agent_planning_mode === true && settings?.agent_multi_enabled === true

  // Overwatcher (supervisor): a reasoning model that gives an up-front complexity read + steer.
  // Runs for any non-trivial task OR any teamwork run, and ALWAYS injects whatever steer it returns
  // (structured guidance, captured reasoning, or an escalation) so it reliably reaches the active
  // model. If it comes back empty or errors (API down), a non-blocking warning card tells the user
  // we're continuing without it — instead of the old silent skip.
  let overwatchNote = ''
  if (
    settings?.agent_multi_enabled === true &&
    hasOverwatcher(settings) &&
    (estimateTaskComplexity(userInput, conversation) !== 'trivial' || planningActive)
  ) {
    const overwatchColor = colorForAgent('overwatcher')
    try {
      // Forward the Overwatcher's live reasoning into the timeline (its own colored lane) so the
      // user can SEE its thinking, then inject its steer into the controller prompt below.
      const ov = await runOverwatch(
        { task: userInput },
        settings,
        (event) => {
          if (event?.type === 'thinking' && typeof event.summary === 'string' && event.summary.trim()) {
            onEvent?.({
              type: 'thinking',
              summary: `[Overwatcher] ${event.summary.trim().slice(0, 2000)}`,
              source: 'subagent',
              subAgentRole: 'overwatcher',
              roleLabel: 'Overwatcher',
              agentColor: overwatchColor,
              agentTags: tagsForRole('overwatcher', settings),
              at: Date.now(),
            })
          }
        },
        abortSignal,
      )
      // Fall back to the captured reasoning when the structured guidance is thin, so a reasoning
      // model that puts the substance in its thinking still steers the active model.
      const steer = ov.available ? ov.guidance || ov.reasoning || '' : ''
      if (ov.available && (steer || ov.escalate)) {
        const esc = ov.escalate
          ? ` It recommends pulling in a peer${ov.suggestedTags?.length ? ` tagged ${ov.suggestedTags.join(', ')}` : ''} via agent.find/agent.consult before going solo.`
          : ''
        overwatchNote = ` Overwatcher (complexity ${ov.complexity}): ${steer}${esc}`
        // Surface exactly what gets injected into the receiving (active) model's prompt.
        onEvent?.({
          type: 'thinking',
          summary: `Overwatcher steer injected into the agent's prompt →${overwatchNote}`,
          source: 'subagent',
          subAgentRole: 'overwatcher',
          roleLabel: 'Overwatcher',
          agentColor: overwatchColor,
          at: Date.now(),
        })
      } else {
        // Configured but nothing usable came back → treat it as offline; warn and continue.
        onEvent?.({
          type: 'notice',
          summary:
            'Overwatcher returned no guidance (it may be offline). Continuing without its steer — it will rejoin when reachable.',
          source: 'subagent',
          subAgentRole: 'overwatcher',
          roleLabel: 'Overwatcher',
          agentColor: overwatchColor,
          at: Date.now(),
        })
      }
    } catch (overwatchErr) {
      // API error reaching the Overwatcher — surface a non-blocking warning card and proceed
      // (blocking the whole run on an advisory model's transient error would be worse).
      const detail = (overwatchErr instanceof Error ? overwatchErr.message : String(overwatchErr || 'error')).slice(
        0,
        120,
      )
      onEvent?.({
        type: 'notice',
        summary: `Overwatcher is offline (${detail}). Continuing without its guidance until it's reachable.`,
        source: 'subagent',
        subAgentRole: 'overwatcher',
        roleLabel: 'Overwatcher',
        agentColor: overwatchColor,
        at: Date.now(),
      })
    }
  }

  // Planning mode (/plan): the configured loaded agents CO-PLAN the task before any execution. The
  // lead drafts a split, the plan is passed to every loaded member for input, the lead reconciles
  // it into parts (each OWNED by a member) — then, gated by the USER, those parts seed the per-member
  // todo lanes and the owners each take their piece. The user reviews the full plan in the side panel
  // and can approve / deny / keep planning / steer before anything runs.
  // (planningActive is decided above so the Overwatcher gets the first read in a planned run.)
  let planNote = ''
  let planSeedTodos = []
  // Planning mode FORCES a plan on every task (not just non-trivial ones).
  if (planningActive) {
    const PLAN_MAX_ROUNDS = 4
    const forwardPlanThinking = (event) => {
      if (event?.type === 'thinking' && typeof event.summary === 'string' && event.summary.trim()) {
        onEvent?.({
          type: 'thinking',
          summary: `[Planning] ${event.summary.trim().slice(0, 2000)}`,
          source: 'subagent',
          subAgentRole: 'orchestrator',
          roleLabel: 'Planning',
          agentColor: colorForAgent('orchestrator'),
          at: Date.now(),
        })
      }
    }
    let steer = ''
    let approvedPlan = null
    try {
      for (let round = 0; round < PLAN_MAX_ROUNDS; round += 1) {
        if (abortSignal?.aborted) break // user pressed Stop during planning
        const plan = await runTeamworkPlanning(userInput, settings, {
          steer,
          emit: forwardPlanThinking,
          signal: abortSignal,
        })
        if (!plan.ok || !Array.isArray(plan.parts) || !plan.parts.length) break

        onEvent?.({
          type: 'thinking',
          summary: `Planning (lead ${plan.planner}): ${plan.parts.length} part(s) across ${plan.team?.length || 0} agents${steer ? ' — revised on your steer' : ''}.`,
          source: 'subagent',
          subAgentRole: 'orchestrator',
          roleLabel: 'Planning',
          agentColor: colorForAgent('orchestrator'),
          at: Date.now(),
        })

        // No approval channel (non-interactive run) → proceed with the plan as-is.
        if (!onApprovalRequest) {
          approvedPlan = plan
          break
        }

        let decisionRaw = ''
        try {
          // The full plan opens in the side panel (planText → a tmp-file artifact in ChatPanel).
          const response = await onApprovalRequest({
            modelId: String(settings?.ai_model || settings?.ai_provider || 'Team'),
            requestType: 'question',
            question:
              `Approve this ${plan.parts.length}-part team plan before the agents start? The full plan is ` +
              `open in the side panel. Pick an option, or type your own steer to revise it.`,
            options: [{ value: 'Approve' }, { value: 'Keep planning' }, { value: 'Deny' }],
            allowOther: true,
            recommendedDecision: 'approve',
            planText: plan.planText || '',
          })
          decisionRaw = String(
            (response && typeof response === 'object' ? (response.answer ?? response.decision ?? '') : response) || '',
          ).trim()
        } catch {
          // Approval surface failed → don't block the run; proceed with the plan.
          approvedPlan = plan
          break
        }

        const decision = decisionRaw.toLowerCase()
        if (!decision || decision.startsWith('approv')) {
          approvedPlan = plan
          break
        }
        if (/^(deny|cancel|reject|stop)/.test(decision)) {
          onEvent?.({
            type: 'notice',
            summary: 'Plan denied — proceeding solo (single-owner) for this task.',
            source: 'subagent',
            subAgentRole: 'orchestrator',
            roleLabel: 'Planning',
            agentColor: colorForAgent('orchestrator'),
            at: Date.now(),
          })
          break
        }
        // "Keep planning" → re-plan from scratch; any other free text → steer the re-plan.
        steer = /^(keep planning|re-?plan|again)$/.test(decision) ? '' : decisionRaw
      }
    } catch {
      /* teamwork planning is best-effort — fall back to normal single-owner operation */
    }

    if (approvedPlan && Array.isArray(approvedPlan.parts) && approvedPlan.parts.length) {
      const parts = approvedPlan.parts
      // Per-member todos: each carries its OWNER (member id) so the UI can split the list into lanes
      // and each teammate sees only its own slice.
      planSeedTodos = parts.map((part, index) => ({
        id: index + 1,
        text: part.summary,
        status: 'pending',
        agentRole: part.role,
        owner: part.owner,
        dependsOn: Array.isArray(part.dependsOn) ? part.dependsOn : [],
      }))
      const planLines = parts
        .map((p) => `• [${p.owner}] ${p.summary}${p.dependsOn?.length ? ` (after ${p.dependsOn.join(', ')})` : ''}`)
        .join('  ')
      planNote =
        ` PLANNING MODE (plan approved): you are the team lead coordinating ${approvedPlan.team?.length || parts.length} agents. ` +
        `The task was split into parts, each OWNED by a teammate — ${planLines}. Hand each part to its OWNER with ` +
        `agent.delegate({ toAgent: "<owner id, e.g. executor#2>", … }); the owner runs it on its own key. Respect each ` +
        `part's dependsOn order (don't start a part until the parts it depends on are done). Each teammate sees only its ` +
        `own part; you keep the single accountable answer. If a teammate's part fails it is automatically reassigned to ` +
        `another healthy teammate — keep coordinating rather than silently absorbing failed parts. Update each todo's ` +
        `status as its part completes.`
      onEvent?.({
        type: 'thinking',
        summary: `Planning approved: ${parts.length} part(s) seeded to the per-agent todo lanes.`,
        source: 'subagent',
        subAgentRole: 'orchestrator',
        roleLabel: 'Planning',
        agentColor: colorForAgent('orchestrator'),
        at: Date.now(),
      })
    }
  }

  let localPreflightNote = ''
  try {
    const localPlan = await buildLocalPreflightPlan(userInput, conversation, settings, abortSignal)
    localPreflightNote = formatLocalPreflightPlan(localPlan)
    if (localPlan) {
      onEvent?.({
        type: 'thinking',
        summary: `Local planner prepared a ${localPlan.taskType} preflight${
          localPlan.needsLocalFiles ? ' with filesystem retrieval' : ''
        }${localPlan.needsWebResearch ? ' and web research' : ''}.`,
        source: 'local-planner',
        roleLabel: 'Local planner',
        at: Date.now(),
      })
    }
  } catch (error) {
    onEvent?.({
      type: 'thinking',
      summary: `Local planning was unavailable; continuing with the primary responder (${String(
        error?.message || error || 'unknown error',
      ).slice(0, 160)}).`,
      source: 'local-planner',
      roleLabel: 'Local planner',
      at: Date.now(),
    })
  }

  // Session context line appended to the controller prompt: filesystem root +
  // orchestration availability + any Overwatcher steer + teamwork plan.
  const sessionDebriefLine = (() => {
    const wd = String(settings?.agent_working_dir || '').trim()
    const rootNote = `Filesystem root: ${wd || 'home (~)'}. Relative paths resolve under this root; use absolute paths to go elsewhere.`
    const combined =
      `${rootNote}${localPreflightNote ? ` ${localPreflightNote}` : ''}${orchestrationModeNote}${overwatchNote}${planNote}`.trim()
    return combined || null
  })()

  // Single tier-aware controller prompt (W1). Built ONCE per session — stable
  // across steps, so it caches cleanly. 'lean' trusts capable (native-tool)
  // models and is terminal-first; 'structured' gives weak/local models an
  // explicit JSON schema and prefers the structured file tools.
  const orchestrationActive = connectedMembers.length > 0
  // Tag/role-composed prompt (Workstream D): derive this model's ability tags so the prompt
  // is built from WHO it is, and add the light mesh suggestion only when the bridge is on.
  // The main loop is always the orchestrator/owner. Stable per session → caches cleanly.
  const controllerTags = deriveModelTags(settings?.ai_provider, settings?.ai_model)
  const meshActive = isMeshEnabled(settings)
  const leanControllerSystem = buildControllerSystemPrompt({
    tier: 'lean',
    orchestration: orchestrationActive,
    debriefLine: sessionDebriefLine || '',
    tags: controllerTags,
    role: 'orchestrator',
    meshEnabled: meshActive,
    planning: planningActive,
  })
  const structuredControllerSystem = buildControllerSystemPrompt({
    tier: 'structured',
    orchestration: orchestrationActive,
    debriefLine: sessionDebriefLine || '',
    tags: controllerTags,
    role: 'orchestrator',
    meshEnabled: meshActive,
    planning: planningActive,
  })
  // Terminal-first tool surface (W2): 'lean' for capable models, 'structured'
  // (full helper set) for weak/local. Stable per session.
  const sessionToolset = resolveAgentToolset(settings)

  const usageTracker = createUsageTracker(settings)
  // Full-meta AI call — returns { text, usage, toolCalls, thinkingText, ... } and
  // records usage. `options` carries native tool-calling config { tools, toolChoice }.
  const requestAIMeta = async (messages, overrideSettings = {}, options = {}) => {
    const effectiveSettings = buildAgentRequestSettings(settings, overrideSettings)
    const finalMessages = attachSessionFilesToMessages(messages, settings)

    const meta = await callAIWithMeta(finalMessages, effectiveSettings, {
      ...options,
      // Thread the session's abort signal into every call so the Stop button
      // cancels the in-flight request instead of only being seen between steps.
      signal: options?.signal ?? abortSignal,
    })
    recordAgentRequestUsage(usageTracker, meta, finalMessages)
    return meta
  }

  // Text-only convenience wrapper (most callers).
  const requestAI = async (messages, overrideSettings = {}) =>
    String((await requestAIMeta(messages, overrideSettings))?.text || '')

  // Resolves the current timeout and safety snapshots without changing session state.
  const resolveSessionToolTimeoutMs = (toolName) => resolveSessionToolTimeout(toolName, sessionLimitState)
  const buildSessionSafety = () =>
    buildSessionSafetySnapshot({
      safetyConfig,
      sessionStepBudget,
      approvalState,
      sessionLimitState,
    })

  // Requests user approval to extend a session after a recoverable execution limit is reached.
  const requestLimitOverride = async ({ kind, toolName, message, step, context = {} }) => {
    if (!onApprovalRequest) {
      return { approved: false, decision: 'deny' }
    }

    const requestedTool = String(toolName || 'agent.session').trim()
    const reason = String(message || 'A runtime limit was reached.').trim()
    const normalizedKind = String(kind || 'generic_limit').toLowerCase()
    const requestedAction = `continue ${requestedTool}`

    const approvalResponse = await onApprovalRequest({
      modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
      requestType: 'limit',
      limitKind: normalizedKind,
      requestedTool,
      requestedAction,
      reason,
      stepAction: {
        tool: requestedTool,
        step,
        limitKind: normalizedKind,
        ...context,
      },
      limitContext: {
        step,
        searchCallsUsed: Number(webSearchState?.callsUsed || 0),
        searchCallBudget: Number(webSearchState?.maxCalls || 0),
        ...context,
      },
      options: buildLimitDecisionOptions(normalizedKind),
      recommendedDecision: 'continue',
    })

    return normalizeApprovalResponse(approvalResponse)
  }

  // Applies limit decision to the current state using the rules owned by the agent session runtime.
  const applyLimitDecision = ({ decision, kind, toolName, context = {} }) => {
    const normalizedDecision = normalizeApprovalDecisionToken(decision)

    if (!['approve', 'continue', 'extend', 'unlimited'].includes(normalizedDecision)) {
      return {
        approved: false,
        allowRetry: false,
        message: `User denied ${kind || 'limit'} override for ${toolName || 'agent.session'}.`,
      }
    }

    if (normalizedDecision === 'unlimited') {
      sessionLimitState.unlimited = true
      if (webSearchState) {
        webSearchState.maxCalls = Math.max(Number(webSearchState.maxCalls || 0), SEARCH_WEB_UNLIMITED_CALL_BUDGET)
      }

      const unlimitedRetryDelayMs =
        kind === 'rate_limit' ? Math.max(2000, Math.min(30000, Number(context?.retryAfterMs || 10000))) : 0

      return {
        approved: true,
        allowRetry: true,
        retryDelayMs: unlimitedRetryDelayMs,
        message: 'Unlimited session mode enabled for this run (expanded search and timeout limits).',
      }
    }

    if (kind === 'rate_limit') {
      const suggestedDelayMs = Number(context?.retryAfterMs || 0)
      const decisionDelayMs = normalizedDecision === 'extend' ? 9000 : 4500
      const retryDelayMs = Math.max(1500, Math.min(30000, suggestedDelayMs > 0 ? suggestedDelayMs : decisionDelayMs))

      return {
        approved: true,
        allowRetry: true,
        retryDelayMs,
        message: `Rate limit override approved. Waiting ${Math.ceil(retryDelayMs / 1000)}s before retry.`,
      }
    }

    if (kind === 'search_budget') {
      const increment =
        normalizedDecision === 'extend' ? SEARCH_BUDGET_EXTEND_INCREMENT : SEARCH_BUDGET_CONTINUE_INCREMENT

      if (webSearchState) {
        const currentBudget = Number.isFinite(Number(webSearchState.maxCalls))
          ? Number(webSearchState.maxCalls)
          : SEARCH_WEB_DEFAULT_CALL_BUDGET
        webSearchState.maxCalls = Math.min(SEARCH_WEB_UNLIMITED_CALL_BUDGET, currentBudget + increment)
      }

      return {
        approved: true,
        allowRetry: true,
        message: `Search budget increased by ${increment}.`,
      }
    }

    if (kind === 'tool_timeout') {
      const incrementMs =
        normalizedDecision === 'extend' ? TOOL_TIMEOUT_EXTEND_BOOST_MS : TOOL_TIMEOUT_CONTINUE_BOOST_MS
      const key = String(toolName || '').trim()
      if (key) {
        const previousBoost = Number(sessionLimitState.toolTimeoutBoostMs[key] || 0)
        sessionLimitState.toolTimeoutBoostMs[key] = previousBoost + incrementMs
      }

      return {
        approved: true,
        allowRetry: true,
        message: `${key || 'Tool'} timeout budget increased by ${Math.round(incrementMs / 1000)}s.`,
      }
    }

    if (String(toolName || '').trim()) {
      const key = String(toolName || '').trim()
      const incrementMs =
        normalizedDecision === 'extend' ? TOOL_TIMEOUT_EXTEND_BOOST_MS : TOOL_TIMEOUT_CONTINUE_BOOST_MS
      const previousBoost = Number(sessionLimitState.toolTimeoutBoostMs[key] || 0)
      sessionLimitState.toolTimeoutBoostMs[key] = previousBoost + incrementMs
    }

    return {
      approved: true,
      allowRetry: true,
      message: 'Limit override approved. Continuing task.',
    }
  }

  // Duration check-in: when the time budget elapses, ask the user (in chat) whether to keep
  // going. "Continue" doubles the budget (exponential); a typed number of minutes runs that
  // long then stops (durationFinal). Returns true when the run should STOP. Shared by both loops.
  const checkDurationBudget = async (step) => {
    if (Date.now() < sessionDeadline) return false

    const elapsedMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

    // No UI to ask → stop at the budget rather than run unbounded.
    if (!onApprovalRequest) {
      limitStopReason = `Stopped after ${elapsedMin} minute(s) — the time budget was reached.`
      traceTool.thinking(limitStopReason, { step })
      return true
    }

    const resumeState = agentState.current
    agentState.current = AGENT_STATES.DELEGATED_PAUSE
    let response
    try {
      response = await onApprovalRequest({
        modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
        requestType: 'question',
        question: `IRIS has been working on this task for ${elapsedMin} minutes. How would you like to proceed?`,
        requestedAction: 'continue the long-running task',
        // Continue (double the threshold, warn again), Halt (stop), or type a steer to inject.
        options: [
          { id: 'continue', label: 'Continue', value: 'Continue' },
          { id: 'halt', label: 'Halt', value: 'Halt' },
        ],
        allowOther: true, // free text = a steering instruction
        recommendedDecision: 'continue',
      })
    } finally {
      agentState.current = resumeState
    }

    if (response?.stopped) {
      limitStopReason = `Halted at the ${elapsedMin}-minute check-in.`
      traceTool.thinking(limitStopReason, { step })
      return true
    }

    const answer = String(response?.answer ?? '').trim()

    // Halt — stop now.
    if (/^(halt|stop|cancel)$/i.test(answer)) {
      limitStopReason = `Halted at the ${elapsedMin}-minute check-in.`
      traceTool.thinking(limitStopReason, { step })
      return true
    }

    // Continue — exponential backoff: double the budget and check in again at the new threshold.
    if (!answer || /^continue$/i.test(answer)) {
      sessionBudgetMs *= 2
      sessionDeadline = Date.now() + sessionBudgetMs
      traceTool.thinking(
        `Continuing — time budget doubled to ${Math.round(sessionBudgetMs / 60000)} minute(s); will check in again then.`,
        { step },
      )
      return false
    }

    // Steer — inject the user's instruction and keep working (extend the budget so it has room to
    // act on the steer before the next check-in).
    pendingUserSteer = answer
    sessionBudgetMs *= 2
    sessionDeadline = Date.now() + sessionBudgetMs
    traceTool.thinking(
      `Steering on your input — injected "${answer.slice(0, 120)}${answer.length > 120 ? '…' : ''}"; continuing (budget doubled).`,
      { step },
    )
    return false
  }

  // Continuous Overwatch (opt-in): when enabled, the Overwatcher re-assesses progress every few
  // steps and returns a fresh steer the loop injects so the reasoning model keeps guiding the
  // active agent — not just at the start. Off by default; only with the bridge + an Overwatcher.
  // Event-driven: the Overwatcher steps in on DRIFT (a run going sideways), not on a fixed clock.
  // Debounced so it doesn't re-fire every step once drift starts.
  const OVERWATCH_MIN_GAP = 3
  let lastOverwatchStep = 0
  const continuousOverwatch =
    settings?.agent_multi_enabled === true && settings?.agent_overwatch_continuous === true && hasOverwatcher(settings)
  // Drift signals derived from recent history: a run of tool failures, or the same tool fired
  // repeatedly (a loop). Returns true when the Overwatcher should weigh in.
  const detectDrift = () => {
    let trailingFailures = 0
    for (let i = stepHistory.length - 1; i >= 0 && stepHistory[i] && stepHistory[i].ok === false; i -= 1) {
      trailingFailures += 1
    }
    const recent = stepHistory.slice(-3)
    const repeatedTool = recent.length >= 3 && new Set(recent.map((s) => String(s?.tool || ''))).size === 1
    return trailingFailures >= 2 || repeatedTool
  }
  const runContinuousOverwatchSteer = async (step) => {
    if (!continuousOverwatch) return ''
    // Hold off while a question is outstanding: the run is paused on the user, so the Overwatcher
    // must not think or inject steering until they answer.
    if (questionPending) return ''
    // Fire only on drift, and not within OVERWATCH_MIN_GAP steps of the last intervention.
    if (step - lastOverwatchStep < OVERWATCH_MIN_GAP || !detectDrift()) return ''
    lastOverwatchStep = step
    try {
      const progress = stepHistory
        .slice(-6)
        .map((s) => `${s?.tool || '?'}: ${String(s?.summary || '').slice(0, 160)}`)
        .join('\n')
        .slice(0, 1500)
      const overwatchColor = colorForAgent('overwatcher')
      const ov = await runOverwatch(
        { task: userInput, context: progress },
        settings,
        (event) => {
          if (event?.type === 'thinking' && typeof event.summary === 'string' && event.summary.trim()) {
            onEvent?.({
              type: 'thinking',
              summary: `[Overwatcher] ${event.summary.trim().slice(0, 2000)}`,
              source: 'subagent',
              subAgentRole: 'overwatcher',
              roleLabel: 'Overwatcher',
              agentColor: overwatchColor,
              agentTags: tagsForRole('overwatcher', settings),
              at: Date.now(),
              step,
            })
          }
        },
        abortSignal,
      )
      if (ov.available && (ov.guidance || ov.escalate)) {
        const esc = ov.escalate
          ? ` Escalate: pull in a peer${ov.suggestedTags?.length ? ` tagged ${ov.suggestedTags.join(', ')}` : ''} via agent.find/agent.consult.`
          : ''
        const steer = `Overwatcher (complexity ${ov.complexity}): ${ov.guidance}${esc}`
        onEvent?.({
          type: 'thinking',
          summary: `Overwatcher steer injected mid-run →  ${steer}`,
          source: 'subagent',
          subAgentRole: 'overwatcher',
          roleLabel: 'Overwatcher',
          agentColor: overwatchColor,
          at: Date.now(),
          step,
        })
        return steer
      }
    } catch {
      /* continuous overwatch is advisory + best-effort */
    }
    return ''
  }

  let capabilitySnapshot = buildCapabilitySnapshot({
    settings,
    safetyConfig: {
      ...safetyConfig,
      maxSteps: sessionStepBudget,
    },
    userApprovalGranted: approvalState.granted,
    sessionPermissionOverrides: approvalState.sessionPermissionOverrides,
  })

  const continuityContext = getContinuityContext({ userInput })
  // Relevance-gated recall: surface only durable notes that relate to THIS request
  // (or nothing). Computed once; the model can pull more via memory.query.
  const relevantMemory = recallRelevantNotes(userInput, {
    limit: 3,
    minScore: 0.5,
  })
  // Per-chat encrypted memory: the chat's durable plan, always surfaced (small)
  // so the agent keeps sight of the goal and maintains it via chat.remember. Earlier
  // history is NOT auto-injected — the model pulls it via chat.recall only if the
  // request relates to prior work here.
  const chatSessionId = settings?.chat_session?.id || ''
  let chatMemory = ''
  if (chatSessionId) {
    try {
      chatMemory = String((await chatsReadMemory(chatSessionId)) || '').slice(0, 4000)
    } catch {
      chatMemory = ''
    }
  }
  const webSearchState = createWebSearchSessionState(settings)

  // Planning seeds the todo list with the co-planned, owner-tagged parts; otherwise start from
  // whatever was passed in (warm-session restore). Planned parts win when present.
  let todoSnapshot = planSeedTodos.length ? planSeedTodos : Array.isArray(todos) ? todos : []

  const traceTool = createTraceTool(timeline, onEvent, () => todoSnapshot)

  const todoTool = createTodoTool(todoSnapshot, traceTool, (updated) => {
    todoSnapshot = updated
  })

  traceTool.phase('session', 'Agent session started.', { channel: 'steering' })

  const dispatchCloudRequest = async ({ candidate, purpose, reason, messages, options = {}, step }) => {
    if (!candidate) throw new Error('No cloud model is available for this request.')
    const state = getCloudUsageState(settings)
    if (!state || !canUseCloud(state, purpose)) {
      throw new Error('The cloud request safety budget is exhausted.')
    }
    const requestNumber = state.used + 1
    const requestStartedAt = Date.now()
    traceTool.raw({
      type: 'cloud_request',
      provider: candidate.provider,
      model: candidate.model,
      purpose,
      reason: String(reason || '').slice(0, 500),
      requestNumber,
      requestLimit: state.max,
      summary: `${candidate.provider} · ${candidate.model}${reason ? ` — ${String(reason).slice(0, 180)}` : ''}`,
      step,
    })
    try {
      const cloudSettings = buildCloudRequestSettings(settings, candidate)
      const meta = await callAIWithMeta(messages, cloudSettings, {
        ...options,
        cloudPurpose: purpose,
        signal: options?.signal ?? abortSignal,
      })
      recordAgentRequestUsage(usageTracker, meta, messages)
      traceTool.raw({
        type: 'cloud_response',
        provider: candidate.provider,
        model: candidate.model,
        purpose,
        requestNumber,
        status: 'ok',
        durationMs: Date.now() - requestStartedAt,
        summary: `${candidate.provider} · ${candidate.model} returned`,
        step,
      })
      return { meta, requestNumber }
    } catch (error) {
      traceTool.raw({
        type: 'cloud_response',
        provider: candidate.provider,
        model: candidate.model,
        purpose,
        requestNumber,
        status: 'error',
        durationMs: Date.now() - requestStartedAt,
        summary: `${candidate.provider} · ${candidate.model} failed: ${String(error?.message || error).slice(0, 180)}`,
        step,
      })
      throw error
    }
  }

  // Compatibility policy tool: the unified mesh may call remote peers through normal delegation,
  // while cloud.consult remains an explicit, observable way to request a narrow cloud opinion.
  const requestCloudConsult = hybridExecution
    ? async ({ question, reason, context, step }) => {
        const candidate = selectCloudConsultModel(
          hybridExecution.cloudCandidates,
          `${question}\n${reason || ''}`,
          hybridExecution.finalResponder,
        )
        const contextText = typeof context === 'string' ? context : context ? JSON.stringify(context, null, 2) : ''
        const { meta, requestNumber } = await dispatchCloudRequest({
          candidate,
          purpose: 'consult',
          reason,
          step,
          messages: [
            {
              role: 'system',
              content:
                'You are a focused cloud consultant helping a local coordinating agent. Answer only the narrow question, use only supplied evidence, identify uncertainty, and never claim to have run tools you did not run.',
            },
            {
              role: 'user',
              content: `Question:\n${question}\n\nWhy help is needed:\n${reason || 'A second opinion is useful.'}${
                contextText ? `\n\nRelevant context:\n${contextText.slice(0, 24000)}` : ''
              }`,
            },
          ],
        })
        return {
          consulted: true,
          untrusted: true,
          provider: candidate.provider,
          model: candidate.model,
          requestNumber,
          answer: String(meta?.text || '').trim(),
        }
      }
    : null

  // Mode-aware ownership: in hybrid mode the local model coordinates and performs tool work, but
  // the user-selected cloud responder synthesizes the final answer when it is available. If that
  // call fails or the budget is exhausted, the verified local draft is returned unchanged.
  const finalizeHybridReply = async (localDraft) => {
    const draft = String(localDraft || 'Done.')
    if (!hybridExecution || abortSignal?.aborted || agentState.current === AGENT_STATES.STOPPED) {
      return draft
    }
    const state = getCloudUsageState(settings)
    if (!state || !canUseCloud(state, 'final')) {
      traceTool.raw({
        type: 'notice',
        level: 'error',
        summary: 'Cloud request budget exhausted before final synthesis. Returning the local result.',
      })
      return draft
    }

    const recentWork = stepHistory
      .slice(-30)
      .map((entry) => {
        const status = entry.ok === false ? `error: ${entry.error || ''}` : entry.summary || 'ok'
        return `- ${entry.tool || 'action'}: ${String(status).slice(0, 500)}`
      })
      .join('\n')
    const todoSummary = todoTool
      .list()
      .slice(0, 20)
      .map((todo) => `- [${todo.status}] ${todo.text}`)
      .join('\n')

    try {
      const { meta } = await dispatchCloudRequest({
        candidate: hybridExecution.finalResponder,
        purpose: 'final',
        reason: 'Final response synthesis',
        messages: [
          {
            role: 'system',
            content:
              'You are the user-selected final responder. A local coordinating agent already performed planning, retrieval, tools, edits, and verification. Produce the final user-facing answer from the supplied work record. Be accurate about what was and was not completed and do not invent results.',
          },
          {
            role: 'user',
            content: `Original request:\n${String(userInput).slice(0, 12000)}\n\nLocal verified draft:\n${draft.slice(0, 24000)}${
              recentWork ? `\n\nRecent verified work:\n${recentWork}` : ''
            }${todoSummary ? `\n\nTask state:\n${todoSummary}` : ''}`,
          },
        ],
      })
      return String(meta?.text || '').trim() || draft
    } catch (error) {
      traceTool.raw({
        type: 'notice',
        level: 'error',
        summary: `Cloud final response failed; returning the local result (${String(error?.message || error).slice(0, 160)}).`,
      })
      return draft
    }
  }

  // No forced seed: todos are model-driven (todo.update), created only for genuinely
  // multi-step work — a blanket seed produced identical, inaccurate lists and taxed
  // trivial requests. Decomposition guidance lives in the orbit-problem-solving skill.
  // (Incoming `todos` from a warm session are kept as-is.)

  traceTool.thinking(
    `Safety profile "${safetyConfig.profile}" active (sudo ${safetyConfig.blockSudo ? 'blocked' : 'allowed'}, network commands ${safetyConfig.allowNetworkCommands ? 'allowed' : 'blocked'}).`,
    { channel: 'steering' },
  )

  if (safetyConfig.requireExplicitApproval) {
    traceTool.thinking(
      `Explicit approval mode is on (${approvalState.granted ? 'approval detected in request' : 'approval missing for risky tools'}).`,
      { channel: 'steering' },
    )
  }

  if (continuityContext.resumeIntent) {
    traceTool.thinking('Resume intent detected — relevant prior session notes will be surfaced if any match.', {
      channel: 'steering',
    })
  }

  if (Array.isArray(relevantMemory) && relevantMemory.length) {
    traceTool.thinking(`Relevant memory: ${relevantMemory.length} note(s) matched this request.`, {
      channel: 'steering',
    })
  }

  if (sessionDebriefLine) {
    traceTool.thinking(`Session debrief: ${sessionDebriefLine}`, {
      channel: 'steering',
    })
  }

  if (isUserCorrection) {
    traceTool.thinking('User correction detected. Will record preference note at session end.', {
      channel: 'steering',
    })
  }

  traceTool.thinking(
    `Runtime resources: ${capabilitySnapshot.availableTools.length} tools currently available (${capabilitySnapshot.executionMode}).`,
    { channel: 'steering' },
  )

  // Session role for skill loading — the main runAgentSession loop is ALWAYS the
  // orchestrator/controller (it is the one that plans and may delegate), so it
  // loads orchestrator + universal skills regardless of which provider backs it.
  // (resolveCurrentRole is a provider heuristic for sub-agent identity and would
  // mislabel e.g. an OpenRouter/gpt controller as "executor".) Skills the agent
  // later offloads via skills.offload are excluded on subsequent steps; skillState
  // is a shared holder so the tool broker can mutate the offloaded set live.
  const sessionRole = 'orchestrator'
  const offloadedSkillIds = new Set()
  const skillState = { offloadedIds: offloadedSkillIds, context: null }

  // Per-run mesh conductor (Workstream D): owns the peer-consult budget/depth/cycle ledger.
  // Off (every gate fails closed) unless the bridge AND peer consultation are enabled.
  const meshConductor = createMeshConductor(settings, sessionRole)

  const broker = createModuleBroker({
    settings,
    meshConductor,
    todoTool,
    traceTool,
    safetyConfig,
    approvalState,
    // The shared run-state so the broker's delegate/consult/overwatch/review handlers can pause the
    // loop (and so they don't crash with "agentState is not defined").
    agentState,
    webSearchState,
    userInput,
    requestAI,
    requestCloudConsult,
    onApprovalRequest,
    stepHistory,
    skillState,
    onArtifact: (artifact) => {
      if (artifact && typeof artifact === 'object') sessionArtifacts.push(artifact)
    },
  })
  // Tool over-abuse guard (shared by both loops): blocks blind repeats of the
  // exact same call — which is simultaneously over-use AND a failure to read the
  // prior result. Narrow by design so it does not debuff capable models; the cap
  // is the per-model-family retune lever (agent_tool_repeat_cap).
  const toolGuard = createToolGuard({
    maxRepeat: Number(settings?.agent_tool_repeat_cap) || 4,
  })
  const skillContext = await loadSkillContext({
    settings,
    userInput,
    conversation,
    role: sessionRole,
    offloadedIds: offloadedSkillIds,
    toolset: sessionToolset,
  })
  skillState.context = skillContext

  // Capture which skill IDs were triggered so the reward system can score later
  const triggeredSkillIds = Array.isArray(skillContext.active)
    ? skillContext.active.map((s) => String(s.id || '')).filter(Boolean)
    : []

  if (skillContext.enabled) {
    traceTool.thinking(
      `Skills profile "${skillContext.profile}" loaded for ${sessionRole} (${skillContext.available} available, ${skillContext.active.length} active, ${skillContext.tokensUsed}/${skillContext.tokenBudget} tokens).`,
      { channel: 'steering' },
    )
    if (skillContext.loadError) {
      traceTool.thinking(`Skills warning: ${skillContext.loadError}`, {
        channel: 'steering',
      })
    }
  }

  // Surface live sub-agent activity (executor/scout) in this session's timeline,
  // clearly tagged by role, so delegated work shows its thinking just like the
  // orchestrator. Only active when multi-agent is enabled; always unsubscribed
  // before returning to avoid leaking a listener into the next session.
  const ROLE_LABELS = {
    executor: 'Executor',
    scout: 'Scout',
    orchestrator: 'Orchestrator',
  }
  // Forwards sub agent event into the orchestrator's visible activity stream.
  const forwardSubAgentEvent = (evt) => {
    if (!evt) return
    // agentId is the MEMBER id (executor#2); collapse to the role for color, but show the specific
    // member + its model in the label — we run per-MODEL now, not per-role.
    const memberId = String(evt.agentId || evt.role || 'sub-agent')
    const role = String(evt.role || memberId.split('#')[0] || 'sub-agent')
    const baseLabel = ROLE_LABELS[role] || role
    const roleLabel = memberId.includes('#') ? `${baseLabel} #${memberId.split('#')[1]}` : baseLabel
    const model = String(evt.model || '')
    const tag = model ? `${roleLabel} · ${model}` : roleLabel
    traceTool.raw({
      ...evt,
      source: 'subagent',
      subAgentRole: role,
      roleLabel,
      // Event-level model attribution (Workstream D): a stable per-model color + the model's
      // ability tags so the console can render per-model lanes and a color legend.
      agentColor: colorForAgent(role),
      agentTags: tagsForRole(role, settings),
      // Prefix free-text with the member + model so it reads clearly even without the badge.
      summary: evt.summary ? `[${tag}] ${evt.summary}` : evt.summary,
    })
  }
  const unsubscribeSubAgents =
    settings?.agent_multi_enabled === true ? subscribeSubAgentEvents(forwardSubAgentEvent) : () => {}

  // ════════════════════════════════════════════════════════════════════════════
  // STATEFUL CONVERSATIONAL LOOP (flag-gated — agent_stateful_loop + native tools)
  // ════════════════════════════════════════════════════════════════════════════
  // The real multi-turn agent loop: ONE persistent `messages[]` where the model
  // sees its own assistant{tool_use} turns and the FULL tool_result outputs, so it
  // reasons across steps, recovers from truncation/errors, and streams its prose
  // reasoning live. Mirrors subAgentRuntime.executeSTP, scaled to the orchestrator
  // (full toolset, todos, skills, safety/approvals, transcript compaction, usage).
  // Deliberately omits the legacy single-shot hijacks (forced notes.list, forced
  // tool actions, relevance-blind continuity dumping, default post-hoc synthesis) —
  // the model drives. Early-returns, so the legacy loop below is skipped entirely.
  // Extracting this into agent/conversationLoop.js is a clean follow-up once proven
  // (kept inline now to share the session closures with guaranteed-correct binding).
  if (shouldUseStatefulLoop(settings)) {
    // Build the durable final-result envelope (same shape both loops return).
    const finishStateful = async (reply) => {
      const finalText = await finalizeHybridReply(reply)
      const persisted = persistContinuityNote({
        userInput,
        reply: finalText,
        stepHistory,
        skillContext,
        continuityContext,
        chatMemoryActive: Boolean(chatSessionId),
      })
      if (persisted?.title) traceTool.thinking(`Saved continuity note "${persisted.title}".`)
      const toolsUsed = stepHistory.map((s) => s.tool).filter(Boolean)
      const rewardResult = scoreSession({
        triggeredSkillIds,
        toolsUsed,
        finalReply: finalText,
      })
      const rewardStore = recordReward(rewardResult, String(userInput || '').slice(0, 60))
      onEvent?.({
        type: 'reward',
        result: rewardResult,
        totals: rewardStore.totals,
      })
      if (isUserCorrection) {
        try {
          recordUserPreferenceNote(userInput)
        } catch {
          /* non-fatal */
        }
      }
      try {
        clearSessionScopedNotes()
      } catch {
        /* non-fatal */
      }
      unsubscribeSubAgents()
      return {
        reply: finalText,
        keptAlive: keepAliveCommitted,
        timeline,
        todos: todoTool.list(),
        steps: stepHistory.length,
        stepHistory,
        artifacts: sessionArtifacts,
        skills: {
          profile: skillContext.profile,
          active: skillContext.active,
          triggered: triggeredSkillIds,
        },
        reward: rewardResult,
        safety: buildSessionSafety(),
        summary: buildRunSummary({
          timeline,
          stepHistory,
          startedAt,
          skillContext,
          safetyConfig: { ...safetyConfig, maxSteps: sessionStepBudget },
          userApprovalGranted: approvalState.granted,
          usage: buildUsageSummary(usageTracker),
        }),
      }
    }

    // Force-session-alive: commit this turn's final answer (via onContinue) and park the loop until
    // the user sends the next message in this chat. Returns the next user turn to continue with, or
    // null to finish (user left the chat / stopped). Each parked turn gets its own fresh timeline.
    const parkSession = async (reply) => {
      if (!keepAlive || typeof onContinue !== 'function' || abortSignal?.aborted) return null
      const turnReply = await finalizeHybridReply(reply)
      let cont = null
      try {
        cont = await onContinue({
          reply: turnReply,
          timeline: timeline.slice(),
          todos: todoTool.list(),
        })
      } catch {
        cont = null
      }
      const nextText = String(cont?.text ?? '').trim()
      if (!nextText || abortSignal?.aborted) return null
      keepAliveCommitted = true
      messages.push({ role: 'assistant', content: turnReply })
      messages.push({ role: 'user', content: nextText })
      timeline.length = 0 // each kept-alive turn renders its own timeline
      questionAwaits = 0
      pendingUserSteer = ''
      return nextText
    }

    // Stable tool surface for the whole conversation (cache-friendly — built once).
    const initialPayload = buildControllerPayload({
      userInput,
      conversation,
      todos: todoTool.list(),
      stepHistory,
      stepIndex: 1,
      skillContext,
      continuityContext,
      relevantMemory,
      chatMemory,
      webSearchState,
      safetyConfig,
      sessionStepBudget,
      userApprovalGranted: approvalState.granted,
      capabilitySnapshot,
      toolset: sessionToolset,
    })
    const statefulTools = buildJsonSchemaTools(Array.isArray(initialPayload.tools) ? initialPayload.tools : [])

    // Persistent transcript. System prompt is stable across the run → caches. The
    // first user turn carries the task + compact state (todos + skill cards). The
    // controller state header injects continuity ONLY on an explicit resume intent
    // (no relevance-blind note dumping — that legacy behaviour is gone here).
    // Parallel-tool enabler (stateful loop only — this loop executes every tool
    // call in a turn; the legacy single-shot loop cannot, so it is NOT added
    // there). Minimal nudge; the broader prompt tuning is a separate pass.
    const statefulSystem = `${leanControllerSystem}\n\n# Parallel actions\nWhen the user asks for multiple independent things (e.g. "open A and B"), issue ALL the tool calls in a SINGLE step rather than one at a time — they run together and you get every result at once. Only sequence calls when one genuinely depends on another's output.`
    const messages = [
      { role: 'system', content: statefulSystem },
      {
        role: 'user',
        content: buildControllerStateHeader(initialPayload, screenContext),
      },
    ]

    // v1 robustness: avoid Anthropic's signed-thinking-block preservation rule by
    // not enabling extended thinking inside the persistent conversation (the model
    // still streams its prose reasoning). Preserving signed thinking blocks across
    // turns is a provider-level follow-up; see agent_stateful_loop notes.
    // failoverOverride (spread at call time) carries the swapped model after a failover switch.
    const statefulCallSettings = { extended_thinking: false }

    // Transcript compaction (on the REAL conversation, not a re-summary from
    // scratch): when the measured prompt nears the window, collapse everything
    // between the system turn and the most-recent pairs into ONE summary user turn.
    // Keeps assistant/tool PAIRS intact (provider validity) and avoids two adjacent
    // user turns (Anthropic role-alternation).
    const maybeCompactTranscript = async (stepNo) => {
      const measured = Number(usageTracker?.lastPromptTokens || 0)
      if (measured <= 0) return
      const warnRatio = Number(settings?.context_budget_warn_ratio) || CONTEXT_BUDGET_WARN_RATIO
      if (modelContextWindow - measured >= modelContextWindow * warnRatio) return
      const KEEP_RECENT = 6 // last 3 assistant/tool pairs
      // messages[0]=system, messages[1]=initial task; pairs are appended after.
      if (messages.length <= 2 + KEEP_RECENT + 2) return
      const middle = messages.slice(2, messages.length - KEEP_RECENT)
      const digest = middle
        .map((m) => {
          if (m.role === 'assistant') {
            const calls = Array.isArray(m.toolCalls) ? m.toolCalls.map((c) => c.name).join(', ') : ''
            return `Assistant${calls ? ` → called ${calls}` : ''}: ${String(m.content || '').slice(0, 300)}`
          }
          if (m.role === 'tool') {
            const tr = Array.isArray(m.toolResults) ? m.toolResults[0] : null
            return `Tool ${tr?.name || ''} result: ${String(tr?.content || '').slice(0, 700)}`
          }
          return `${m.role}: ${String(m.content || '').slice(0, 300)}`
        })
        .join('\n')
      try {
        const summary = await requestAI([
          {
            role: 'system',
            content: `You are IRIS Context Compressor. Produce a dense summary preserving key findings, file paths, decisions, and still-open threads. ${UNTRUSTED_CONTENT_SYSTEM_RULES}`,
          },
          {
            role: 'user',
            content: `Compress this portion of an agent transcript into durable working notes:\n${digest}`,
          },
        ])
        if (summary) {
          messages.splice(1, messages.length - 1 - KEEP_RECENT, {
            role: 'user',
            content: `# Task (continued)\n${String(userInput || '').slice(0, 2000)}\n\n## Progress so far (compacted from ${middle.length} earlier turn(s))\n${String(summary).slice(0, 2400)}\n\nContinue from here.`,
          })
          traceTool.thinking(
            `Context compressed: folded ${middle.length} transcript turn(s) into a carried summary; ${KEEP_RECENT} recent turn(s) retained.`,
            { step: stepNo },
          )
        }
      } catch {
        /* non-fatal */
      }
    }

    // Tool error path: limit/approval classification + single retry, then a
    // tool_result the model can act on. Mirrors the legacy loop's error handling.
    const runStatefulToolError = async ({
      error,
      toolName,
      moduleName,
      args,
      step,
      requestedToolName,
      toolStartedAt,
    }) => {
      let message = error?.message || 'Tool execution failed.'
      let durationMs = Date.now() - toolStartedAt
      const limitIssue = classifyLimitIssue({ toolName, message })
      if (limitIssue && onApprovalRequest) {
        const limitContext = {
          timeoutMs: resolveSessionToolTimeoutMs(toolName),
          ...limitIssue.context,
        }
        const ov = await requestLimitOverride({
          kind: limitIssue.kind,
          toolName,
          message: `${toolName} hit a ${limitIssue.label}. ${message}`,
          step,
          context: limitContext,
        })
        const applied = applyLimitDecision({
          decision: ov.decision,
          kind: limitIssue.kind,
          toolName,
          context: limitContext,
        })
        if (applied.approved) {
          traceTool.thinking(applied.message, { step })
          if (applied.allowRetry) {
            const retryDelayMs = Math.max(0, Number(applied.retryDelayMs || limitContext.retryAfterMs || 0))
            if (retryDelayMs > 0) await waitMs(Math.min(30000, retryDelayMs))
            const retryTimeoutMs = resolveSessionToolTimeoutMs(toolName)
            traceTool.toolCall(toolName, moduleName, args, {
              step,
              timeoutMs: retryTimeoutMs,
              retry: true,
            })
            const retryStartedAt = Date.now()
            try {
              const retryResult = await runWithTimeout(
                broker.execute(toolName, args),
                retryTimeoutMs,
                `${toolName} timed out after ${Math.round(retryTimeoutMs / 1000)}s.`,
              )
              todoTool.completeInProgress(`Completed ${toolName}`)
              traceTool.toolResult(toolName, moduleName, 'ok', retryResult, null, {
                step,
                durationMs: Date.now() - retryStartedAt,
                exitCode: retryResult?.exitCode,
                retry: true,
              })
              stepHistory.push({
                step,
                tool: toolName,
                requestedTool: requestedToolName,
                module: moduleName,
                ok: true,
                durationMs: Date.now() - retryStartedAt,
                summary: markUntrustedExternalContent(toolName, toPreview(retryResult, 300)),
                retried: true,
              })
              return {
                content: toToolResultContent(retryResult, { toolName }),
                ok: true,
              }
            } catch (retryError) {
              message = retryError?.message || 'Tool execution failed after limit override.'
              durationMs = Date.now() - retryStartedAt
            }
          }
        } else {
          message = applied.message || `User denied limit override for ${toolName}.`
        }
      }
      todoTool.blockInProgress(`Blocked on ${toolName}`)
      traceTool.toolResult(toolName, moduleName, 'error', null, message, {
        step,
        durationMs,
      })
      stepHistory.push({
        step,
        tool: toolName,
        requestedTool: requestedToolName,
        module: moduleName,
        ok: false,
        durationMs,
        error: message,
      })
      return { content: `ERROR: ${message}`, ok: false }
    }

    // Nudge once if the local worker tries to finish with genuine work still open.
    let prematureFinishNudged = false

    // Resilience (item: agent sometimes returns no valid output and the run ends
    // early): a single empty/garbled turn or a transient provider error must not end
    // the run. Retry a bounded number of times, then fall back to synthesis.
    let modelCallFailures = 0
    let emptyModelTurns = 0
    const MAX_MODEL_CALL_FAILURES = 2
    const MAX_EMPTY_MODEL_TURNS = 2

    let step = 0
    while (true) {
      step += 1
      // Expose the current step to the tool broker (it reads approvalState.currentStep for trace
      // metadata; the stateful loop previously never set it).
      approvalState.currentStep = step

      if (abortSignal?.aborted) {
        limitStopReason = 'Stopped by user.'
        traceTool.phase('stopped', 'Session halted by user.', { step })
        agentState.current = AGENT_STATES.STOPPED
        return finishStateful(
          `Stopped. I halted the run at your request after ${stepHistory.length} action${stepHistory.length === 1 ? '' : 's'}. Send another message to continue from here.`,
        )
      }

      // Duration check-in (replaces the steps budget): pause for the user when the time
      // budget elapses; stop if they decline or a custom time has run out.
      if (await checkDurationBudget(step)) {
        agentState.current = AGENT_STATES.STOPPED
        return finishStateful(
          limitStopReason || `Stopped after working for the allotted time. Send another message to continue.`,
        )
      }

      // A steer the user typed at the time-threshold check-in — inject it as a real user turn.
      if (pendingUserSteer) {
        messages.push({
          role: 'user',
          content: `[Steer from the user]\n${pendingUserSteer}`,
        })
        pendingUserSteer = ''
      }

      // Continuous Overwatch (opt-in): inject a fresh steer as a turn the model sees next.
      const overwatchSteer = await runContinuousOverwatchSteer(step)
      if (overwatchSteer) {
        messages.push({
          role: 'user',
          content: `[Overwatcher steer — guidance, not the user]\n${overwatchSteer}`,
        })
      }

      await maybeCompactTranscript(step)

      let meta
      try {
        meta = await requestAIMeta(
          messages,
          { ...statefulCallSettings, ...failoverOverride },
          {
            tools: statefulTools,
            ...(settings?.streaming_enabled === false
              ? {}
              : {
                  // Handles token emitted by agent session runner.
                  onToken: (delta) => {
                    try {
                      onEvent?.({
                        type: 'stream',
                        delta: String(delta || ''),
                        step,
                      })
                    } catch {
                      /* non-fatal */
                    }
                  },
                  // Handles thinking token emitted by agent session runner.
                  onThinkingToken: (delta) => {
                    try {
                      onEvent?.({
                        type: 'thinking_stream',
                        delta: String(delta || ''),
                        step,
                      })
                    } catch {
                      /* non-fatal */
                    }
                  },
                }),
          },
        )
      } catch (error) {
        // A user-initiated Stop aborts the in-flight request mid-call — end the
        // run cleanly with what we have rather than reporting a controller error.
        if (abortSignal?.aborted || error?.name === 'AbortError') {
          limitStopReason = 'Stopped by user.'
          traceTool.phase('stopped', 'Session halted by user.', { step })
          agentState.current = AGENT_STATES.STOPPED
          return finishStateful(
            `Stopped. I halted the run at your request after ${stepHistory.length} action${stepHistory.length === 1 ? '' : 's'}. Send another message to continue from here.`,
          )
        }
        const errMsg = String(error?.message || 'unknown error')
        modelCallFailures += 1
        traceTool.thinking(
          `Controller call failed (${modelCallFailures}/${MAX_MODEL_CALL_FAILURES}): ${errMsg.slice(0, 200)}`,
          { step },
        )
        if (modelCallFailures <= MAX_MODEL_CALL_FAILURES) {
          // Transient provider/network error — back off briefly and retry the step
          // rather than ending the run on the first failure.
          await waitMs(Math.min(2000, 400 * modelCallFailures))
          continue
        }
        // Retries on THIS model are exhausted → fail over to a healthy model and continue (§F3).
        if (await tryFailover(error, step)) {
          modelCallFailures = 0
          continue
        }
        break
      }

      // The call succeeded → clear this model's failure state + the transient-retry counter.
      recordModelSuccess(activeModel.provider, activeModel.model, activeModel.keyId)
      modelCallFailures = 0

      const toolCalls = Array.isArray(meta?.toolCalls) ? meta.toolCalls : []
      const reasoning = String(meta?.thinkingText || meta?.text || '').trim()
      if (reasoning) traceTool.thinking(reasoning, { step })

      // ── Final answer: the model replied with text and no tool call ────────────
      if (!toolCalls.length) {
        const finalText = String(meta?.text || '').trim()
        if (finalText && !looksLikeControllerSchemaText(finalText)) {
          // B1: the model ended with a clarifying QUESTION as plain text. Don't finish — pause and
          // await the answer in the SAME session (keeps context), then continue. (The agent SHOULD
          // use user.ask; this catches the case where it asks in its final text instead.)
          if (
            onApprovalRequest &&
            !abortSignal?.aborted &&
            questionAwaits < MAX_QUESTION_AWAITS &&
            looksLikeClarifyingQuestion(finalText)
          ) {
            questionAwaits += 1
            traceTool.thinking('Asked the user a question — pausing for their answer (the run stays open).', { step })
            let answer = ''
            let stopped = false
            try {
              const response = await onApprovalRequest({
                modelId: String(activeModel.model || settings?.ai_model || 'model'),
                requestType: 'question',
                question: finalText.slice(0, 1500),
                requestedAction: 'answer a question',
                allowOther: true,
              })
              answer = String(
                (response && typeof response === 'object' ? (response.answer ?? response.decision ?? '') : response) ||
                  '',
              ).trim()
              stopped = Boolean(response?.stopped)
            } catch {
              return finishStateful(finalText) // approval surface failed → accept as final
            }
            if (stopped) return finishStateful(finalText)
            if (!answer) return finishStateful(finalText) // timed out / no answer → accept
            messages.push({ role: 'assistant', content: finalText })
            messages.push({ role: 'user', content: answer })
            continue
          }
          // Premature-finish guard (Phase H): if the model finalizes with todos
          // still open and budget to spare, nudge it ONCE to finish or reconcile
          // them rather than stopping mid-task. After the nudge, accept its answer.
          const openTodos =
            settings?.agent_finish_open_todos === false
              ? []
              : todoTool.list().filter((t) => {
                  const s = String(t?.status || '').toLowerCase()
                  return s === 'pending' || s === 'in_progress'
                })
          if (openTodos.length > 0 && !prematureFinishNudged) {
            prematureFinishNudged = true
            const list = openTodos
              .slice(0, 6)
              .map((t) => `- ${String(t.text || '').slice(0, 100)}`)
              .join('\n')
            messages.push({ role: 'assistant', content: finalText })
            messages.push({
              role: 'user',
              content: `Hold on — you're finishing, but ${openTodos.length} todo(s) are still open:\n${list}\nFinish them now. If any are genuinely done or intentionally out of scope, mark them done/blocked with todo.update and explain, then give your final answer.`,
            })
            traceTool.thinking(
              `Premature finish with ${openTodos.length} open todo(s) — nudged to finish or reconcile before accepting.`,
              { step },
            )
            continue
          }
          todoTool.completeInProgress('Deliver final answer')
          traceTool.phase('final', 'Controller produced final response.', {
            step,
          })
          // Force session alive: park on this answer and continue in the SAME session when the user
          // replies; only finish (close the session) when they leave the chat or stop.
          if (keepAlive) {
            const next = await parkSession(finalText)
            if (next) continue
          }
          return finishStateful(finalText)
        }
        // Empty or schema-leak output with no tool call. Give the model one more
        // chance with a corrective nudge before falling back to synthesis — a single
        // bad turn shouldn't end the run. (Same push-and-continue pattern as the
        // premature-finish nudge above.)
        emptyModelTurns += 1
        if (emptyModelTurns <= MAX_EMPTY_MODEL_TURNS) {
          messages.push({
            role: 'assistant',
            content: String(meta?.text || '').slice(0, 4000) || '(no output)',
          })
          messages.push({
            role: 'user',
            content:
              'Your last response was empty or malformed. Continue the task: either call exactly one tool to make progress, or give your final answer as plain natural-language text (not a JSON control object).',
          })
          traceTool.thinking(
            `Empty/garbled model turn (${emptyModelTurns}/${MAX_EMPTY_MODEL_TURNS}) — nudged to continue before falling back.`,
            { step },
          )
          continue
        }
        break // retries exhausted → drop to best-effort synthesis below
      }

      usageTracker.nativeSteps += 1

      // ── Tool turn: execute EVERY tool call the model issued this step (parallel
      // tool use). One assistant turn carries all tool_use blocks; one tool turn
      // carries all results — so "open VSCode AND Spotify" completes in a single
      // step instead of one-per-step (which confused weak models into repeats).
      // Calls run sequentially in-code (shared approval/limit state is not
      // reentrant), but they all belong to the same model round-trip.
      const assistantTurn = {
        role: 'assistant',
        content: String(meta?.text || ''),
        reasoning_content: String(meta?.thinkingText || ''),
        toolCalls,
      }
      const turnResults = []
      let escalateAfterTurn = false

      for (const call of toolCalls) {
        const requestedToolName = String(call?.name || '').trim()
        const resolution = resolveToolRequest(requestedToolName)
        if (!resolution.resolved) {
          const message = `Unsupported tool "${requestedToolName}". Choose a tool from the provided list.`
          traceTool.toolResult(requestedToolName, 'Unknown', 'error', null, message, {
            step,
            durationMs: 0,
          })
          stepHistory.push({
            step,
            tool: requestedToolName,
            requestedTool: requestedToolName,
            module: 'Unknown',
            ok: false,
            durationMs: 0,
            error: message,
          })
          turnResults.push({
            id: call.id,
            name: requestedToolName,
            content: `ERROR: ${message}`,
          })
          continue
        }

        const toolName = resolution.resolved
        if (resolution.matchedBy !== 'exact') {
          traceTool.thinking(
            `Resolved requested tool "${requestedToolName}" to "${toolName}" using ${resolution.matchedBy} matching.`,
            { step },
          )
        }
        const moduleName = TOOL_BY_NAME[toolName]?.module || 'Unknown'
        const args = call?.args && typeof call.args === 'object' ? call.args : {}

        // Tool over-abuse guard — blocks a blind repeat (same call you already
        // have a result for); distinct calls in the same parallel turn all run.
        const guardVerdict = toolGuard.check(toolName, args)
        if (guardVerdict.blocked) {
          traceTool.thinking(`Tool guard: blocked a repeated ${toolName} call. ${guardVerdict.reason}`, { step })
          stepHistory.push({
            step,
            tool: toolName,
            requestedTool: requestedToolName,
            module: moduleName,
            ok: false,
            durationMs: 0,
            error: 'Tool guard: repeated call blocked.',
          })
          turnResults.push({
            id: call.id,
            name: toolName,
            content: `BLOCKED — ${guardVerdict.reason}`,
          })
          if (guardVerdict.escalate) escalateAfterTurn = true
          continue
        }
        toolGuard.record(toolName, args)

        todoTool.ensureInProgress(`Run ${toolName}`)
        const toolTimeoutMs = resolveSessionToolTimeoutMs(toolName)
        traceTool.toolCall(toolName, moduleName, args, {
          step,
          timeoutMs: toolTimeoutMs,
        })
        const toolStartedAt = Date.now()
        approvalState.currentStep = step

        let resultContent
        try {
          const result = await runWithTimeout(
            broker.execute(toolName, args),
            toolTimeoutMs,
            `${toolName} timed out after ${Math.round(toolTimeoutMs / 1000)}s.`,
          )
          const durationMs = Date.now() - toolStartedAt
          todoTool.completeInProgress(`Completed ${toolName}`)
          traceTool.toolResult(toolName, moduleName, 'ok', result, null, {
            step,
            durationMs,
            exitCode: result?.exitCode,
          })
          stepHistory.push({
            step,
            tool: toolName,
            requestedTool: requestedToolName,
            module: moduleName,
            ok: true,
            durationMs,
            summary: markUntrustedExternalContent(toolName, toPreview(result, 300)),
          })
          resultContent = toToolResultContent(result, { toolName })
          try {
            recordToolHeatmap(inferModelFamily(settings?.ai_model || ''), [toolName])
          } catch {
            /* non-fatal */
          }
          try {
            const allSkills = await listSkillDefinitions('all').catch(() => [])
            const reflexSkills = checkReflexSkills(
              toolName,
              result,
              Array.isArray(allSkills) ? allSkills : allSkills?.skills || [],
            )
            if (reflexSkills.length > 0) {
              traceTool.thinking(
                `Reflex skill(s) triggered by ${toolName}: ${reflexSkills.map((s) => s.title).join(', ')}`,
                { step },
              )
              resultContent += `\n\n${reflexSkills.map((s) => `REFLEX [${s.title}]: ${s.instructions}`).join('\n')}`
            }
          } catch {
            /* non-fatal */
          }
        } catch (error) {
          resultContent = (
            await runStatefulToolError({
              error,
              toolName,
              moduleName,
              args,
              step,
              requestedToolName,
              toolStartedAt,
            })
          ).content
        }
        turnResults.push({
          id: call.id,
          name: toolName,
          content: resultContent,
        })
      }

      messages.push(assistantTurn)
      messages.push({ role: 'tool', toolResults: turnResults })

      if (escalateAfterTurn) {
        traceTool.thinking('Tool guard: repeated blocked calls — finalizing with current findings.', { step })
        break
      }
    }

    // Loop ended without an explicit final answer (rare on capable models): produce
    // a best-effort summary from what actually happened — never a "no tools" claim.
    capabilitySnapshot = buildCapabilitySnapshot({
      settings,
      safetyConfig: { ...safetyConfig, maxSteps: sessionStepBudget },
      userApprovalGranted: approvalState.granted,
      sessionPermissionOverrides: approvalState.sessionPermissionOverrides,
    })
    const stoppedByUser = agentState.current === AGENT_STATES.STOPPED
    const reply = stoppedByUser
      ? `Stopped. I halted the run at your request after ${stepHistory.length} action${stepHistory.length === 1 ? '' : 's'}.`
      : limitStopReason
        ? `${limitStopReason} I paused here. Ask me to keep going and I will continue.`
        : await synthesizeFinalReply({
            userInput,
            conversation,
            stepHistory,
            capabilitySnapshot,
            capabilityBlocked: false,
            requestAI,
          }).catch((error) => `I could not complete the full agent flow. ${error?.message || 'Unknown error.'}`)
    return finishStateful(reply)
  }

  // Resilience: retry a transient provider error a bounded number of times before
  // ending the run (item: run sometimes ends early with no valid response).
  let structuredCallFailures = 0
  const MAX_STRUCTURED_CALL_FAILURES = 2

  for (let step = 1; ; step += 1) {
    // ── User stop request ──────────────────────────────────────────────────
    // If the user clicked Stop, end the loop cleanly with whatever we have.
    if (abortSignal?.aborted) {
      limitStopReason = 'Stopped by user.'
      traceTool.phase('stopped', 'Session halted by user.', { step })
      agentState.current = AGENT_STATES.STOPPED
      break
    }

    // Duration check-in (replaces the steps budget): pause for the user when the time
    // budget elapses; stop if they decline or a custom time has run out.
    if (await checkDurationBudget(step)) {
      agentState.current = AGENT_STATES.STOPPED
      break
    }

    // A steer the user typed at the time-threshold check-in — surface it in the per-step payload.
    if (pendingUserSteer) {
      stepHistory.push({
        tool: 'user_steer',
        ok: true,
        summary: pendingUserSteer,
      })
      pendingUserSteer = ''
    }

    // Continuous Overwatch (opt-in): surface a fresh steer in the per-step payload (this loop
    // rebuilds the payload each step, so a stepHistory note reaches the model next turn).
    const overwatchSteer = await runContinuousOverwatchSteer(step)
    if (overwatchSteer) {
      stepHistory.push({
        tool: 'overwatcher',
        ok: true,
        summary: overwatchSteer,
      })
    }

    // Prune any skills offloaded during this session so they stop consuming the
    // prompt on subsequent steps.
    if (offloadedSkillIds.size && Array.isArray(skillContext.active)) {
      skillContext.active = skillContext.active.filter((s) => !offloadedSkillIds.has(String(s.id)))
    }

    // ── Context budget auto-check ─────────────────────────────────────────
    // Prefer the provider's measured prompt-token count from the previous step
    // (the true context size); fall back to the chars/4 estimate on step 1.
    const measuredPromptTokens = Number(usageTracker?.lastPromptTokens || 0)
    const tokensUsed =
      measuredPromptTokens > 0
        ? measuredPromptTokens
        : estimateContextTokensUsed(
            structuredControllerSystem,
            stepHistory.map((s) => ({
              role: 'assistant',
              content: s.summary || '',
            })),
          )
    const contextRemaining = modelContextWindow - tokensUsed
    if (contextRemaining < modelContextWindow * CONTEXT_BUDGET_WARN_RATIO && stepHistory.length >= 3) {
      traceTool.thinking(
        `Context budget low (${Math.round((contextRemaining / modelContextWindow) * 100)}% remaining). Auto-triggering context.summarize.`,
        { step },
      )
      try {
        const historyDigest = stepHistory
          .map(
            (s, i) => `Step ${i + 1} [${s.tool}] ${s.ok ? 'ok' : 'error'} — ${String(s.summary || '').slice(0, 200)}`,
          )
          .join('\n')
        const summaryResponse = await requestAI([
          {
            role: 'system',
            content: `You are IRIS Context Compressor. Produce a dense summary preserving key findings, file paths, and conclusions. ${UNTRUSTED_CONTENT_SYSTEM_RULES}`,
          },
          {
            role: 'user',
            content: `Compress this step history:\n${historyDigest}`,
          },
        ])
        if (summaryResponse) {
          const originalLen = stepHistory.length
          const dropCount = Math.floor(originalLen * 0.7)
          // Summarize-and-CARRY: fold the dropped steps into a synthetic summary
          // step (previously the summary was generated and then discarded, losing
          // context). Self-healing — each later compaction re-includes this step
          // in its digest, so the carried findings survive across compactions.
          stepHistory.splice(0, dropCount, {
            step: 0,
            tool: 'context.summarize',
            ok: true,
            summary: `[Compacted ${dropCount} earlier step(s)] ${String(summaryResponse).slice(0, 2000)}`,
          })
          traceTool.thinking(
            `Context compressed: folded ${dropCount} step(s) into a carried summary; ${originalLen - dropCount} recent steps retained.`,
            { step },
          )
        }
      } catch {
        /* non-fatal */
      }
    }

    capabilitySnapshot = buildCapabilitySnapshot({
      settings,
      safetyConfig: {
        ...safetyConfig,
        maxSteps: sessionStepBudget,
      },
      userApprovalGranted: approvalState.granted,
      sessionPermissionOverrides: approvalState.sessionPermissionOverrides,
    })

    const payload = buildControllerPayload({
      userInput,
      conversation,
      todos: todoTool.list(),
      stepHistory,
      stepIndex: step,
      skillContext,
      continuityContext,
      relevantMemory,
      chatMemory,
      webSearchState,
      safetyConfig,
      sessionStepBudget,
      userApprovalGranted: approvalState.granted,
      capabilitySnapshot,
      toolset: sessionToolset,
    })

    // ── Controller decision: native tool-calling for capable models, JSON-in-text
    // fallback otherwise. Both paths produce the same `decision` shape, so the
    // whole loop below stays protocol-agnostic.
    // Resolve native-tool support against the EFFECTIVE model (after any failover switch), so a
    // switch from a native to a non-native model routes through the JSON-in-text path correctly.
    const effProvider = failoverOverride.ai_provider || settings?.ai_provider
    const effModel = failoverOverride.ai_model || settings?.ai_model
    const useNativeTools = supportsNativeTools(effProvider, effModel) && settings?.native_tools_enabled !== false

    let decision = null

    try {
      if (useNativeTools) {
        const nativeTools = buildJsonSchemaTools(Array.isArray(payload.tools) ? payload.tools : [])
        if (nativeTools.length) {
          const nativeMeta = await requestAIMeta(
            [
              { role: 'system', content: leanControllerSystem },
              {
                role: 'user',
                content: buildControllerStateHeader(payload, screenContext),
              },
            ],
            { ...failoverOverride },
            // No tool_choice → providers default to "auto" (model picks tool vs
            // final text). onToken streams text deltas live to the UI (capable
            // providers stream; others ignore it and return whole).
            {
              tools: nativeTools,
              ...(settings?.streaming_enabled === false
                ? {}
                : {
                    // Handles token emitted by agent session runner.
                    onToken: (delta) => {
                      try {
                        onEvent?.({
                          type: 'stream',
                          delta: String(delta || ''),
                          step,
                        })
                      } catch {
                        /* non-fatal */
                      }
                    },
                    // Handles thinking token emitted by agent session runner.
                    onThinkingToken: (delta) => {
                      try {
                        onEvent?.({
                          type: 'thinking_stream',
                          delta: String(delta || ''),
                          step,
                        })
                      } catch {
                        /* non-fatal */
                      }
                    },
                  }),
            },
          )
          decision = mapNativeMetaToDecision(nativeMeta)
          if (decision) usageTracker.nativeSteps += 1
        }
      }

      if (!decision) {
        // JSON-in-text path (default, and fallback when native yields nothing usable).
        const stepUserContent = screenContext
          ? [
              { type: 'text', text: JSON.stringify(payload) },
              { type: 'image_url', image_url: { url: screenContext } },
            ]
          : JSON.stringify(payload)

        const raw = await requestAI(
          [
            { role: 'system', content: structuredControllerSystem },
            { role: 'user', content: stepUserContent },
          ],
          { ...failoverOverride },
        )

        decision = normalizeDecision(extractJsonObject(raw), raw)
        usageTracker.jsonSteps += 1
      }
    } catch (error) {
      // Stop pressed mid-call → the in-flight request aborts. End the run cleanly
      // with a Stopped reply instead of bubbling an error (which would otherwise
      // trigger a fresh, un-aborted fallback call in the chat panel).
      if (abortSignal?.aborted || error?.name === 'AbortError') {
        agentState.current = AGENT_STATES.STOPPED
        traceTool.phase('stopped', 'Session halted by user.', { step })
        break
      }
      // Transient provider/network error — back off and retry a bounded number of
      // times before giving up, so one blip doesn't end the run with no answer.
      structuredCallFailures += 1
      if (structuredCallFailures <= MAX_STRUCTURED_CALL_FAILURES) {
        traceTool.thinking(
          `Controller call failed (${structuredCallFailures}/${MAX_STRUCTURED_CALL_FAILURES}): ${String(
            error?.message || 'unknown error',
          ).slice(0, 200)} — retrying.`,
          { step },
        )
        await waitMs(Math.min(2000, 400 * structuredCallFailures))
        continue
      }
      // Retries on THIS model are exhausted → fail over to a healthy model and continue (§F3).
      if (await tryFailover(error, step)) {
        structuredCallFailures = 0
        continue
      }
      throw error
    }

    // The call succeeded → clear this model's failure state + the transient-retry counter.
    recordModelSuccess(activeModel.provider, activeModel.model, activeModel.keyId)
    structuredCallFailures = 0

    if (decision.action.type === 'final' && decision.action.message) {
      const recoveredDecision = recoverDecisionFromSchemaText(decision.action.message)
      if (recoveredDecision?.action?.type === 'tool') {
        decision = recoveredDecision
        traceTool.thinking('Recovered structured tool action from controller-style JSON output.', {
          step,
        })
      } else if (recoveredDecision?.action?.type === 'final' && recoveredDecision.action.message) {
        // The model wrapped its final ANSWER in controller-schema JSON. Unwrap it so the
        // user sees the real message instead of the schema-leak guard discarding it.
        decision = recoveredDecision
        traceTool.thinking('Unwrapped final answer from controller-style JSON output.', { step })
      }
    }

    const hasTodoUpdates = decision.todoUpdates.length > 0

    if (decision.thinking) {
      traceTool.thinking(decision.thinking, { step })
    }

    if (hasTodoUpdates) {
      todoTool.applyUpdates(decision.todoUpdates)
    }

    if (decision.action.type === 'final' && stepHistory.length === 0) {
      const forcedAction = await inferForcedToolActionForRequest({
        userInput,
        capabilitySnapshot,
        requestAI,
      })
      if (forcedAction?.tool) {
        traceTool.thinking(
          `Controller attempted to finalize before tool execution on an actionable request. Forcing ${forcedAction.tool}. ${forcedAction.reason || ''}`.trim(),
          { step },
        )
        decision = {
          ...decision,
          action: {
            type: 'tool',
            tool: forcedAction.tool,
            args: forcedAction.args || {},
          },
        }
      }
    }

    if (decision.action.type === 'final') {
      const finalText = decision.action.message || ''

      if (looksLikeControllerSchemaText(finalText)) {
        traceTool.thinking(
          'Controller returned schema-like JSON as final text. Falling back to synthesized natural-language reply.',
          { step },
        )
        break
      }

      if (looksLikeMissingRequestReply(finalText, userInput)) {
        traceTool.thinking(
          'Controller final reply claimed no user request despite a non-empty prompt. Falling back to synthesized reply.',
          { step },
        )
        break
      }

      const capabilityBlockedSoFar = stepHistory.some(
        (historyStep) => !historyStep.ok && isCapabilityOrPermissionError(historyStep.error),
      )
      if (!capabilityBlockedSoFar && looksLikeToolAccessLimitationReply(finalText)) {
        traceTool.thinking(
          'Controller final reply claimed missing tool/permission access without matching tool errors. Falling back to synthesized reply.',
          { step },
        )
        break
      }

      // B1: a clarifying question as the final text → pause and await the answer in the SAME
      // session (surfaced to the next step via the user_steer payload), instead of ending the run.
      if (
        onApprovalRequest &&
        !abortSignal?.aborted &&
        questionAwaits < MAX_QUESTION_AWAITS &&
        looksLikeClarifyingQuestion(finalText)
      ) {
        questionAwaits += 1
        traceTool.thinking('Asked the user a question — pausing for their answer (the run stays open).', { step })
        let answer = ''
        let stopped = false
        try {
          const response = await onApprovalRequest({
            modelId: String(activeModel.model || settings?.ai_model || 'model'),
            requestType: 'question',
            question: finalText.slice(0, 1500),
            requestedAction: 'answer a question',
            allowOther: true,
          })
          answer = String(
            (response && typeof response === 'object' ? (response.answer ?? response.decision ?? '') : response) || '',
          ).trim()
          stopped = Boolean(response?.stopped)
        } catch {
          /* approval surface failed → accept the answer as final below */
        }
        if (!stopped && answer) {
          pendingUserSteer = answer
          continue
        }
      }

      todoTool.completeInProgress('Deliver final answer')
      traceTool.phase('final', 'Controller produced final response.', { step })

      if (finalText) {
        const persistedNote = persistContinuityNote({
          userInput,
          reply: finalText,
          stepHistory,
          skillContext,
          continuityContext,
          chatMemoryActive: Boolean(chatSessionId),
        })

        if (persistedNote?.title) {
          traceTool.thinking(`Saved continuity note "${persistedNote.title}".`, { step })
        }

        // Score and record reward
        const toolsUsedInSession = stepHistory.map((s) => s.tool).filter(Boolean)
        const rewardResult = scoreSession({
          triggeredSkillIds,
          toolsUsed: toolsUsedInSession,
          finalReply: finalText,
        })
        const rewardStore = recordReward(rewardResult, String(userInput || '').slice(0, 60))
        onEvent?.({
          type: 'reward',
          result: rewardResult,
          totals: rewardStore.totals,
        })

        // Post-session cleanup (W4: no skill-mutation flags — observability-only).
        if (isUserCorrection) {
          try {
            recordUserPreferenceNote(userInput)
          } catch {
            /* non-fatal */
          }
        }
        try {
          clearSessionScopedNotes()
        } catch {
          /* non-fatal */
        }

        unsubscribeSubAgents()
        return {
          reply: finalText,
          timeline,
          todos: todoTool.list(),
          steps: step,
          stepHistory,
          artifacts: sessionArtifacts,
          skills: {
            profile: skillContext.profile,
            active: skillContext.active,
            triggered: triggeredSkillIds,
          },
          reward: rewardResult,
          safety: buildSessionSafety(),
          summary: buildRunSummary({
            timeline,
            stepHistory,
            startedAt,
            skillContext,
            safetyConfig: {
              ...safetyConfig,
              maxSteps: sessionStepBudget,
            },
            userApprovalGranted: approvalState.granted,
            usage: buildUsageSummary(usageTracker),
          }),
        }
      }
      break
    }

    const requestedToolName = decision.action.tool
    if (!requestedToolName) {
      traceTool.thinking('No tool selected by controller. Moving to final response.')
      break
    }

    const resolution = resolveToolRequest(requestedToolName)
    if (!resolution.resolved) {
      const message = `Controller requested unsupported tool "${requestedToolName}". Retrying with available runtime tools.`
      if (!hasTodoUpdates) {
        todoTool.blockInProgress(`Blocked on ${requestedToolName}`)
      }

      traceTool.toolResult(requestedToolName, 'Unknown', 'error', null, message, {
        step,
        durationMs: 0,
      })

      stepHistory.push({
        step,
        tool: requestedToolName,
        requestedTool: requestedToolName,
        module: 'Unknown',
        ok: false,
        durationMs: 0,
        error: message,
      })
      continue
    }

    const toolName = resolution.resolved

    if (resolution.matchedBy !== 'exact') {
      traceTool.thinking(
        `Resolved requested tool "${requestedToolName}" to "${toolName}" using ${resolution.matchedBy} matching.`,
        { step },
      )
    }

    const toolDefinition = TOOL_BY_NAME[toolName]
    const moduleName = toolDefinition?.module || 'Unknown'
    const args = decision.action.args || {}

    // ── Tool over-abuse guard (legacy loop): block a blind repeat; the reason is
    // recorded in stepHistory so the next step's payload surfaces it to the model.
    const guardVerdict = toolGuard.check(toolName, args)
    if (guardVerdict.blocked) {
      traceTool.thinking(`Tool guard: blocked a repeated ${toolName} call. ${guardVerdict.reason}`, { step })
      if (!hasTodoUpdates) todoTool.blockInProgress(`Blocked on ${toolName}`)
      traceTool.toolResult(toolName, moduleName, 'error', null, guardVerdict.reason, {
        step,
        durationMs: 0,
      })
      stepHistory.push({
        step,
        tool: toolName,
        requestedTool: requestedToolName,
        module: moduleName,
        ok: false,
        durationMs: 0,
        error: `Repeated call blocked. ${guardVerdict.reason}`,
      })
      if (guardVerdict.escalate) {
        traceTool.thinking('Tool guard: repeated blocked calls — moving to final response.', {
          step,
        })
        break
      }
      continue
    }
    toolGuard.record(toolName, args)

    if (!hasTodoUpdates) {
      todoTool.ensureInProgress(`Run ${toolName}`)
    }

    const toolTimeoutMs = resolveSessionToolTimeoutMs(toolName)
    traceTool.toolCall(toolName, moduleName, args, {
      step,
      timeoutMs: toolTimeoutMs,
    })
    const toolStartedAt = Date.now()
    approvalState.currentStep = step

    try {
      const result = await runWithTimeout(
        broker.execute(toolName, args),
        toolTimeoutMs,
        `${toolName} timed out after ${Math.round(toolTimeoutMs / 1000)}s.`,
      )
      const durationMs = Date.now() - toolStartedAt

      if (!hasTodoUpdates) {
        todoTool.completeInProgress(`Completed ${toolName}`)
      }

      traceTool.toolResult(toolName, moduleName, 'ok', result, null, {
        step,
        durationMs,
        exitCode: result?.exitCode,
      })

      stepHistory.push({
        step,
        tool: toolName,
        requestedTool: requestedToolName,
        module: moduleName,
        ok: true,
        durationMs,
        summary: markUntrustedExternalContent(toolName, toPreview(result, 300)),
      })

      // Wire tool heatmap tracking
      try {
        const family = inferModelFamily(settings?.ai_model || '')
        recordToolHeatmap(family, [toolName])
      } catch {
        /* non-fatal */
      }

      // Wire reflex skill injection — check if any reflex skills fire on this result
      try {
        const allSkills = await listSkillDefinitions('all').catch(() => [])
        const reflexSkills = checkReflexSkills(toolName, result, allSkills)
        if (reflexSkills.length > 0) {
          const reflexText = reflexSkills.map((s) => `REFLEX [${s.title}]: ${s.instructions}`).join('\n')
          traceTool.thinking(
            `Reflex skill(s) triggered by ${toolName}: ${reflexSkills.map((s) => s.title).join(', ')}`,
            { step },
          )
          // Inject reflex guidance into next step via stepHistory annotation
          stepHistory[stepHistory.length - 1].reflexGuidance = reflexText
        }
      } catch {
        /* non-fatal */
      }
    } catch (error) {
      let message = error?.message || 'Tool execution failed.'
      let durationMs = Date.now() - toolStartedAt

      const limitIssue = classifyLimitIssue({ toolName, message })
      if (limitIssue && onApprovalRequest) {
        const limitContext = {
          timeoutMs: toolTimeoutMs,
          ...limitIssue.context,
        }

        const decision = await requestLimitOverride({
          kind: limitIssue.kind,
          toolName,
          message: `${toolName} hit a ${limitIssue.label}. ${message}`,
          step,
          context: limitContext,
        })

        const applied = applyLimitDecision({
          decision: decision.decision,
          kind: limitIssue.kind,
          toolName,
          context: limitContext,
        })

        if (applied.approved) {
          traceTool.thinking(applied.message, { step })

          if (applied.allowRetry) {
            const retryDelayMs = Math.max(0, Number(applied.retryDelayMs || limitContext.retryAfterMs || 0))

            if (retryDelayMs > 0) {
              await waitMs(Math.min(30000, retryDelayMs))
            }

            const retryTimeoutMs = resolveSessionToolTimeoutMs(toolName)
            traceTool.toolCall(toolName, moduleName, args, {
              step,
              timeoutMs: retryTimeoutMs,
              retry: true,
            })

            const retryStartedAt = Date.now()
            try {
              const retryResult = await runWithTimeout(
                broker.execute(toolName, args),
                retryTimeoutMs,
                `${toolName} timed out after ${Math.round(retryTimeoutMs / 1000)}s.`,
              )
              const retryDurationMs = Date.now() - retryStartedAt

              if (!hasTodoUpdates) {
                todoTool.completeInProgress(`Completed ${toolName}`)
              }

              traceTool.toolResult(toolName, moduleName, 'ok', retryResult, null, {
                step,
                durationMs: retryDurationMs,
                exitCode: retryResult?.exitCode,
                retry: true,
              })

              stepHistory.push({
                step,
                tool: toolName,
                requestedTool: requestedToolName,
                module: moduleName,
                ok: true,
                durationMs: retryDurationMs,
                summary: markUntrustedExternalContent(toolName, toPreview(retryResult, 300)),
                retried: true,
              })

              continue
            } catch (retryError) {
              message = retryError?.message || 'Tool execution failed after limit override.'
              durationMs = Date.now() - retryStartedAt
            }
          }
        } else {
          message = applied.message || `User denied limit override for ${toolName}.`
        }
      }

      if (!hasTodoUpdates) {
        todoTool.blockInProgress(`Blocked on ${toolName}`)
      }

      traceTool.toolResult(toolName, moduleName, 'error', null, message, {
        step,
        durationMs,
      })

      stepHistory.push({
        step,
        tool: toolName,
        requestedTool: requestedToolName,
        module: moduleName,
        ok: false,
        durationMs,
        error: message,
      })
      // (Phase B) No persistent error-log note: the stateful loop sees the tool
      // error in-transcript and the tool guard blocks blind repeats, so a
      // cross-session error pile would be pure recall noise.
    }
  }

  capabilitySnapshot = buildCapabilitySnapshot({
    settings,
    safetyConfig: {
      ...safetyConfig,
      maxSteps: sessionStepBudget,
    },
    userApprovalGranted: approvalState.granted,
    sessionPermissionOverrides: approvalState.sessionPermissionOverrides,
  })

  const capabilityFallback = buildInsufficientAccessReply(stepHistory, capabilitySnapshot)
  const capabilityBlocked = Boolean(capabilityFallback)

  const stoppedByUser = agentState.current === AGENT_STATES.STOPPED
  let fallbackReply = stoppedByUser
    ? `Stopped. I halted the run at your request after ${stepHistory.length} action${stepHistory.length === 1 ? '' : 's'}. Send another message to continue from here.`
    : limitStopReason
      ? `${limitStopReason} I paused here. If you want me to keep going, approve the next limit prompt and I will continue.`
      : capabilityFallback

  if (!fallbackReply) {
    fallbackReply = await synthesizeFinalReply({
      userInput,
      conversation,
      stepHistory,
      capabilitySnapshot,
      capabilityBlocked,
      requestAI,
    }).catch((error) => `I could not complete the full agent flow. ${error?.message || 'Unknown error.'}`)

    if (!capabilityBlocked && looksLikeToolAccessLimitationReply(fallbackReply)) {
      const bestEffortReply = buildBestEffortToolSummaryReply(stepHistory)
      if (bestEffortReply) {
        fallbackReply = bestEffortReply
      } else {
        fallbackReply = await synthesizeFinalReply({
          userInput,
          conversation,
          stepHistory,
          capabilitySnapshot,
          capabilityBlocked,
          disallowCapabilityClaims: true,
          requestAI,
        }).catch(() => fallbackReply)

        if (looksLikeToolAccessLimitationReply(fallbackReply)) {
          fallbackReply =
            'I hit an internal planning issue while choosing tools. Tool access is available, so ask me to retry and I will execute the required steps.'
        }
      }
    }
  }

  todoTool.completeInProgress('Deliver final answer')
  traceTool.phase('final', 'Generated fallback final response.')

  const finalizedReply = await finalizeHybridReply(fallbackReply)
  const persistedNote = persistContinuityNote({
    userInput,
    reply: finalizedReply,
    stepHistory,
    skillContext,
    continuityContext,
    chatMemoryActive: Boolean(chatSessionId),
  })

  if (persistedNote?.title) {
    traceTool.thinking(`Saved continuity note "${persistedNote.title}".`)
  }

  // Score and record reward for fallback path too
  const toolsUsedFallback = stepHistory.map((s) => s.tool).filter(Boolean)
  const rewardResultFallback = scoreSession({
    triggeredSkillIds,
    toolsUsed: toolsUsedFallback,
    finalReply: finalizedReply,
  })
  const rewardStoreFallback = recordReward(rewardResultFallback, String(userInput || '').slice(0, 60))
  onEvent?.({
    type: 'reward',
    result: rewardResultFallback,
    totals: rewardStoreFallback.totals,
  })

  // Post-session cleanup, fallback path (W4: no skill-mutation flags).
  if (isUserCorrection) {
    try {
      recordUserPreferenceNote(userInput)
    } catch {
      /* non-fatal */
    }
  }
  try {
    clearSessionScopedNotes()
  } catch {
    /* non-fatal */
  }

  unsubscribeSubAgents()
  return {
    reply: finalizedReply,
    timeline,
    todos: todoTool.list(),
    steps: stepHistory.length,
    stepHistory,
    artifacts: sessionArtifacts,
    skills: {
      profile: skillContext.profile,
      active: skillContext.active,
      triggered: triggeredSkillIds,
    },
    reward: rewardResultFallback,
    safety: buildSessionSafety(),
    summary: buildRunSummary({
      timeline,
      stepHistory,
      startedAt,
      skillContext,
      safetyConfig: {
        ...safetyConfig,
        maxSteps: sessionStepBudget,
      },
      userApprovalGranted: approvalState.granted,
      usage: buildUsageSummary(usageTracker),
    }),
  }
}
