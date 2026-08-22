import type { AgentWriteLease } from '@/platform/agent/writeLease'

export interface AutonomousAcceptanceInput {
  multi_agent_enabled: boolean
  todos: Array<Record<string, unknown>>
  step_history: Array<Record<string, unknown>>
  timeline: Array<Record<string, unknown>>
  active_agents: Array<Record<string, unknown>>
  write_leases: AgentWriteLease[]
}

export interface AutonomousAcceptanceResult {
  accepted: boolean
  blockers: string[]
  requires_review: boolean
  latest_review: 'approved' | 'changes_requested' | 'mixed' | 'errored' | 'unknown' | 'missing'
}

const MUTATION_TOOLS = new Set(['files.write', 'files.edit', 'files.patch'])
const REVIEW_TOOL = 'agent.review'
const DELEGATION_TOOLS = new Set(['agent.delegate', 'agent.recall', 'agent.recallAll'])

function lower(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function is_open_todo(todo: Record<string, unknown>) {
  return ['pending', 'in_progress', 'blocked'].includes(lower(todo.status || 'pending'))
}

function step_tool(step: Record<string, unknown>) {
  return String(step.tool || step.requestedTool || '').trim()
}

function is_successful_step(step: Record<string, unknown>) {
  return step.ok !== false && !['error', 'failed'].includes(lower(step.status))
}

function review_verdict(step: Record<string, unknown>): AutonomousAcceptanceResult['latest_review'] {
  const text = lower(`${step.summary || ''} ${step.result || ''} ${step.output || ''}`)
  if (text.includes('changes_requested')) return 'changes_requested'
  if (text.includes('"mixed"') || text.includes('overallverdict: mixed') || text.includes('overallverdict":"mixed')) {
    return 'mixed'
  }
  if (text.includes('approved')) return 'approved'
  if (text.includes('errored') || text.includes('review_failed')) return 'errored'
  return 'unknown'
}

function last_index<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}

function is_successful_timeline_tool(event: Record<string, unknown>, tool: string) {
  const status = lower(event.status)
  return (
    lower(event.type) === 'tool_result' &&
    String(event.tool || '').trim() === tool &&
    !['error', 'failed'].includes(status)
  )
}

function latest_timeline_mutation_index(timeline: Array<Record<string, unknown>>) {
  return last_index(
    timeline,
    (event) => MUTATION_TOOLS.has(String(event.tool || '').trim()) &&
      is_successful_timeline_tool(event, String(event.tool || '').trim()),
  )
}

export function evaluateAutonomousAcceptance(
  input: AutonomousAcceptanceInput,
): AutonomousAcceptanceResult {
  if (!input.multi_agent_enabled) {
    return { accepted: true, blockers: [], requires_review: false, latest_review: 'missing' }
  }

  const blockers: string[] = []
  const open_todos = input.todos.filter(is_open_todo)
  if (open_todos.length) blockers.push(`${open_todos.length} TODO item(s) are still open or blocked.`)

  const active_agents = input.active_agents.filter((agent) => {
    const status = lower(agent.status)
    const queue_depth = Number(agent.queueDepth || 0)
    return (status && status !== 'idle') || queue_depth > 0 || Boolean(agent.currentTaskId)
  })
  if (active_agents.length) {
    const task_ids = active_agents
      .map((agent) => String(agent.currentTaskId || '').trim())
      .filter(Boolean)
      .slice(0, 6)
    blockers.push(
      `${active_agents.length} delegated agent(s) still have active or queued work${task_ids.length ? ` (active task ids: ${task_ids.join(', ')})` : ''}.`,
    )
  }

  if (input.write_leases.length) {
    const leased_paths = input.write_leases.map((lease) => lease.path).slice(0, 6)
    blockers.push(
      `${input.write_leases.length} task-scoped file write lease(s) are still held${leased_paths.length ? ` (${leased_paths.join(', ')})` : ''}.`,
    )
  }

  const direct_mutation_index = last_index(
    input.step_history,
    (step) => MUTATION_TOOLS.has(step_tool(step)) && is_successful_step(step),
  )
  const timeline_mutation_index = latest_timeline_mutation_index(input.timeline)
  const requires_review = direct_mutation_index >= 0 || timeline_mutation_index >= 0
  let latest_review: AutonomousAcceptanceResult['latest_review'] = 'missing'

  if (requires_review) {
    const review_index = last_index(
      input.step_history,
      (step) => step_tool(step) === REVIEW_TOOL && is_successful_step(step),
    )
    const timeline_review_index = last_index(
      input.timeline,
      (event) => is_successful_timeline_tool(event, REVIEW_TOOL),
    )

    if (review_index < 0) {
      blockers.push('Independent review has not run after the coding changes.')
    } else {
      latest_review = review_verdict(input.step_history[review_index])
      const later_change_or_handoff = input.step_history
        .slice(review_index + 1)
        .some((step) =>
          is_successful_step(step) &&
          (MUTATION_TOOLS.has(step_tool(step)) || DELEGATION_TOOLS.has(step_tool(step))),
        )
      const timeline_review_is_stale =
        timeline_mutation_index >= 0 &&
        (timeline_review_index < 0 || timeline_review_index < timeline_mutation_index)

      if (later_change_or_handoff || timeline_review_is_stale) {
        blockers.push('Code or delegated work changed after the latest independent review; re-review the final state.')
      } else if (latest_review === 'changes_requested' || latest_review === 'mixed') {
        blockers.push(`The latest independent review is ${latest_review}; remediate its findings and re-review.`)
      } else if (latest_review !== 'approved') {
        blockers.push('The latest independent review did not produce an explicit approved verdict.')
      }
    }
  }

  return {
    accepted: blockers.length === 0,
    blockers,
    requires_review,
    latest_review,
  }
}

export function buildAcceptanceRemediationPrompt(result: AutonomousAcceptanceResult) {
  const blockers = result.blockers.map((blocker) => `- ${blocker}`).join('\n')
  return `AUTONOMOUS ACCEPTANCE GATE: The project is not ready to finish yet. Continue working without asking the user unless a genuine product decision or permission is required.\n\nBlocking conditions:\n${blockers}\n\nUse agent.roster/status/recall as needed to await active work, resolve stale/lease conflicts through coordination and fresh live-file reads, finish or explicitly resolve TODOs, and if code changed obtain an independent agent.review. If review requests changes, fix them, rerun relevant verification, then review the corrected state again. Do not declare completion until the gate can pass.`
}
