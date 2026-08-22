import { describe, expect, it } from 'vitest'

import {
  addVerificationCandidate,
  createVerificationState,
  declareVerificationRequirements,
  ensureVerificationState,
  evaluateVerificationGate,
  markVerificationMutation,
  recordVerificationEvidence,
  snapshotVerificationState,
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
      { reviewed: true, overallVerdict: 'approved', reviews: [{ verdict: 'approved' }], findings: [] },
    )!
    recordVerificationEvidence(state, 'independent-review', review.id)
    expect(evaluateVerificationGate(state).passed).toBe(true)

    markVerificationMutation(state)
    const gate = evaluateVerificationGate(state)
    expect(gate.passed).toBe(false)
    expect(gate.requirements[0].status).toBe('stale')
  })

  it('does not accept an approved aggregate when every peer reviewer errored', () => {
    const state = createVerificationState('review-errors', true)
    declareVerificationRequirements(state, ['independent-review'])

    const review = addVerificationCandidate(
      state,
      'agent.review',
      { focus: 'final implementation review' },
      {
        reviewed: true,
        overallVerdict: 'approved',
        reviews: [{ verdict: 'errored' }, { verdict: 'errored' }],
        findings: [],
      },
    )!
    recordVerificationEvidence(state, 'independent-review', review.id)

    const gate = evaluateVerificationGate(state)
    expect(gate.passed).toBe(false)
    expect(gate.requirements[0].status).toBe('unknown')
  })


  it('snapshots bounded verification state and restores it only for the same task contract', () => {
    const state = createVerificationState('persistent-contract', true)
    declareVerificationRequirements(state, ['tests'])

    for (let index = 0; index < 90; index += 1) {
      addVerificationCandidate(state, 'terminal.exec', { command: `test-${index}` }, { exitCode: 0 })
    }

    const snapshot = snapshotVerificationState(state)
    expect(Object.keys(snapshot.candidates).length).toBeLessThanOrEqual(80)
    expect(ensureVerificationState(snapshot, 'persistent-contract', true).requirements).toEqual(['tests'])
    expect(ensureVerificationState(snapshot, 'different-contract', true).requirements).toEqual([])
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
