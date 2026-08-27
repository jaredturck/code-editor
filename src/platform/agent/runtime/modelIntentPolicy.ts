import { TOOL_BY_NAME } from '@/platform/agent/toolCatalog'

interface CapabilitySnapshot {
  advertisedTools?: unknown
  availableTools?: unknown
}

interface ForcedActionInput {
  userInput: unknown
  capabilitySnapshot: CapabilitySnapshot
  requestAI?: (messages: Array<Record<string, unknown>>) => Promise<unknown>
}

const LOCAL_ACTION_PATTERN =
  /\b(code|codebase|repo|repository|project|file|files|folder|directory|app|application|website|component|function|module|bug|runtime|provider|agent)\b/i
const LOCAL_VERB_PATTERN =
  /\b(build|create|implement|add|change|update|fix|repair|refactor|remove|rename|rewrite|debug|improve|review|audit|analy[sz]e|inspect|investigate|trace|find|locate)\b/i
const WEB_RESEARCH_PATTERN = /\b(research|look up|search the web|browse|latest|current|today|recent|sources?|online)\b/i

function availableToolSet(snapshot: CapabilitySnapshot) {
  const advertised = Array.isArray(snapshot?.advertisedTools) ? snapshot.advertisedTools : snapshot?.availableTools
  return new Set(
    (Array.isArray(advertised) ? advertised : [])
      .map(String)
      .filter((name) => Boolean(TOOL_BY_NAME[name])),
  )
}

/**
 * Rescue only clear early-finalization mistakes. The main controller already interpreted the
 * request; this fallback should not spend another inference re-interpreting it.
 */
export async function inferForcedToolActionForRequest({ userInput, capabilitySnapshot }: ForcedActionInput) {
  const request = String(userInput || '').trim()
  if (!request) return null

  const tools = availableToolSet(capabilitySnapshot)
  if (!tools.size) return null

  if (WEB_RESEARCH_PATTERN.test(request) && tools.has('search.web')) {
    return {
      tool: 'search.web',
      args: { query: request },
      reason: 'The request explicitly needs current or web evidence.',
    }
  }

  if (LOCAL_ACTION_PATTERN.test(request) && LOCAL_VERB_PATTERN.test(request)) {
    if (tools.has('rag.retrieve')) {
      return {
        tool: 'rag.retrieve',
        args: { query: request, maxFiles: 8, maxPassages: 10 },
        reason: 'The request clearly depends on local project state.',
      }
    }
    if (tools.has('files.list')) {
      return {
        tool: 'files.list',
        args: { path: '.', depth: 3 },
        reason: 'The request clearly depends on local project state.',
      }
    }
  }

  return null
}
