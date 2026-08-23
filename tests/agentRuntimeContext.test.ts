import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime_state = vi.hoisted(() => ({
  run: vi.fn(),
  load_context: vi.fn(),
  save_compacted: vi.fn(),
}))

vi.mock('@/platform/agent/toolCatalog', () => ({
  getToolDefinitions: () => [],
}))

vi.mock('@/platform/agent/runtime/sessionRunner', () => ({
  runAgentSession: runtime_state.run,
}))

vi.mock('@/platform/chatSessionStore', () => ({
  loadChatContext: runtime_state.load_context,
  saveCompacted: runtime_state.save_compacted,
}))

import {
  buildProjectWorkingContext,
  isProjectWorkingContext,
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
    runtime_state.load_context.mockReset()
    runtime_state.save_compacted.mockReset()
    runtime_state.run.mockResolvedValue(result_fixture())
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

    expect(runtime_state.load_context).not.toHaveBeenCalled()
    expect(runtime_state.save_compacted).not.toHaveBeenCalled()
    expect(runtime_state.run.mock.calls[0][0].conversation).toEqual(input.conversation)
  })
})
