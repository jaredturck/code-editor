const repetition_states = new Map<string, RepetitionState>()
const REPETITION_STATE_TTL_MS = 20 * 60 * 1000
const MAX_EVIDENCE_RECORDS = 24

interface EvidenceRecord {
  category: string
  signature: string
  at: number
  generation: number
}

interface RepetitionState {
  generation: number
  updated_at: number
  records: EvidenceRecord[]
}

interface RecordAgentEvidenceInput {
  scope_id: string
  tool_name: string
  args?: Record<string, unknown>
  workspace_mutated?: boolean
}

function normalized_text(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalize_local_ports(value: string) {
  return value
    .replace(/(https?:\/\/localhost:)\d+/g, '$1<port>')
    .replace(/(https?:\/\/127\.0\.0\.1:)\d+/g, '$1<port>')
}

function normalize_terminal_command(value: unknown) {
  return normalize_local_ports(normalized_text(value))
    .replace(/^cd\s+(?:"[^"]+"|'[^']+'|[^;&|\s]+)\s*&&\s*/, '')
    .replace(/\s+2>&1\b/g, '')
    .replace(/\s*\|\s*(?:tail|head)\b[^;&|]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function terminal_evidence_category(command: string) {
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b|\b(?:vite|webpack|rollup|tsc)\b.*(?:--build|-b)\b/.test(command)) {
    return 'build verification'
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|test:.*|vitest|jest)\b|\b(?:vitest|jest|pytest|cargo\s+test|go\s+test)\b/.test(command)) {
    return 'test verification'
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|lint:.*)\b|\b(?:eslint|stylelint|ruff)\b(?!.*(?:--fix|\s+format\b))/.test(command)) {
    return 'lint diagnostics'
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|check:types)\b|\btsc\b(?!.*(?:--build|-b))/.test(command)) {
    return 'typecheck verification'
  }
  if (/\b(?:curl|wget)\b.*https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\b/.test(command)) {
    return 'local http verification'
  }
  if (/\b(?:ps|pgrep|lsof|ss|netstat)\b/.test(command)) {
    return 'process verification'
  }
  if (/\b(?:rg|grep)\b/.test(command)) {
    return 'source text inspection'
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b|\b(?:vite|next|nuxt)\b.*(?:--host|dev|serve)\b/.test(command)) {
    return 'dev server verification'
  }
  return ''
}

function evidence_category(tool_name: string, args: Record<string, unknown>) {
  if (tool_name === 'browser.inspect') return 'browser runtime inspection'
  if (tool_name === 'diagnostics.check') return 'editor diagnostics'
  if (tool_name === 'web.fetch') {
    const url = normalized_text(args.url)
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\b/.test(url)) return 'local http verification'
  }
  if (tool_name === 'terminal.exec') return terminal_evidence_category(normalize_terminal_command(args.command))
  return ''
}

function evidence_signature(tool_name: string, category: string, args: Record<string, unknown>) {
  if (tool_name === 'terminal.exec') {
    return `${category}:${normalize_terminal_command(args.command)}`
  }
  if (tool_name === 'browser.inspect' || tool_name === 'web.fetch') {
    return `${category}:${normalize_local_ports(normalized_text(args.url))}`
  }
  if (tool_name === 'diagnostics.check') {
    return `${category}:${normalized_text(args.path)}:${normalized_text(args.language)}`
  }
  return `${category}:${tool_name}`
}

function prune_stale_states(now: number) {
  for (const [key, state] of repetition_states) {
    if (now - state.updated_at > REPETITION_STATE_TTL_MS) repetition_states.delete(key)
  }
}

export function terminalCommandLikelyMutatesSource(command_value: unknown) {
  const command = normalize_terminal_command(command_value)
  if (!command) return false

  return (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|uninstall|update|upgrade)\b/.test(command) ||
    /\b(?:npm|pnpm|yarn|bun|npx)\s+(?:create|dlx)\b/.test(command) ||
    /\b(?:create-vite|create-next-app|ng\s+new|cargo\s+new)\b/.test(command) ||
    /\b(?:prettier|eslint|stylelint|ruff)\b[^;&|]*(?:--write|--fix|\bformat\b)/.test(command) ||
    /\b(?:sed\s+-i|perl\s+-pi|apply_patch|patch\s+-p\d*)\b/.test(command) ||
    /(?:^|[;&]\s*)(?:rm|mv|cp|touch|mkdir)\b/.test(command) ||
    /(?:^|[^<>])(?:>>|>)(?!=)/.test(command)
  )
}

export function repeatedAgentEvidenceBlock({ scope_id, tool_name, args = {} }: RecordAgentEvidenceInput) {
  const scope = String(scope_id || '').trim()
  if (!scope) return ''

  const now = Date.now()
  prune_stale_states(now)
  const state = repetition_states.get(scope)
  if (!state) return ''
  state.updated_at = now

  const category = evidence_category(tool_name, args)
  if (!category) return ''
  const signature = evidence_signature(tool_name, category, args)
  const records = state.records.filter((record) => record.generation === state.generation)
  const exact_count = records.filter((record) => record.signature === signature).length
  const category_count = records.filter((record) => record.category === category).length

  if (exact_count < 2 && category_count < 4) return ''

  const repetition = exact_count >= 2 ? `${exact_count} equivalent ${category} checks` : `${category_count} ${category} checks`
  return (
    `REPETITION BLOCK: ${repetition} have already completed without an intervening source/configuration change. ` +
    'Do not execute this check again. Change source/configuration, inspect a materially different property, or finish if the evidence already gathered is sufficient.'
  )
}

export function recordAgentEvidence({
  scope_id,
  tool_name,
  args = {},
  workspace_mutated = false,
}: RecordAgentEvidenceInput) {
  const scope = String(scope_id || '').trim()
  if (!scope) return ''

  const now = Date.now()
  prune_stale_states(now)
  let state = repetition_states.get(scope)
  if (!state) {
    state = { generation: 0, updated_at: now, records: [] }
    repetition_states.set(scope, state)
  }
  state.updated_at = now

  if (workspace_mutated) {
    state.generation += 1
    state.records = []
    return ''
  }

  const block = repeatedAgentEvidenceBlock({ scope_id: scope, tool_name, args })
  if (block) throw new Error(block)

  const category = evidence_category(tool_name, args)
  if (!category) return ''
  const signature = evidence_signature(tool_name, category, args)
  const records = state.records.filter((record) => record.generation === state?.generation)
  const exact_count = records.filter((record) => record.signature === signature).length + 1
  const category_count = records.filter((record) => record.category === category).length + 1

  state.records.push({ category, signature, at: now, generation: state.generation })
  if (state.records.length > MAX_EVIDENCE_RECORDS) {
    state.records.splice(0, state.records.length - MAX_EVIDENCE_RECORDS)
  }

  if (exact_count < 2 && category_count < 3) return ''

  const repetition = exact_count >= 2 ? `${exact_count} equivalent ${category} checks` : `${category_count} ${category} checks`
  return (
    `REPETITION ADVISORY (non-blocking): You have now gathered ${repetition} without an intervening source/configuration change. ` +
    'The check may still be useful, but repeating the same kind of evidence is unlikely to resolve an unanswered question by itself. ' +
    'Reassess what property is actually unverified and consider a different observation (for example current editor diagnostics, generated output, computed browser behavior, or the relevant source/configuration) before repeating it again.'
  )
}

export function resetRepetitionAdvisoryForTests() {
  repetition_states.clear()
}
