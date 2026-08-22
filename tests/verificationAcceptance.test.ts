import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime_state = vi.hoisted(() => ({
  run: vi.fn(),
  load_context: vi.fn(),
  save_compacted: vi.fn(),
  sessions: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/platform/agentRuntimeLegacy', () => ({
  buildProjectWorkingContext: () => 'verification acceptance context',
  runAgentSession: runtime_state.run,
}))

vi.mock('@/platform/chatSessionStore', () => ({
  getChatSessionState: (id: string) => runtime_state.sessions.get(id) || null,
  loadChatContext: runtime_state.load_context,
  saveCompacted: runtime_state.save_compacted,
}))

vi.mock('@/platform/agent/localPlanner', () => ({
  buildLocalPreflightPlan: vi.fn(),
}))

import {
  addVerificationCandidate,
  declareVerificationRequirements,
  markVerificationMutation,
  recordVerificationEvidence,
  type VerificationState,
} from '../src/platform/agent/verificationEvidence'
import {
  runAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '../src/platform/agentRuntime'

function result(reply: string, step: number): AgentSessionResult {
  return {
    reply,
    timeline: [],
    todos: [{ id: 'implementation', text: 'Implement the requested change', status: 'done' }],
    steps: 1,
    stepHistory: [{ step, tool: 'terminal.exec', ok: true, summary: reply }],
    artifacts: [],
    skills: {},
    reward: null,
    safety: {},
    summary: {},
  }
}

function verification_state(input: AgentSessionInput) {
  return input.settings.agent_verification_state as VerificationState
}

describe('project verification acceptance', () => {
  beforeEach(() => {
    runtime_state.run.mockReset()
    runtime_state.load_context.mockReset()
    runtime_state.save_compacted.mockReset()
    runtime_state.sessions.clear()
    runtime_state.load_context.mockResolvedValue({ messages: [], memory: '', compacted: '' })
    runtime_state.save_compacted.mockResolvedValue(undefined)
  })

  it('remediates failed browser evidence, stales pre-edit checks, and accepts fresh evidence', async () => {
    runtime_state.run.mockImplementationOnce(async (input: AgentSessionInput) => {
      const state = verification_state(input)
      declareVerificationRequirements(state, ['tests', 'browser-runtime'])

      const tests = addVerificationCandidate(
        state,
        'terminal.exec',
        { command: 'npm test' },
        { exitCode: 0 },
      )!
      recordVerificationEvidence(state, 'tests', tests.id)

      const browser = addVerificationCandidate(
        state,
        'browser.inspect',
        { url: 'http://localhost:3000' },
        { ok: false, blankPage: true, consoleErrors: [{ message: 'ReactDOM.render is not a function' }] },
      )!
      recordVerificationEvidence(state, 'browser-runtime', browser.id)
      return result('Implementation completed but browser verification failed.', 1)
    })

    runtime_state.run.mockImplementationOnce(async (input: AgentSessionInput) => {
      const state = verification_state(input)
      markVerificationMutation(state)

      const fresh_tests = addVerificationCandidate(
        state,
        'terminal.exec',
        { command: 'npm test' },
        { exitCode: 0 },
      )!
      const fixed_browser = addVerificationCandidate(
        state,
        'browser.inspect',
        { url: 'http://localhost:3000' },
        { ok: true },
      )!
      recordVerificationEvidence(state, 'tests', fresh_tests.id)
      recordVerificationEvidence(state, 'browser-runtime', fixed_browser.id)
      return result('Fixed the runtime failure and reverified the application.', 2)
    })

    const input: AgentSessionInput = {
      userInput: 'Fix the browser application and verify it works.',
      conversation: [{ role: 'user', content: 'Fix the browser application and verify it works.' }],
      settings: {
        agent_working_dir: '/workspace',
        chat_session: { id: 'verification-chat' },
        agent_preflight_plan: {
          taskType: 'implementation',
          developmentTask: true,
          workspaceMutationExpected: true,
          verificationRequired: true,
          successCriteria: ['The application runs correctly in its intended environment.'],
          verificationChecks: [],
        },
      },
    }

    const output = await runAgentSession(input)

    expect(runtime_state.run).toHaveBeenCalledTimes(2)
    const remediation = runtime_state.run.mock.calls[1][0] as AgentSessionInput
    expect(remediation.userInput).toContain('VERIFICATION GATE REMEDIATION')
    expect(remediation.userInput).toContain('browser-runtime: failed')
    expect(output.summary.verification).toMatchObject({
      required: true,
      passed: true,
      remediationPasses: 1,
      mutationEpoch: 1,
    })
    expect(output.todos.some((todo) => todo.id === 'verification-gate')).toBe(false)
    const persisted = output.summary.verificationState as VerificationState
    expect(persisted.requirements).toEqual(['tests', 'browser-runtime'])
    expect(persisted.mutationEpoch).toBe(1)
  })
})
