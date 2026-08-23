import { describe, expect, it } from 'vitest'
import { formatLocalPreflightPlan, shouldRunLocalPlanning } from '@/platform/agent/localPlanner'

describe('localPlanner', () => {
  it('skips tiny conversational turns and plans substantive tasks', () => {
    expect(shouldRunLocalPlanning('hello')).toBe(false)
    expect(shouldRunLocalPlanning('Inspect this project and update the provider settings UI.')).toBe(true)
  })

  it('formats observable decisions instead of raw reasoning', () => {
    const text = formatLocalPreflightPlan({
      taskType: 'code_change',
      needsLocalFiles: true,
      needsWebResearch: false,
      localQueries: ['provider settings'],
      webQueries: [],
      steps: ['retrieve files', 'edit code', 'run tests'],
    })
    expect(text).toContain('Use filesystem RAG')
    expect(text).toContain('retrieve files → edit code → run tests')
  })
})
