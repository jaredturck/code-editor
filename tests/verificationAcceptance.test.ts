import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime_state = vi.hoisted(() => ({
  run: vi.fn(),
  load_context: vi.fn(),
  save_compacted: vi.fn(),
  planner: vi.fn(),
  diagnostics: vi.fn(),
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
  buildLocalPreflightPlan: runtime_state.planner,
}))

vi.mock('@/platform/agent/workspaceDiagnosticsState', () => ({
  getWorkspaceDiagnosticsSnapshot: runtime_state.diagnostics,
  formatWorkspaceDiagnostics: (snapshot: Record<string, any>) => {
    const lines = [`LIVE WORKSPACE DIAGNOSTICS: ${snapshot.counts.errors} errors.`]
    for (const finding of snapshot.findings || []) {
      lines.push(`- ERROR ${finding.path} · ${finding.line}:${finding.column} — ${finding.message}`)
    }
    return lines.join('\n')
  },
}))

import {
  addVerificationCandidate,
  buildVerificationContractKey,
  createVerificationState,
  declareVerificationRequirements,
  markVerificationMutation,
  recordVerificationEvidence,
  type VerificationState,
} from '../src/platform/agent/verificationEvidence'
import { runAgentSession, type AgentSessionInput, type AgentSessionResult } from '../src/platform/agentRuntime'

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

function workspace_diagnostics(errors = 0, messages: string[] = []) {
  return {
    root: '/workspace',
    refreshed_at: Date.now(),
    analyzed_files: 1,
    diagnostic_files: errors > 0 ? 1 : 0,
    counts: {
      errors,
      warnings: 0,
      info: 0,
      total: errors,
    },
    findings: messages.map((message, index) => ({
      path: '/workspace/index.html',
      source: 'HTML Validate',
      code: 'test-error',
      severity: 'error',
      message,
      line: index + 10,
      column: 1,
      end_line: index + 10,
      end_column: 2,
    })),
    scan_errors: [],
    complete: true,
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
    runtime_state.planner.mockReset()
    runtime_state.diagnostics.mockReset()
    runtime_state.sessions.clear()
    runtime_state.load_context.mockResolvedValue({ messages: [], memory: '', compacted: '' })
    runtime_state.save_compacted.mockResolvedValue(undefined)
    runtime_state.diagnostics.mockResolvedValue(workspace_diagnostics())
  })

  it('remediates failed browser evidence, stales pre-edit checks, and accepts fresh evidence', async () => {
    runtime_state.run.mockImplementationOnce(async (input: AgentSessionInput) => {
      const state = verification_state(input)
      declareVerificationRequirements(state, ['tests', 'browser-runtime'])

      const tests = addVerificationCandidate(state, 'terminal.exec', { command: 'npm test' }, { exitCode: 0 })!
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

      const fresh_tests = addVerificationCandidate(state, 'terminal.exec', { command: 'npm test' }, { exitCode: 0 })!
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
    expect(remediation.userInput).toContain('PROJECT ACCEPTANCE REMEDIATION')
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

  it('treats live editor errors as blocking even when model verification passed', async () => {
    runtime_state.diagnostics
      .mockResolvedValueOnce(workspace_diagnostics(2, ['Raw "&" must be encoded as "&amp;"', 'Inline style is not allowed']))
      .mockResolvedValue(workspace_diagnostics())

    runtime_state.run.mockImplementationOnce(async (input: AgentSessionInput) => {
      const state = verification_state(input)
      declareVerificationRequirements(state, ['browser-runtime'])
      const browser = addVerificationCandidate(
        state,
        'browser.inspect',
        { url: 'http://localhost:3000' },
        { ok: true },
      )!
      recordVerificationEvidence(state, 'browser-runtime', browser.id)
      return result('The page renders, so I consider it complete.', 1)
    })
    runtime_state.run.mockImplementationOnce(async () => result('Fixed the editor errors.', 2))

    const output = await runAgentSession({
      userInput: 'Build a valid single-file page with no editor errors.',
      conversation: [],
      settings: {
        agent_working_dir: '/workspace',
        chat_session: { id: 'diagnostics-chat' },
        agent_preflight_plan: {
          taskType: 'implementation',
          developmentTask: true,
          workspaceMutationExpected: true,
          verificationRequired: true,
          successCriteria: ['The page has no editor errors.'],
          verificationChecks: [],
        },
      },
    })

    expect(runtime_state.run).toHaveBeenCalledTimes(2)
    const remediation = runtime_state.run.mock.calls[1][0] as AgentSessionInput
    expect(remediation.userInput).toContain('LIVE WORKSPACE DIAGNOSTICS ARE A HARD COMPLETION GATE')
    expect(remediation.userInput).toContain('Raw "&" must be encoded as "&amp;"')
    expect(remediation.userInput).toContain('Inline style is not allowed')
    expect(remediation.userInput).toContain('Do not relabel editor errors as cosmetic')
    expect(output.summary.workspaceDiagnostics).toMatchObject({
      complete: true,
      counts: { errors: 0 },
    })
    expect(output.todos.some((todo) => todo.id === 'diagnostics-gate')).toBe(false)
  })

  it('stops after bounded diagnostics remediation instead of claiming completion', async () => {
    runtime_state.diagnostics.mockResolvedValue(
      workspace_diagnostics(1, ['Trailing whitespace']),
    )
    runtime_state.run.mockResolvedValue(result('Still calling the page complete.', 1))

    const output = await runAgentSession({
      userInput: 'Create valid HTML with no errors.',
      conversation: [],
      settings: {
        agent_working_dir: '/workspace',
        chat_session: { id: 'bounded-diagnostics-chat' },
        agent_preflight_plan: {
          taskType: 'implementation',
          developmentTask: true,
          workspaceMutationExpected: true,
          verificationRequired: false,
          successCriteria: ['No editor errors remain.'],
          verificationChecks: [],
        },
      },
    })

    expect(runtime_state.run).toHaveBeenCalledTimes(3)
    expect(output.todos.some((todo) => todo.id === 'diagnostics-gate' && todo.status === 'in_progress')).toBe(true)
    expect(output.reply).toContain('project acceptance gate remains open')
    expect(output.reply).toContain('Workspace diagnostics still report 1 error.')
  })

  it('reuses the persisted model task contract when a paused project run resumes', async () => {
    const persisted_plan = {
      taskType: 'implementation',
      developmentTask: true,
      workspaceMutationExpected: true,
      verificationRequired: true,
      successCriteria: ['The resumed implementation remains correct.'],
      verificationChecks: [],
    }
    const state = createVerificationState(buildVerificationContractKey(persisted_plan), true)
    declareVerificationRequirements(state, ['tests'])
    const tests = addVerificationCandidate(state, 'terminal.exec', { command: 'npm test' }, { exitCode: 0 })!
    recordVerificationEvidence(state, 'tests', tests.id)

    runtime_state.sessions.set('resume-chat', {
      projectRun: {
        summary: {
          taskPreflightPlan: persisted_plan,
          verificationState: state,
        },
      },
    })
    runtime_state.planner.mockResolvedValue({
      ...persisted_plan,
      successCriteria: ['A textually different regenerated contract.'],
    })
    runtime_state.run.mockImplementationOnce(async (input: AgentSessionInput) => {
      expect(input.settings.agent_preflight_plan).toEqual(persisted_plan)
      expect(verification_state(input).contractKey).toBe(buildVerificationContractKey(persisted_plan))
      return result('Resumed without discarding valid verification evidence.', 1)
    })

    const output = await runAgentSession({
      userInput: 'Resume the existing project run.',
      conversation: [],
      settings: {
        agent_working_dir: '/workspace',
        chat_session: { id: 'resume-chat' },
      },
    })

    expect(runtime_state.planner).not.toHaveBeenCalled()
    expect(runtime_state.run).toHaveBeenCalledTimes(1)
    expect(output.summary.verification).toMatchObject({ required: true, passed: true })
    expect(output.summary.taskPreflightPlan).toEqual(persisted_plan)
  })
})
