/**
 * Guards the small-model prompt surface: compact stable instructions, no model-size conditioning,
 * and state headers that only include live task context when it exists.
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
  it('keeps the base controller prompt compact and progress-oriented', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'lean' })
    expect(prompt).toContain('Choose the highest-value action')
    expect(prompt).toContain('Read only what you need')
    expect(prompt).toContain('fix it instead of gathering equivalent evidence')
    expect(prompt).not.toContain('Take exactly ONE action per turn')
    expect(prompt).not.toContain('You are a smaller local model')
    expect(prompt.length).toBeLessThan(1800)
  })

  it('keeps structured-format guidance short without strict-format threats or schema examples', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'structured' })
    expect(prompt).toContain('# Response')
    expect(prompt).toContain('Return one JSON object')
    expect(prompt).not.toContain('STRICT JSON')
    expect(prompt).not.toContain('{"thinking"')
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
    expect(text).toContain('## Recent actions')
  })

  it('only adds capability text for a capability that changes available input', () => {
    const prompt = buildControllerSystemPrompt({
      tier: 'lean',
      tags: ['reasoning', 'long-context', 'local', 'vision'],
    })
    expect(prompt).toContain('# Capabilities')
    expect(prompt).toContain('visual inputs')
    expect(prompt).not.toContain('deliberate internally')
    expect(prompt).not.toContain('large context window')
    expect(prompt).not.toContain('smaller local model')
  })

  it('adds a concise assignment when a role is supplied', () => {
    const prompt = buildControllerSystemPrompt({ tier: 'lean', role: 'consultant' })
    expect(prompt).toContain('# Assignment')
    expect(prompt).toContain('focused question')
  })

  it('adds peer guidance only when the mesh is enabled', () => {
    const off = buildControllerSystemPrompt({ tier: 'lean' })
    expect(off).not.toContain('# Peers')
    const on = buildControllerSystemPrompt({ tier: 'lean', meshEnabled: true })
    expect(on).toContain('# Peers')
    expect(on).toContain('real knowledge or reasoning gap')
    expect(on.toLowerCase()).toContain('untrusted')
  })
})
