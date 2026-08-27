/**
 * Prevents repeated and observation-heavy tool behavior from consuming an agent session
 * without producing useful project progress.
 */

type ToolArguments = Record<string, unknown>

export interface ToolGuardResult {
  blocked: boolean
  escalate?: boolean
  reason?: string
}

export interface ToolGuard {
  check(toolName: string, args: unknown): ToolGuardResult
  record(toolName: string, args: unknown): void
}

export interface ToolGuardOptions {
  maxRepeat?: number
}

const EXEMPT_TOOL_NAMES = new Set<string>(['trace.log'])

const OBSERVATION_CAPS = new Map<string, number>([
  ['files.read', 10],
  ['browser.inspect', 3],
  ['diagnostics.check', 3],
  ['rag.retrieve', 3],
  ['search.web', 3],
  ['web.fetch', 4],
  ['system.stats', 2],
  ['system.processes', 2],
  ['agent.status', 3],
  ['chat.remember', 2],
  ['todo.update', 4],
])

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function terminalLikelyMutates(command: unknown) {
  const text = String(command || '')
  return /\b(?:mkdir|touch|cp|mv|rm|install|add|remove)\b|\bsed\s+-i\b|\bperl\s+-pi\b|(?:^|\s)(?:tee|truncate)\b|>>?|\bpython(?:3)?\s+[^-\s][^\s]*\.py\b/i.test(text)
}

function isMutation(toolName: string, args: unknown) {
  if (['files.write', 'files.edit', 'files.patch'].includes(toolName)) return true
  if (toolName !== 'terminal.exec') return false
  const record = args && typeof args === 'object' && !Array.isArray(args) ? (args as ToolArguments) : {}
  return terminalLikelyMutates(record.command)
}

/** Tracks repeated tool calls and evidence-gathering budgets within one session. */
export function createToolGuard({ maxRepeat = 4 }: ToolGuardOptions = {}): ToolGuard {
  const cap = Math.max(2, Number(maxRepeat) || 4)
  const counts = new Map<string, number>()
  const observationCounts = new Map<string, number>()
  let lastSignature: string | null = null
  let blockedSignature: string | null = null
  let blockedSignatureCount = 0

  const signature = (tool: string, args: unknown): string => {
    const normalizedArgs: ToolArguments =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as ToolArguments) : {}
    return `${tool}::${stableStringify(normalizedArgs)}`
  }

  const block = (sig: string, reason: string): ToolGuardResult => {
    if (sig === blockedSignature) blockedSignatureCount += 1
    else {
      blockedSignature = sig
      blockedSignatureCount = 1
    }
    return { blocked: true, escalate: blockedSignatureCount >= 2, reason }
  }

  return {
    check(toolName: string, args: unknown): ToolGuardResult {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return { blocked: false }

      const sig = signature(name, args)
      const consecutive = sig === lastSignature
      const count = counts.get(sig) || 0
      if (consecutive || count >= cap) {
        return block(sig, `Repeated \`${name}\` action blocked. Use the result already returned or do different work.`)
      }

      const observationCap = OBSERVATION_CAPS.get(name)
      const observations = observationCounts.get(name) || 0
      if (observationCap && observations >= observationCap) {
        return block(
          `${name}::observation-budget`,
          `Observation budget for \`${name}\` is exhausted until the project changes. Use the evidence already gathered, make a relevant change, or finish.`,
        )
      }

      return { blocked: false }
    },

    record(toolName: string, args: unknown): void {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return

      if (isMutation(name, args)) observationCounts.clear()
      else if (OBSERVATION_CAPS.has(name)) observationCounts.set(name, (observationCounts.get(name) || 0) + 1)

      const sig = signature(name, args)
      counts.set(sig, (counts.get(sig) || 0) + 1)
      lastSignature = sig
      blockedSignature = null
      blockedSignatureCount = 0
    },
  }
}
