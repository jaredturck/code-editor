/**
 * Guards the lean-loop prompt changes: no forced planning ceremony, proportional reasoning,
 * and a state header that omits empty sections so a trivial first turn stays tiny.
 */
import { describe, expect, it } from 'vitest'
import { buildControllerSystemPrompt, buildControllerStateHeader } from '@/platform/agent/controllerPrompt'

const basePayload = {
  step: 1,
  skills: { cards: [], active_skills: [] },
  constraints: { guardrails: { max_steps: 12 } },
  relevant_memory: { notes: [] },
}

describe('controllerPrompt', () => {
  it('drops the forced # Planning section and makes reasoning proportional', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'lean' })
    expect(prompt).not.toContain('# Planning')
    expect(prompt).toContain('# Reasoning')
    expect(prompt.toLowerCase()).toContain('just do it') // proportional, not "always plan"
  })

  it('state header omits empty Todos / Recent actions (tiny trivial turn)', () => {
    const header = buildControllerStateHeader({
      ...basePayload,
      user_request: 'hello',
      todos: [],
      previous_steps: [],
    })
    const text = typeof header === 'string' ? header : ''
    expect(text).toContain('# Task')
    expect(text).not.toContain('## Todos')
    expect(text).not.toContain('## Recent actions')
  })

  it('state header includes Todos / Recent actions once there is real work', () => {
    const header = buildControllerStateHeader({
      ...basePayload,
      step: 2,
      user_request: 'do a multi-step thing',
      todos: [{ id: 1, text: 'step one', status: 'in_progress' }],
      previous_steps: [{ tool: 'files.read', ok: true, summary: 'read it' }],
    })
    const text = typeof header === 'string' ? header : ''
    expect(text).toContain('## Todos')
    // De-stepped: the action history renders under "## Recent actions" (no step numbers/position).
    expect(text).toContain('## Recent actions')
  })

  // ── Workstream D: tag/role-composed prompt ──────────────────────────────────
  it('composes capability fragments from ability tags', () => {
    const prompt = buildControllerSystemPrompt({
      tier: 'lean',
      tags: ['reasoning', 'long-context', 'cheap'],
    })
    expect(prompt).toContain('# Your capabilities')
    expect(prompt).toContain('deliberate internally') // reasoning fragment
    expect(prompt).toContain('large context window') // long-context fragment
    // 'cheap' has no behaviour fragment → must not invent a line for it
    expect(prompt).not.toContain('cheap')
  })

  it('adds the role fragment and keeps base prompt when no tags', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'lean', role: 'consultant' })
    expect(prompt).toContain('# Your role')
    expect(prompt).toContain('being consulted')
    expect(prompt).not.toContain('# Your capabilities') // no tags → no capability block
  })

  it('adds the light mesh suggestion only when the bridge is on', () => {
    const off = buildControllerSystemPrompt({ tier: 'lean' })
    expect(off).not.toContain('# Peers')
    const on = buildControllerSystemPrompt({ tier: 'lean', meshEnabled: true })
    expect(on).toContain('# Peers')
    expect(on.toLowerCase()).toContain('agent.consult')
    expect(on.toLowerCase()).toContain('untrusted') // peer answers are untrusted input
  })

  it('lets a model pull ANY level of peer and mentions the overwatcher', () => {
    const on = buildControllerSystemPrompt({ tier: 'lean', meshEnabled: true })
    expect(on).toContain('regardless of its level') // any-to-any, not just downward
    expect(on.toLowerCase()).toContain('agent.overwatch')
  })

  it('composes the overwatcher role fragment', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'lean', role: 'overwatcher' })
    expect(prompt).toContain('# Your role')
    expect(prompt).toContain('Overwatcher')
  })
})
