/**
 * Exercises the observable stp builder contract, with regression cases for “builds a
 * normalized task with defaults” and “normalizes invalid types and priorities”. The suite
 * documents caller-visible behavior so implementation refactors cannot silently weaken
 * those guarantees.
 */

import { describe, expect, it, vi } from 'vitest'
import { buildSTP, buildSTPSystemPrompt, summariseSTP, validateSTPResult } from '@/platform/stpBuilder'

describe('stpBuilder', () => {
  it('builds a normalized task with defaults', () => {
    const stp = buildSTP({ goal: 'Inspect the project' })
    expect(stp).toMatchObject({
      stp: '1.0',
      type: 'execute',
      priority: 'normal',
      toAgent: 'deepseek',
      objective: { goal: 'Inspect the project', scope: '', constraints: [] },
      tools: { available: [], preferred: [], forbidden: [] },
      skills: { load: [], variant: 'default' },
      steps: [],
      output: expect.objectContaining({ schema: {}, format: 'json' }),
      budget: expect.objectContaining({
        maxSteps: expect.any(Number),
        maxTokens: expect.any(Number),
        timeoutMs: expect.any(Number),
      }),
    })
    expect(stp.output.maxChars).toBeGreaterThan(0)
    expect(stp.budget.maxSteps).toBeGreaterThan(0)
    expect(stp.budget.maxTokens).toBeGreaterThan(0)
    expect(stp.budget.timeoutMs).toBeGreaterThan(0)
    expect(stp.taskId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(stp.createdAt).toEqual(expect.any(Number))
  })

  it('normalizes invalid types and priorities', () => {
    const stp = buildSTP({ type: 'unknown', priority: 'urgent' })
    expect(stp.type).toBe('execute')
    expect(stp.priority).toBe('normal')
  })

  it('accepts every supported task type', () => {
    for (const type of ['execute', 'discover', 'summarize', 'verify', 'compile']) {
      expect(buildSTP({ type }).type).toBe(type)
    }
  })

  it('trims, filters, and caps string arrays', () => {
    const stp = buildSTP({
      constraints: ['  first  ', '', null, ...Array.from({ length: 30 }, (_, index) => `c${index}`)],
      tools: {
        available: [' files.read ', '', ...Array.from({ length: 40 }, (_, index) => `tool${index}`)],
      },
    })
    expect(stp.objective.constraints[0]).toBe('first')
    expect(stp.objective.constraints).toHaveLength(16)
    expect(stp.tools.available[0]).toBe('files.read')
    expect(stp.tools.available).toHaveLength(32)
  })

  it('distinguishes tier-default tools from an explicit empty whitelist', () => {
    expect(buildSTP({}).tools).toMatchObject({ mode: 'auto', available: [] })
    expect(buildSTP({ tools: { available: [] } }).tools).toMatchObject({
      mode: 'explicit',
      available: [],
    })
    expect(buildSTP({ tools: { available: ['files.read'] } }).tools).toMatchObject({
      mode: 'explicit',
      available: ['files.read'],
    })
  })

  it('normalizes explicit steps', () => {
    const stp = buildSTP({
      steps: [
        {
          action: 'files.read',
          args: { path: 'README.md' },
          onError: 'continue',
        },
        null,
        { order: '5', action: 'files.list', args: 'invalid', onEmpty: 'stop' },
      ],
    })
    expect(stp.steps).toEqual([
      {
        order: 1,
        action: 'files.read',
        args: { path: 'README.md' },
        onEmpty: '',
        onError: 'continue',
      },
      {
        order: 5,
        action: 'files.list',
        args: {},
        onEmpty: 'stop',
        onError: '',
      },
    ])
  })

  it('clamps budgets to supported ranges', () => {
    const low = buildSTP({
      budget: { maxSteps: -1, maxTokens: 1, timeoutMs: 1, maxOutputChars: 1 },
    })
    expect(low.budget).toEqual({
      maxSteps: 1,
      maxTokens: 500,
      timeoutMs: 5000,
    })
    expect(low.output.maxChars).toBe(200)

    const high = buildSTP({
      budget: {
        maxSteps: 100,
        maxTokens: 100000,
        timeoutMs: 900000,
        maxOutputChars: 50000,
      },
    })
    expect(high.budget.maxSteps).toBeLessThan(100)
    expect(high.budget.maxTokens).toBeLessThan(100000)
    expect(high.budget.timeoutMs).toBeLessThan(900000)
    expect(high.output.maxChars).toBeLessThan(50000)
    expect(high.budget.maxSteps).toBeGreaterThanOrEqual(low.budget.maxSteps)
    expect(high.budget.maxTokens).toBeGreaterThanOrEqual(low.budget.maxTokens)
    expect(high.budget.timeoutMs).toBeGreaterThanOrEqual(low.budget.timeoutMs)
    expect(high.output.maxChars).toBeGreaterThanOrEqual(low.output.maxChars)
  })

  it('preserves explicit role, provider, and model identity separately from legacy toAgent', () => {
    const stp = buildSTP({
      toAgent: 'deepseek',
      agentIdentity: {
        role: 'executor',
        provider: 'openrouter',
        model: 'deepseek/deepseek-r1',
      },
    })

    expect(stp.toAgent).toBe('deepseek')
    expect(stp.agentIdentity).toEqual({
      role: 'executor',
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1',
    })
  })

  it('preserves context and output schemas', () => {
    const context = { projectRoot: '/project' }
    const schema = { files: 'array' }
    const stp = buildSTP({ context, outputSchema: schema })
    expect(stp.context).toBe(context)
    expect(stp.output.schema).toBe(schema)
  })

  it('builds a detailed system prompt', () => {
    const stp = buildSTP({
      type: 'discover',
      goal: 'Find configuration files',
      scope: 'Project root only',
      constraints: ['Do not edit files'],
      tools: {
        available: ['files.find'],
        preferred: ['files.find'],
        forbidden: ['files.write'],
      },
      skills: { load: ['search'], variant: 'simple' },
      steps: [
        {
          action: 'files.find',
          args: { query: 'config' },
          onEmpty: 'report none',
          onError: 'return failure',
        },
      ],
      outputSchema: { files: [] },
      budget: { maxSteps: 4, maxOutputChars: 1200 },
      toAgent: 'local',
    })

    const prompt = buildSTPSystemPrompt(stp, ['[Search Skill]\nUse filenames first.'])
    expect(prompt).toContain(`task ${stp.taskId}`)
    expect(prompt).toContain('OBJECTIVE: Find configuration files')
    expect(prompt).toContain('SCOPE: Project root only')
    expect(prompt).toContain('FORBIDDEN TOOLS: files.write')
    expect(prompt).toContain('OUTPUT SCHEMA: {"files":[]}')
    expect(prompt).toContain('[Search Skill]')
    expect(prompt).toContain('1. files.find args={"query":"config"}')
    expect(prompt).toContain('Always respond with strict JSON only.')
  })

  it('marks autonomous tasks in the system prompt', () => {
    expect(buildSTPSystemPrompt(buildSTP({ goal: 'Think' }))).toContain('Reason autonomously')
  })

  it('accepts results when no schema is required', () => {
    expect(validateSTPResult(null, {})).toEqual({ valid: true, missing: [] })
  })

  it('reports all schema keys missing from non-object results', () => {
    expect(validateSTPResult(null, { files: [], summary: '' })).toEqual({
      valid: false,
      missing: ['files', 'summary'],
    })
  })

  it('validates required top-level schema keys', () => {
    expect(validateSTPResult({ files: [] }, { files: [], summary: '' })).toEqual({
      valid: false,
      missing: ['summary'],
    })
    expect(validateSTPResult({ files: [], summary: '' }, { files: [], summary: '' })).toEqual({
      valid: true,
      missing: [],
    })
  })

  it('summarizes explicit and autonomous tasks', () => {
    const explicit = buildSTP({
      type: 'verify',
      goal: 'Check output',
      toAgent: 'deepseek',
      steps: [{ action: 'files.read' }],
    })
    const autonomous = buildSTP({ goal: 'Investigate', toAgent: 'local' })
    expect(summariseSTP(explicit)).toContain('[STP verify → deepseek] (1 explicit steps): Check output')
    expect(summariseSTP(autonomous)).toContain('[STP execute → local] (autonomous): Investigate')
  })
})
