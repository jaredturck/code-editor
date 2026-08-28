/**
 * Prevents repeated or runaway evidence gathering without forcing arbitrary mutation after a
 * tiny number of legitimate repository observations.
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
  maxObservationStreak?: number
}

const EXEMPT_TOOL_NAMES = new Set<string>(['trace.log'])
const OBSERVATION_TOOLS = new Set([
  'files.read',
  'files.list',
  'files.find',
  'files.stat',
  'files.diff',
  'search.ripgrep',
  'search.find',
  'search.fd',
  'search.locate',
  'rag.retrieve',
  'browser.inspect',
  'diagnostics.check',
  'search.web',
  'web.fetch',
  'sources.lookup',
  'system.stats',
  'system.processes',
  'agent.status',
])
const TEXT_MUTATION_TOOLS = new Set(['files.write', 'files.edit', 'files.patch'])
const RASTER_IMAGE_PATH = /\.(?:avif|bmp|gif|ico|jpe?g|png|webp)$/i

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
  if (TEXT_MUTATION_TOOLS.has(toolName)) return true
  return toolName === 'terminal.exec' && terminalCommandLikelyMutatesSource(normalizedArgs(args).command)
}

function isRasterImageTextMutation(toolName: string, args: unknown) {
  if (!TEXT_MUTATION_TOOLS.has(toolName)) return false
  return RASTER_IMAGE_PATH.test(String(normalizedArgs(args).path || '').trim())
}

function terminalLooksLikeVerification(command: unknown) {
  return /\b(?:test|vitest|jest|pytest|playwright|cypress|lint|eslint|ruff|typecheck|tsc|build|compile|check)\b|npm\s+run\s+(?:test|lint|build|typecheck|check)|pnpm\s+(?:test|lint|build|typecheck|check)/i.test(
    String(command || ''),
  )
}

function isObservation(toolName: string, args: unknown) {
  if (OBSERVATION_TOOLS.has(toolName)) return true
  return toolName === 'terminal.exec' && !isMutation(toolName, args)
}

function observationFamily(toolName: string, args: unknown) {
  if (toolName === 'terminal.exec')
    return terminalLooksLikeVerification(normalizedArgs(args).command) ? 'verification' : 'terminal'
  if (toolName.startsWith('search.') || toolName === 'files.find' || toolName === 'rag.retrieve') return 'search'
  if (toolName === 'files.read' || toolName === 'files.list' || toolName === 'files.stat') return 'repository'
  if (toolName === 'browser.inspect' || toolName === 'diagnostics.check') return 'verification'
  return toolName
}

/**
 * Exact repetition is blocked aggressively. Distinct observations are allowed in a much larger
 * streak so scouts can genuinely understand unfamiliar repositories. Crossing the streak budget
 * asks the orchestrator to reconsider strategy instead of demanding an arbitrary source edit.
 */
export function createToolGuard({ maxRepeat = 4, maxObservationStreak = 32 }: ToolGuardOptions = {}): ToolGuard {
  const repeatCap = Math.max(2, Number(maxRepeat) || 4)
  const observationCap = Math.max(12, Number(maxObservationStreak) || 32)
  const counts = new Map<string, number>()
  const familyCounts = new Map<string, number>()
  let observationStreak = 0
  let lastSignature: string | null = null
  let blockedSignature: string | null = null
  let blockedSignatureCount = 0

  const signature = (tool: string, args: unknown) => `${tool}::${stableStringify(normalizedArgs(args))}`
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

      if (isRasterImageTextMutation(name, args)) {
        return block(
          sig,
          'Raster image files cannot be created with text file tools. Use `image.generate` for PNG, JPEG, WebP, GIF, AVIF, BMP, or ICO assets; use `files.write` only for real text formats such as SVG.',
        )
      }

      const count = counts.get(sig) || 0
      if (sig === lastSignature || count >= repeatCap) {
        return block(
          sig,
          `Repeated \`${name}\` action blocked. Reuse existing evidence or choose a materially different action.`,
        )
      }

      if (isObservation(name, args) && observationStreak >= observationCap) {
        const dominant = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0]
        return block(
          'observation-streak',
          `Observation streak reached ${observationStreak} actions${dominant ? ` (${dominant[0]} dominated)` : ''}. Checkpoint evidence and reconsider the current strategy before gathering more.`,
        )
      }
      return { blocked: false }
    },

    record(toolName: string, args: unknown): void {
      const name = String(toolName || '')
      if (EXEMPT_TOOL_NAMES.has(name)) return
      if (isMutation(name, args)) {
        observationStreak = 0
        familyCounts.clear()
      } else if (isObservation(name, args)) {
        observationStreak += 1
        const family = observationFamily(name, args)
        familyCounts.set(family, (familyCounts.get(family) || 0) + 1)
      }

      const sig = signature(name, args)
      counts.set(sig, (counts.get(sig) || 0) + 1)
      lastSignature = sig
      blockedSignature = null
      blockedSignatureCount = 0
    },
  }
}
