/**
 * Provides the tool guard definitions or transformations shared by the agent runtime,
 * provider schemas, and UI. It helps keep model-facing behavior consistent across
 * native-tool and controller execution modes.
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** Tracks repeated tool calls within one session before more work is consumed. */
export function createToolGuard({ maxRepeat = 4 }: ToolGuardOptions = {}): ToolGuard {
  const cap = Math.max(2, Number(maxRepeat) || 4)
  const counts = new Map<string, number>()
  let lastSignature: string | null = null
  let blockedSignature: string | null = null
  let blockedSignatureCount = 0

  const signature = (tool: string, args: unknown): string => {
    const normalizedArgs: ToolArguments =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as ToolArguments) : {}
    return `${tool}::${stableStringify(normalizedArgs)}`
  }

  return {
    check(toolName: string, args: unknown): ToolGuardResult {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return { blocked: false }

      const sig = signature(name, args)
      const consecutive = sig === lastSignature
      const count = counts.get(sig) || 0

      if (consecutive || count >= cap) {
        if (sig === blockedSignature) blockedSignatureCount += 1
        else {
          blockedSignature = sig
          blockedSignatureCount = 1
        }

        return {
          blocked: true,
          escalate: blockedSignatureCount >= 2,
          reason: `Repeated \`${name}\` action blocked. Use the evidence already returned or choose a materially different action.`,
        }
      }
      return { blocked: false }
    },

    record(toolName: string, args: unknown): void {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return
      const sig = signature(name, args)
      counts.set(sig, (counts.get(sig) || 0) + 1)
      lastSignature = sig
      blockedSignature = null
      blockedSignatureCount = 0
    },
  }
}
