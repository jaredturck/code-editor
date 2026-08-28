import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime_state = vi.hoisted(() => ({
  run: vi.fn(),
  planning: vi.fn(),
  get_state: vi.fn(),
  save_state: vi.fn(),
  load_context: vi.fn(),
  save_compacted: vi.fn(),
}))

vi.mock('@/platform/agent/toolCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/agent/toolCatalog')>()),
  getToolDefinitions: () => [],
}))

vi.mock('@/platform/agent/forcedPlanning', () => ({
  runForcedPlanning: runtime_state.planning,
}))

vi.mock('@/platform/agent/runtime/sessionRunner', () => ({
  runAgentSession: runtime_state.run,
}))

vi.mock('@/platform/chatSessionStore', () => ({
  getChatSessionState: runtime_state.get_state,
  saveChatSessionState: runtime_state.save_state,
  loadChatContext: runtime_state.load_context,
  saveCompacted: runtime_state.save_compacted,
}))

import {
  buildProjectWorkingContext,
  isProjectWorkingContext,
  persistedTaskMatchesInput,
  runAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '../src/platform/agentRuntime'

function result_fixture(): AgentSessionResult {
  return {
    reply: 'Updated the parser and verified the focused test.',
    timeline: [],
    todos: [
      { id: 1, text: 'Inspect parser', status: 'done' },
      { id: 2, text: 'Run full regression suite', status: 'pending' },
    ],
    steps: 3,
    stepHistory: [
      { step: 1, tool: 'rag.retrieve', ok: true, summary: 'src/parser.ts lines 20-90' },
      { step: 2, tool: 'files.edit', ok: true, summary: 'updated src/parser.ts' },
      { step: 3, tool: 'terminal.exec', ok: true, summary: 'focused parser test passed' },
    ],
    artifacts: [],
    skills: {},
    reward: null,
    safety: {},
    summary: { durationMs: 1234, toolsUsed: 3 },
  }
}

function planning_fixture() {
  return {
    artifacts: [
      { id: 'ideas', label: 'Exploring ideas', content: 'Explore several directions.' },
      { id: 'expand', label: 'Developing ideas', content: 'Develop the strongest possibilities.' },
      { id: 'direction', label: 'Choosing direction', content: 'Choose one coherent direction.' },
      { id: 'plan', label: 'Planning implementation', content: 'Implement the selected direction.' },
    ],
    context: '[PROJECT PLANNING]\n\nImplement the selected direction.\n\n[END PROJECT PLANNING]',
    timeline: [
      {
        type: 'planning',
        stage: 'plan',
        name: 'Planning implementation',
        label: 'Planning implementation',
        summary: 'Implement the selected direction.',
        at: 1,
      },
    ],
  }
}

function input_fixture(): AgentSessionInput {
  return {
    userInput: 'Fix the parser regression',
    conversation: [{ role: 'user', content: 'Fix the parser regression' }],
    settings: {
      agent_working_dir: '/workspace',
      chat_session: { id: 'chat-1' },
    },
  }
}

describe('autonomous project working context', () => {
  beforeEach(() => {
    runtime_state.run.mockReset()
    runtime_state.planning.mockReset()
    runtime_state.get_state.mockReset()
    runtime_state.save_state.mockReset()
    runtime_state.load_context.mockReset()
    runtime_state.save_compacted.mockReset()
    runtime_state.get_state.mockReturnValue(null)
    runtime_state.run.mockResolvedValue(result_fixture())
    runtime_state.planning.mockResolvedValue(planning_fixture())
    runtime_state.save_compacted.mockResolvedValue(undefined)
  })

  it('rolls verified actions, TODO state, prior context and outcome into a bounded checkpoint', () => {
    const compacted = buildProjectWorkingContext(
      input_fixture(),
      result_fixture(),
      '# Autonomous project working context\nEarlier decision: keep the parser API stable.',
    )

    expect(isProjectWorkingContext(compacted)).toBe(true)
    expect(compacted).toContain('Fix the parser regression')
    expect(compacted).toContain('Earlier decision: keep the parser API stable.')
    expect(compacted).toContain('[pending] Run full regression suite')
    expect(compacted).toContain('rag.retrieve')
    expect(compacted).toContain('updated src/parser.ts')
    expect(compacted).toContain('Updated the parser and verified the focused test.')
    expect(compacted.length).toBeLessThanOrEqual(12000)
  })

  it('matches persisted task metadata only to the same original goal', () => {
    runtime_state.get_state.mockReturnValue({
      projectRun: {
        goal: 'Fix the parser regression',
        runtime_summary: {
          taskPreflightPlan: {
            taskType: 'implementation',
            developmentTask: true,
            workspaceMutationExpected: true,
            verificationRequired: true,
            successCriteria: ['Parser regression is fixed.'],
            verificationChecks: ['tests'],
          },
        },
      },
    })

    const resumed = input_fixture()
    resumed.userInput = 'Continue the original development request:\nFix the parser regression\n\nUse the existing evidence.'
    expect(persistedTaskMatchesInput(resumed)).toBe(true)

    const new_task = input_fixture()
    new_task.userInput = 'Add a settings search box'
    expect(persistedTaskMatchesInput(new_task)).toBe(false)
  })

  it('forces project planning before the native coding session starts', async () => {
    await runAgentSession(input_fixture())

    expect(runtime_state.planning).toHaveBeenCalledTimes(1)
    expect(runtime_state.run).toHaveBeenCalledTimes(1)
    expect(runtime_state.planning.mock.invocationCallOrder[0]).toBeLessThan(runtime_state.run.mock.invocationCallOrder[0])
    const runtime_input = runtime_state.run.mock.calls[0][0] as AgentSessionInput
    expect(runtime_input.conversation?.some((message) => String(message.content || '').includes('[PROJECT PLANNING]'))).toBe(true)
    expect(runtime_state.save_state).toHaveBeenCalledWith('chat-1', { projectPlanning: null })
    expect(runtime_state.save_state.mock.calls.some((call) => Boolean(call[1]?.projectPlanning))).toBe(true)
  })

  it('reuses the saved direction when an interrupted project resumes', async () => {
    const saved = planning_fixture()
    runtime_state.get_state.mockReturnValue({
      projectRun: { goal: 'Fix the parser regression' },
      projectPlanning: {
        goal: 'Fix the parser regression',
        artifacts: saved.artifacts,
        context: saved.context,
        completedAt: 100,
      },
    })
    const input = input_fixture()
    input.userInput =
      'Resume this project goal from the current files and persisted project ledger. Continue unfinished requirements without redoing completed work.\n\nFix the parser regression'

    await runAgentSession(input)

    expect(runtime_state.planning).not.toHaveBeenCalled()
    expect(runtime_state.run).toHaveBeenCalledTimes(1)
    const runtime_input = runtime_state.run.mock.calls[0][0] as AgentSessionInput
    expect(runtime_input.conversation?.some((message) => String(message.content || '').includes(saved.context))).toBe(true)
  })

  it('injects the last project checkpoint before a resumed workspace agent segment and refreshes it afterward', async () => {
    runtime_state.load_context.mockResolvedValue({
      messages: [],
      memory: '# Chat memory\nKeep compatibility with v1.',
      compacted: '# Autonomous project working context\nPrevious work: isolated parser.ts as the failing path.',
    })

    const result = await runAgentSession(input_fixture())

    expect(runtime_state.run).toHaveBeenCalledTimes(1)
    const runtime_input = runtime_state.run.mock.calls[0][0] as AgentSessionInput
    expect(String(runtime_input.conversation?.[0]?.content || '')).toContain('AUTONOMOUS PROJECT CONTEXT')
    expect(String(runtime_input.conversation?.[0]?.content || '')).toContain('isolated parser.ts')
    expect(runtime_state.save_compacted).toHaveBeenCalledTimes(1)
    expect(runtime_state.save_compacted.mock.calls[0][0]).toBe('chat-1')
    expect(runtime_state.save_compacted.mock.calls[0][1]).toContain('focused parser test passed')
    expect(result.contextCompaction).toContain('Autonomous project working context')
  })

  it('carries failed tool evidence into workspace recovery without prescribing the fix', async () => {
    const failed = result_fixture()
    failed.reply = 'The requested change was not completed.'
    failed.stepHistory = [
      { step: 1, tool: 'files.read', ok: false, error: 'website.py does not exist.' },
      { step: 2, tool: 'files.list', ok: true, summary: 'website.py is absent from /workspace' },
    ]
    failed.todos = [{ id: 1, text: 'Inspect website.py', status: 'in_progress' }]

    const recovered = result_fixture()
    recovered.reply = 'Created website.py.'
    recovered.stepHistory = [{ step: 1, tool: 'files.write', ok: true, summary: 'created /workspace/website.py' }]
    recovered.todos = [{ id: 1, text: 'Create website.py', status: 'done' }]

    runtime_state.run.mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered)
    const input = input_fixture()
    input.userInput = 'Create a website.py file with a Flask view'
    input.settings.permissions_file_write = true
    input.settings.agent_preflight_plan = {
      taskType: 'implementation',
      developmentTask: true,
      workspaceMutationExpected: true,
      verificationRequired: false,
      successCriteria: ['website.py exists with the requested Flask view.'],
      verificationChecks: [],
    }

    await runAgentSession(input)

    expect(runtime_state.run).toHaveBeenCalledTimes(2)
    const recovery_input = runtime_state.run.mock.calls[1][0] as AgentSessionInput
    const recovery_prompt = String(recovery_input.userInput || '')
    expect(recovery_prompt).toContain('website.py does not exist.')
    expect(recovery_prompt).toContain('website.py is absent from /workspace')
    expect(recovery_prompt).toContain('decide the next action yourself')
    expect(recovery_prompt).toContain('Reconcile any stale TODOs')
    expect(recovery_prompt).not.toContain('Use files.write/files.edit/files.patch')
  })

  it('does not create project checkpoints outside a workspace-scoped agent run', async () => {
    const input = input_fixture()
    input.settings.agent_working_dir = ''

    await runAgentSession(input)

    expect(runtime_state.planning).not.toHaveBeenCalled()
    expect(runtime_state.load_context).not.toHaveBeenCalled()
    expect(runtime_state.save_compacted).not.toHaveBeenCalled()
    expect(runtime_state.run.mock.calls[0][0].conversation).toEqual(input.conversation)
  })
})