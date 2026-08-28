// @ts-nocheck
/**
 * Converts the completed session state into the final assistant reply, controller payload,
 * and run summary. It handles incomplete-looking answers and preserves usage, todo, trace,
 * and reward information.
 */

import { UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security'
import { buildUsageSummary } from '@/platform/agent/usageMetrics'
import { trimMessageContent } from '@/platform/agent/agentJsonUtils'
import { TOOL_DEFINITIONS, isLeanTool } from '@/platform/agent/toolCatalog'
import { inferDirectPreflightPlan } from '@/platform/agent/localPlanner'
import * as runtimeSupport from '@/platform/agent/runtime/runtimeSupport'

const { MAX_AGENT_STEPS, INSUFFICIENT_ACCESS_REPLY, isCapabilityOrPermissionError } = runtimeSupport

const TASK_TOOLSETS = {
  code_change: new Set([
    'terminal.exec',
    'files.read',
    'files.write',
    'files.patch',
    'files.edit',
    'diagnostics.check',
    'user.ask',
  ]),
  code_read: new Set(['terminal.exec', 'files.read', 'diagnostics.check', 'user.ask']),
  file_task: new Set(['terminal.exec', 'files.read', 'files.write', 'files.patch', 'files.edit', 'user.ask']),
  research: new Set(['search.web', 'web.fetch', 'sources.lookup', 'user.ask']),
} as const

const BROWSER_TASK_PATTERN =
  /\b(browser|website|webpage|web app|frontend|front-end|ui|visual|render|css|html|dom|responsive)\b/i
const CODE_SEARCH_PATTERN = /\b(find|locate|search|where|references?|usages?|across (the )?(repo|project|codebase))\b/i
const WEB_RESEARCH_PATTERN = /\b(latest|current|online|internet|web research|look up|search the web)\b/i

function taskLeanToolAllowed(toolName, userInput) {
  const request = String(userInput || '')
  const plan = inferDirectPreflightPlan(request)
  if (!plan) return isLeanTool(toolName)

  let selected
  if (plan.taskType === 'research') selected = TASK_TOOLSETS.research
  else if (plan.taskType === 'file_task') selected = TASK_TOOLSETS.file_task
  else if (plan.developmentTask && plan.workspaceMutationExpected) selected = TASK_TOOLSETS.code_change
  else if (plan.developmentTask) selected = TASK_TOOLSETS.code_read
  else return isLeanTool(toolName)

  if (toolName === 'browser.inspect') return BROWSER_TASK_PATTERN.test(request)
  if (toolName === 'rag.retrieve') return plan.developmentTask === true && CODE_SEARCH_PATTERN.test(request)
  if (['search.web', 'web.fetch', 'sources.lookup'].includes(toolName)) return WEB_RESEARCH_PATTERN.test(request)
  return selected.has(toolName)
}

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
      const summary = String(step.summary || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280)
      return summary ? `- ${tool}: ${summary}` : `- ${tool}`
    })
    const failed = stepHistory.filter((step) => step.ok === false).slice(-3)
    const failureLines = failed.map(
      (step) => `- ${String(step.tool || 'action')}: ${String(step.error || 'failed').slice(0, 220)}`,
    )
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
      const runtimeControl = tool.name === 'browser.inspect'
      const advertisedTools = Array.isArray(capabilitySnapshot?.advertisedTools)
        ? capabilitySnapshot.advertisedTools
        : capabilitySnapshot?.availableTools
      const available = runtimeControl || (Array.isArray(advertisedTools) && advertisedTools.includes(tool.name))
      if (!available) return false
      if (toolset === 'lean') return taskLeanToolAllowed(tool.name, userInput)
      return true
    }).map((tool) => ({
      name: tool.name,
      module: tool.module,
      internal: Boolean(tool.internal),
      description: tool.description,
      args: tool.args,
    })),
    skills: {
      cards: Array.isArray(skillContext?.cards)
        ? skillContext.cards.slice(0, 8).map((card) => ({
            id: card.id,
            title: card.title,
            summary: card.summary,
          }))
        : [],
      active_skills: Array.isArray(skillContext?.active)
        ? skillContext.active.map((skill) => ({
            id: skill.id,
            title: skill.title,
            summary: skill.summary,
            instructions: String(skill.instructions || '').slice(0, 1800),
          }))
        : [],
    },
    relevant_memory: {
      resume_intent: Boolean(continuityContext?.resumeIntent),
      notes: Array.isArray(relevantMemory) ? relevantMemory : [],
    },
    chat_memory: String(chatMemory || '').slice(0, 1200),
  }
}

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
