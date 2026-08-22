import { describe, expect, it } from 'vitest'

import { evaluateAutonomousAcceptance } from '../src/platform/agent/autonomousAcceptance'

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateAutonomousAcceptance({
    multi_agent_enabled: true,
    todos: [],
    step_history: [],
    timeline: [],
    active_agents: [],
    write_leases: [],
    ...overrides,
  } as never)
}

describe('autonomous multi-agent acceptance', () => {
  it('blocks while TODOs, delegated work or leases remain active', () => {
    const result = evaluate({
      todos: [{ status: 'in_progress', text: 'finish implementation' }],
      active_agents: [{ status: 'working', currentTaskId: 'task-a', queueDepth: 0 }],
      write_leases: [{ path: '/workspace/a.ts', owner_id: 'executor', task_id: 'task-a' }],
    })

    expect(result.accepted).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/TODO/)
    expect(result.blockers.join(' ')).toMatch(/delegated agent/)
    expect(result.blockers.join(' ')).toMatch(/write lease/)
  })

  it('requires independent review when a main or delegated agent mutates files', () => {
    const direct = evaluate({
      step_history: [{ tool: 'files.edit', ok: true, summary: 'edited a.ts' }],
    })
    expect(direct.requires_review).toBe(true)
    expect(direct.accepted).toBe(false)

    const delegated = evaluate({
      timeline: [{ type: 'tool_result', tool: 'files.write', status: 'ok', role: 'executor' }],
    })
    expect(delegated.requires_review).toBe(true)
    expect(delegated.accepted).toBe(false)
  })

  it('rejects changes-requested review and a review made stale by later edits', () => {
    const requested = evaluate({
      step_history: [
        { tool: 'files.edit', ok: true },
        { tool: 'agent.review', ok: true, summary: '{"overallVerdict":"changes_requested"}' },
      ],
    })
    expect(requested.latest_review).toBe('changes_requested')
    expect(requested.accepted).toBe(false)

    const stale = evaluate({
      step_history: [
        { tool: 'files.edit', ok: true },
        { tool: 'agent.review', ok: true, summary: '{"overallVerdict":"approved"}' },
        { tool: 'files.patch', ok: true },
      ],
    })
    expect(stale.accepted).toBe(false)
    expect(stale.blockers.join(' ')).toMatch(/re-review/)
  })

  it('rejects a review that completed before a delegated worker finished writing', () => {
    const result = evaluate({
      step_history: [
        { tool: 'agent.delegate', ok: true },
        { tool: 'agent.review', ok: true, summary: '{"overallVerdict":"approved"}' },
      ],
      timeline: [
        { type: 'tool_result', tool: 'agent.review', status: 'ok' },
        { type: 'tool_result', tool: 'files.edit', status: 'ok', role: 'executor' },
      ],
    })

    expect(result.accepted).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/re-review/)
  })

  it('accepts clean reviewed coding work after all delegated work settles', () => {
    const result = evaluate({
      step_history: [
        { tool: 'files.edit', ok: true },
        { tool: 'agent.review', ok: true, summary: '{"reviewed":true,"overallVerdict":"approved"}' },
      ],
      timeline: [
        { type: 'tool_result', tool: 'files.edit', status: 'ok' },
        { type: 'tool_result', tool: 'agent.review', status: 'ok' },
      ],
      active_agents: [{ status: 'idle', currentTaskId: null, queueDepth: 0 }],
    })

    expect(result.accepted).toBe(true)
    expect(result.latest_review).toBe('approved')
  })

  it('does not impose the multi-agent gate when multi-agent mode is disabled', () => {
    const result = evaluate({
      multi_agent_enabled: false,
      todos: [{ status: 'in_progress' }],
      write_leases: [{ path: '/workspace/a.ts', owner_id: 'executor', task_id: 'task-a' }],
    })

    expect(result.accepted).toBe(true)
  })
})
