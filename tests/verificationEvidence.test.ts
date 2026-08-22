import { describe, expect, it } from 'vitest'

import {
  addVerificationCandidate,
  createVerificationState,
  declareVerificationRequirements,
  evaluateVerificationGate,
  markVerificationMutation,
  recordVerificationEvidence,
} from '../src/platform/agent/verificationEvidence'

describe('verification evidence', () => {
  it('blocks failed browser evidence, stales passed checks after edits, then accepts fresh passing evidence', () => {
    const state = createVerificationState('react-regression', true)
    declareVerificationRequirements(state, ['tests', 'browser'])

    const tests = addVerificationCandidate(state, 'terminal.exec', { command: 'npm test' }, { exitCode: 0 })!
    recordVerificationEvidence(state, 'tests', tests.id)

    const brokenBrowser = addVerificationCandidate(
      state,
      'browser.inspect',
      { url: 'http://localhost:3000' },
      { ok: false, blankPage: true, consoleErrors: [{ message: 'ReactDOM.render is not a function' }] },
    )!
    recordVerificationEvidence(state, 'browser', brokenBrowser.id)

    expect(evaluateVerificationGate(state).passed).toBe(false)
    expect(evaluateVerificationGate(state).requirements.find((item) => item.requirement === 'browser')?.status).toBe('failed')

    markVerificationMutation(state)
    expect(evaluateVerificationGate(state).requirements.find((item) => item.requirement === 'tests')?.status).toBe('stale')

    const freshTests = addVerificationCandidate(state, 'terminal.exec', { command: 'npm test' }, { exitCode: 0 })!
    const fixedBrowser = addVerificationCandidate(state, 'browser.inspect', { url: 'http://localhost:3000' }, { ok: true })!
    recordVerificationEvidence(state, 'tests', freshTests.id)
    recordVerificationEvidence(state, 'browser', fixedBrowser.id)

    expect(evaluateVerificationGate(state).passed).toBe(true)
  })

  it('treats independent review as exact evidence and stales it after a later source mutation', () => {
    const state = createVerificationState('review-evidence', true)
    declareVerificationRequirements(state, ['independent-review'])

    const review = addVerificationCandidate(
      state,
      'agent.review',
      { focus: 'final implementation review' },
      { reviewed: true, overallVerdict: 'approved', findings: [] },
    )!
    recordVerificationEvidence(state, 'independent-review', review.id)
    expect(evaluateVerificationGate(state).passed).toBe(true)

    markVerificationMutation(state)
    const gate = evaluateVerificationGate(state)
    expect(gate.passed).toBe(false)
    expect(gate.requirements[0].status).toBe('stale')
  })

  it('never treats missing terminal exit codes or unsupported diagnostics as passing evidence', () => {
    const state = createVerificationState('unknown-results', true)
    declareVerificationRequirements(state, ['runtime', 'diagnostics'])

    const runtime = addVerificationCandidate(state, 'launch.run', { command: 'npm run dev' }, { pid: 42 })!
    const diagnostics = addVerificationCandidate(state, 'diagnostics.check', { path: 'data.bin' }, { supported: false, ok: null })!
    recordVerificationEvidence(state, 'runtime', runtime.id)
    recordVerificationEvidence(state, 'diagnostics', diagnostics.id)

    const gate = evaluateVerificationGate(state)
    expect(gate.passed).toBe(false)
    expect(gate.requirements.map((item) => item.status)).toEqual(['unknown', 'unknown'])
  })
})
