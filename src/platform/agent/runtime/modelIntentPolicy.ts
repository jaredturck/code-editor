import { extractJsonObject } from '@/platform/agent/agentJsonUtils'
import { TOOL_BY_NAME, TOOL_DEFINITIONS } from '@/platform/agent/toolCatalog'

interface CapabilitySnapshot {
  advertisedTools?: unknown
  availableTools?: unknown
}

interface ForcedActionInput {
  userInput: unknown
  capabilitySnapshot: CapabilitySnapshot
  requestAI: (messages: Array<Record<string, unknown>>) => Promise<unknown>
}

/**
 * Ask the language model whether a tool action is actually required after the controller
 * attempted to finalize before using tools. This is intentionally semantic: the runtime
 * validates only that the selected tool exists and is available; it never infers intent
 * from keywords, regexes, or hard-coded task categories.
 */
export async function inferForcedToolActionForRequest({ userInput, capabilitySnapshot, requestAI }: ForcedActionInput) {
  const advertisedTools = Array.isArray(capabilitySnapshot?.advertisedTools)
    ? capabilitySnapshot.advertisedTools
    : capabilitySnapshot?.availableTools
  const availableTools = Array.isArray(advertisedTools)
    ? advertisedTools.map(String).filter((name) => TOOL_BY_NAME[name])
    : []

  if (!availableTools.length) return null

  const toolSpecs = TOOL_DEFINITIONS.filter((tool) => availableTools.includes(tool.name)).map((tool) => ({
    name: tool.name,
    module: tool.module,
    description: tool.description,
    args: tool.args,
  }))

  try {
    const raw = await requestAI([
      {
        role: 'system',
        content: [
          'You are IRIS Tool Planner.',
          'The controller attempted to finalize before using any runtime tools.',
          'Interpret the full user request semantically and decide whether a tool action is actually needed to satisfy it.',
          'If a tool is needed, choose exactly one available tool that best advances the request.',
          'If the request can legitimately be answered without tools, choose action="none".',
          'Do not classify intent from isolated keywords or phrases.',
          'Return strict JSON only: {"action":"tool|none","tool":"","args":{},"reason":""}.',
          'When action="tool", tool must be one of available_tools. Do not return a user-facing answer.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          user_request: String(userInput || ''),
          available_tools: availableTools,
          tool_specs: toolSpecs,
        }),
      },
    ])

    const parsed = extractJsonObject(raw)
    const action = String(parsed?.action || '')
      .trim()
      .toLowerCase()
    if (action === 'none') return null

    const tool = String(parsed?.tool || '').trim()
    const args = parsed?.args && typeof parsed.args === 'object' ? parsed.args : {}
    const reason = String(parsed?.reason || '').trim()

    if (action !== 'tool' || !tool || !availableTools.includes(tool)) return null

    return {
      tool,
      args,
      reason: reason || 'The model selected this tool as the best next action for the request.',
    }
  } catch {
    return null
  }
}
