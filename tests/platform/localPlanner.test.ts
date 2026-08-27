import { describe, expect, it } from 'vitest'
import {
  formatLocalPreflightPlan,
  inferDirectPreflightPlan,
  shouldRunLocalPlanning,
} from '@/platform/agent/localPlanner'

describe('localPlanner', () => {
  it('skips social turns and bypasses model planning for obvious code work', () => {
    expect(shouldRunLocalPlanning('hello')).toBe(false)
    expect(
      shouldRunLocalPlanning('Inspect this project and update the provider settings UI.', {
        agent_working_dir: '/workspace',
      }),
    ).toBe(false)

    expect(
      inferDirectPreflightPlan('Inspect this project and update the provider settings UI.', {
        agent_working_dir: '/workspace',
      }),
    ).toMatchObject({
      taskType: 'code_change',
      developmentTask: true,
      workspaceMutationExpected: true,
      verificationRequired: true,
      needsLocalFiles: true,
    })
  })

  it('keeps read-only code analysis non-mutating', () => {
    expect(inferDirectPreflightPlan('Audit the agent runtime and explain why it loops.')).toMatchObject({
      taskType: 'code_change',
      developmentTask: true,
      workspaceMutationExpected: false,
      verificationRequired: false,
    })
  })

  it('uses the planner only for genuinely ambiguous substantive requests', () => {
    expect(shouldRunLocalPlanning('Help me decide the best approach for this.')).toBe(true)
  })

  it('formats only execution-critical state', () => {
    const text = formatLocalPreflightPlan({
      taskType: 'code_change',
      developmentTask: true,
      workspaceMutationExpected: true,
      verificationRequired: true,
      successCriteria: ['the feature works'],
      needsLocalFiles: true,
      needsWebResearch: false,
      localQueries: ['provider settings'],
      webQueries: [],
      preflightChecks: ['inspect manifests'],
      verificationChecks: ['run tests'],
      steps: ['retrieve files', 'edit code', 'run tests'],
    })
    expect(text).toContain('Workspace change required.')
    expect(text).toContain('Verify the result before finishing.')
    expect(text).not.toContain('retrieve files')
    expect(text).not.toContain('run tests')
  })
})
