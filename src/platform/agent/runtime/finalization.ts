// @ts-nocheck
/**
 * Converts the completed session state into the final assistant reply, controller payload,
 * and run summary. It handles incomplete-looking answers and preserves usage, todo, trace,
 * and reward information.
 */

// Transitional extraction: behavior is preserved verbatim while runtime contracts are typed incrementally.
import { UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security'

import { buildUsageSummary } from '@/platform/agent/usageMetrics'

import { trimMessageContent } from '@/platform/agent/agentJsonUtils'

import { TOOL_DEFINITIONS, isLeanTool } from '@/platform/agent/toolCatalog'

import * as runtimeSupport from '@/platform/agent/runtime/runtimeSupport'
const { MAX_AGENT_STEPS, SEARCH_WEB_DEFAULT_CALL_BUDGET, INSUFFICIENT_ACCESS_REPLY, isCapabilityOrPermissionError } =
  runtimeSupport

// Determines whether the final reply incorrectly claims that no user request was provided.
export function looksLikeMissingRequestReply(text, userInput) {
  const latestRequest = String(userInput || '').trim()
  if (!latestRequest) return false

  const reply = String(text || '').toLowerCase()
  if (!reply) return false

  const missingRequestSignals = [
    /has not provided (any )?(specific )?(request|task|context|instruction)/,
    /no specific (request|task|context|instruction)/,
    /no (actual )?(request|task|instruction)/,
    /without (a )?(specific )?(request|task|context|instruction)/,
  ]

  const clarificationSignals = [
    /ask(ing)? (the )?user (for )?(clarification|details)/,
    /ask the user what they would like me to do/,
    /please provide (the )?(details|specifics) of (the )?(task|problem|request|instruction)/,
    /please provide .*?(task|problem|request).*?(details|you need solved|you are working with)/,
    /how can i help/,
    /what would you like me to do/,
    /i will respond by/,
    /self-correction/,
  ]

  const claimsMissingRequest = missingRequestSignals.some((pattern) => pattern.test(reply))
  if (!claimsMissingRequest) return false

  return clarificationSignals.some((pattern) => pattern.test(reply))
}

// Synthesizes a final reply only when tool evidence is too weak to summarize deterministically.
export async function synthesizeFinalReply({
  userInput,
  conversation,
  stepHistory,
  capabilitySnapshot,
  capabilityBlocked = false,
  disallowCapabilityClaims = false,
  requestAI,
}) {
  const successful = stepHistory.filter((step) => step.ok !== false)
  if (successful.length) {
    const recent = successful.slice(-6).map((step) => {
      const tool = String(step.tool || 'action')
      const summary = String(step.summary || '').replace(/\s+/g, ' ').trim().slice(0, 280)
      return summary ? `- ${tool}: ${summary}` : `- ${tool}`
    })
    const failed = stepHistory.filter((step) => step.ok === false).slice(-3)
    const failureLines = failed.map((step) => `- ${String(step.tool || 'action')}: ${String(step.error || 'failed').slice(0, 220)}`)
    return [
      `Completed ${successful.length} successful action${successful.length === 1 ? '' : 's'}.`,
      recent.join('\n'),
      failureLines.length ? `Remaining failures:\n${failureLines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const messages = [
    {
      role: 'system',
      content: [
        'Answer the user directly from the supplied run state.',
        UNTRUSTED_CONTENT_SYSTEM_RULES,
        disallowCapabilityClaims
          ? 'Do not claim missing tools or permissions.'
          : capabilityBlocked
            ? `If access blocked completion, begin with: "${INSUFFICIENT_ACCESS_REPLY}".`
            : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
    ...conversation.slice(-3).map((message) => ({
      role: message.role,
      content: trimMessageContent(message.content),
    })),
    {
      role: 'user',
      content: `Request: ${userInput}\n\nNo useful tool result was recorded. Give the best direct response supported by the conversation.`,
    },
  ]

  const synthesized = String((await requestAI(messages)) || '').trim()
  if (synthesized) return synthesized
  return 'I could not produce a complete answer from the available run state.'
}

// Assembles controller payload from lower-level state so callers receive one consistent
// representation.
export function buildControllerPayload({
  userInput,
  conversation,
  todos,
  stepHistory,
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
  const recentSteps = stepHistory.slice(-8)
  const latestStep = recentSteps[recentSteps.length - 1] || null
  const recoveryContext =
    latestStep?.ok === false
      ? {
          status: 'action_failed',
          original_goal: userInput,
          failed_action: {
            tool: String(latestStep.tool || latestStep.requestedTool || ''),
            error: String(latestStep.error || 'Tool execution failed.'),
          },
          recent_evidence: recentSteps.slice(-6).map((item) => ({
            tool: String(item.tool || item.requestedTool || ''),
            ok: item.ok !== false,
            result: item.ok === false ? String(item.error || '') : String(item.summary || ''),
          })),
          instruction:
            'Reason about why the previous action failed using the exact error, original goal, and evidence gathered so far. Decide the next action yourself. Do not blindly repeat the same action unless you have a concrete reason the result may now differ.',
        }
      : null

  return {
    user_request: userInput,
    recent_messages: conversation.slice(-8).map((message) => ({
      role: message.role,
      content: trimMessageContent(message.content),
    })),
    todos,
    previous_steps: recentSteps,
    ...(recoveryContext ? { recovery_context: recoveryContext } : {}),
    tools: TOOL_DEFINITIONS.filter((tool) => {
      const alwaysOn = tool.name === 'todo.update' || tool.name === 'trace.log' || tool.name === 'browser.inspect'
      const advertisedTools = Array.isArray(capabilitySnapshot?.advertisedTools)
        ? capabilitySnapshot.advertisedTools
        : capabilitySnapshot?.availableTools
      const allowed = alwaysOn || (Array.isArray(advertisedTools) && advertisedTools.includes(tool.name))
      if (!allowed) return false
      if (toolset === 'lean' && !alwaysOn) return isLeanTool(tool.name)
      return true
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
    relevant_memory: {
      resume_intent: Boolean(continuityContext?.resumeIntent),
      notes: Array.isArray(relevantMemory) ? relevantMemory : [],
    },
    chat_memory: String(chatMemory || ''),
    memory_hygiene: {
      web_search_calls_used: Number.isFinite(Number(webSearchState?.callsUsed)) ? Number(webSearchState.callsUsed) : 0,
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
  }
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
  const toolCalls = timeline.filter((event) => event.type === 'tool_call').length
  const toolResults = timeline.filter((event) => event.type === 'tool_result')
  const toolSuccesses = toolResults.filter((event) => event.status === 'ok').length
  const toolFailures = toolResults.filter((event) => event.status !== 'ok').length
  const capabilityBlocks = stepHistory.filter((step) => !step.ok && isCapabilityOrPermissionError(step.error)).length
  const toolRetries = stepHistory.filter((step) => step.retried).length
  const invalidArgErrors = stepHistory.filter(
    (step) =>
      !step.ok && /invalid|argument|required|missing|schema|expected|must be|parse/i.test(String(step.error || '')),
  ).length
  let redundantToolCalls = 0
  for (let i = 1; i < stepHistory.length; i += 1) {
    if (stepHistory[i]?.tool && stepHistory[i].tool === stepHistory[i - 1]?.tool) redundantToolCalls += 1
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
    stepBudget: Number.isFinite(Number(safetyConfig?.maxSteps)) ? Number(safetyConfig.maxSteps) : MAX_AGENT_STEPS,
    usage: usage || buildUsageSummary(null),
  }
}
