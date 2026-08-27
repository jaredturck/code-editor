/**
 * Prevents repeated and observation-heavy tool behavior from consuming an agent session
 * without producing useful project progress.
 */

import { terminalCommandLikelyMutatesSource } from '@/platform/agent/repetitionAdvisory'

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
  ['files.read', 8],
  ['files.list', 4],
  ['files.find', 4],
  ['files.stat', 4],
  ['files.diff', 4],
  ['search.ripgrep', 5],
  ['search.find', 4],
  ['search.fd', 4],
  ['terminal.observe', 8],
  ['terminal.verify', 4],
  ['launch.run', 2],
  ['browser.inspect', 2],
  ['diagnostics.check', 2],
  ['rag.retrieve', 2],
  ['search.web', 2],
  ['web.fetch', 3],
  ['sources.lookup', 2],
  ['system.stats', 2],
  ['system.processes', 2],
  ['agent.status', 2],
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

function normalizedArgs(args: unknown): ToolArguments {
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as ToolArguments) : {}
}

function isMutation(toolName: string, args: unknown) {
  if (['files.write', 'files.edit', 'files.patch'].includes(toolName)) return true
  return toolName === 'terminal.exec' && terminalCommandLikelyMutatesSource(normalizedArgs(args).command)
}

function terminalLooksLikeVerification(command: unknown) {
  const text = String(command || '')
  return /\b(?:test|vitest|jest|pytest|playwright|cypress|lint|eslint|ruff|typecheck|tsc|build|compile|check)\b|npm\s+run\s+(?:test|lint|build|typecheck|check)|pnpm\s+(?:test|lint|build|typecheck|check)/i.test(text)
}

function observationKey(toolName: string, args: unknown): string | null {
  if (toolName === 'terminal.exec') {
    if (isMutation(toolName, args)) return null
    return terminalLooksLikeVerification(normalizedArgs(args).command) ? 'terminal.verify' : 'terminal.observe'
  }
  return OBSERVATION_CAPS.has(toolName) ? toolName : null
}

/** Tracks repeated tool calls and evidence-gathering budgets within one session. */
export function createToolGuard({ maxRepeat = 4 }: ToolGuardOptions = {}): ToolGuard {
  const cap = Math.max(2, Number(maxRepeat) || 4)
  const counts = new Map<string, number>()
  const observationCounts = new Map<string, number>()
  let lastSignature: string | null = null
  let blockedSignature: string | null = null
  let blockedSignatureCount = 0

  const signature = (tool: string, args: unknown): string => `${tool}::${stableStringify(normalizedArgs(args))}`

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

      const key = observationKey(name, args)
      const observationCap = key ? OBSERVATION_CAPS.get(key) : undefined
      const observations = key ? observationCounts.get(key) || 0 : 0
      if (key && observationCap && observations >= observationCap) {
        return block(
          `${key}::observation-budget`,
          `Evidence budget for \`${key}\` is exhausted until the project changes. Use current evidence, make a relevant change, or finish.`,
        )
      }

      return { blocked: false }
    },

    record(toolName: string, args: unknown): void {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return

      if (isMutation(name, args)) observationCounts.clear()
      else {
        const key = observationKey(name, args)
        if (key) observationCounts.set(key, (observationCounts.get(key) || 0) + 1)
      }

      const sig = signature(name, args)
      counts.set(sig, (counts.get(sig) || 0) + 1)
      lastSignature = sig
      blockedSignature = null
      blockedSignatureCount = 0
    },
  }
}
