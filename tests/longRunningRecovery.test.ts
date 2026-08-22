import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const durable_state = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  compacted: '',
  load_context: vi.fn(),
  save_compacted: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/platform/chatSessionStore', () => ({
  getChatSessionState: (id: string) => {
    const value = durable_state.sessions.get(id)
    return value ? structuredClone(value) : null
  },
  saveChatSessionState: (id: string, patch: Record<string, unknown>) => {
    const current = durable_state.sessions.get(id) || {}
    durable_state.sessions.set(id, structuredClone({ ...current, ...patch }))
  },
  loadChatContext: durable_state.load_context,
  saveCompacted: durable_state.save_compacted,
}))

vi.mock('@/platform/agent/runtime/sessionRunner', () => ({
  runAgentSession: durable_state.run,
}))

vi.mock('@/platform/agent/toolCatalog', () => ({
  getToolDefinitions: () => [],
}))

vi.mock('@/platform/agent/writeLease', () => ({
  listAgentWriteLeases: () => [],
}))

vi.mock('@/platform/agent/modelHealthMonitor', () => ({
  startModelHealthMonitor: () => undefined,
}))

vi.mock('@/platform/subAgentRuntime', () => ({
  getAgentRoster: () => [],
}))

import {
  project_run_elapsed_ms,
  projectRunController,
} from '../src/chat/projectRunController'
import {
  runAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from '../src/platform/agentRuntime'

const HOUR = 60 * 60 * 1000

function runtime_result({
  reply,
  todo_status = 'done',
  step = 1,
}: {
  reply: string
  todo_status?: string
  step?: number
}): AgentSessionResult {
  return {
    reply,
    timeline: [{ type: 'notice', summary: reply, step }],
    todos: [{ id: 'work', text: 'Finish the project objective', status: todo_status }],
    steps: 1,
    stepHistory: [{ step, tool: 'terminal.exec', ok: true, summary: `verification ${step}` }],
    artifacts: [],
    skills: {},
    reward: null,
    safety: {},
    summary: { durationMs: 1000 * step, toolsUsed: 1 },
  }
}

function runtime_input(): AgentSessionInput {
  return {
    userInput: 'Continue the long-running migration',
    conversation: [{ role: 'user', content: 'Continue the long-running migration' }],
    settings: {
      agent_working_dir: '/workspace',
      chat_session: { id: 'chat-1' },
      agent_tool_allowlist: ['terminal.exec'],
      agent_multi_enabled: false,
    },
  }
}

describe('long-running project recovery', () => {
  beforeEach(() => {
    durable_state.sessions.clear()
    durable_state.compacted = ''
    durable_state.load_context.mockReset()
    durable_state.save_compacted.mockReset()
    durable_state.run.mockReset()
    durable_state.load_context.mockImplementation(async () => ({
      messages: [],
      memory: '',
      compacted: durable_state.compacted,
    }))
    durable_state.save_compacted.mockImplementation(async (_chat_id: string, compacted: string) => {
      durable_state.compacted = String(compacted || '')
    })
    projectRunController.clear('chat-1')
    durable_state.sessions.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accumulates active time across multi-hour segments without counting paused downtime', () => {
    vi.useFakeTimers()
    const started_at = Date.parse('2026-08-22T00:00:00Z')
    vi.setSystemTime(started_at)

    const first = projectRunController.begin({
      id: 'run-hours',
      chat_id: 'chat-1',
      goal: 'Complete a multi-hour coding project',
      mode: 'automatic',
      provider: 'openai',
      model: 'gpt-test',
      todos: [{ id: '1', text: 'Implement feature', status: 'in_progress' }],
    })
    projectRunController.set_status('running', { last_activity: 'Implementation started' })

    vi.setSystemTime(started_at + 2 * HOUR)
    projectRunController.checkpoint({ steps: 12, last_activity: 'Two-hour checkpoint' })
    expect(project_run_elapsed_ms(projectRunController.get_state(), Date.now())).toBe(2 * HOUR)

    expect(projectRunController.request_pause()).toBe(true)
    expect(first.signal.aborted).toBe(true)
    expect(projectRunController.get_state()?.elapsed_ms).toBe(2 * HOUR)

    vi.setSystemTime(started_at + 8 * HOUR)
    expect(project_run_elapsed_ms(projectRunController.get_state(), Date.now())).toBe(2 * HOUR)

    projectRunController.finish_segment()
    const resumed = projectRunController.resume('anthropic', 'claude-recovery')
    expect(resumed?.state.id).toBe('run-hours')
    expect(resumed?.state.steps).toBe(12)

    vi.setSystemTime(started_at + 11 * HOUR)
    projectRunController.checkpoint({ steps: 27, last_activity: 'Fifth active hour checkpoint' })
    expect(project_run_elapsed_ms(projectRunController.get_state(), Date.now())).toBe(5 * HOUR)

    projectRunController.request_pause()
    expect(projectRunController.get_state()?.elapsed_ms).toBe(5 * HOUR)
    expect(projectRunController.get_state()?.checkpoint_count).toBe(3)
  })

  it('recovers only through the last durable checkpoint and resumes the same run state', () => {
    vi.useFakeTimers()
    const started_at = Date.parse('2026-08-22T00:00:00Z')
    vi.setSystemTime(started_at)

    projectRunController.begin({
      id: 'run-recovery',
      chat_id: 'chat-1',
      goal: 'Recover safely after a process interruption',
      mode: 'automatic',
      provider: 'openai',
      model: 'gpt-test',
      todos: [],
    })
    projectRunController.set_status('running', { last_activity: 'Working' })

    vi.setSystemTime(started_at + HOUR)
    projectRunController.checkpoint({
      todos: [
        { id: 'inspect', text: 'Inspect project', status: 'done' },
        { id: 'finish', text: 'Finish implementation', status: 'in_progress', dependsOn: ['inspect'] },
      ],
      steps: 18,
      summary: {
        usage: {
          provider: 'openai',
          model: 'gpt-test',
          requests: 9,
          promptTokens: 12000,
          completionTokens: 3000,
          totalTokens: 15000,
          contextWindow: 128000,
          contextRemaining: 113000,
          contextUsedPct: 11.72,
        },
      },
      last_activity: 'Durable checkpoint',
    })

    vi.setSystemTime(started_at + 90 * 60 * 1000)
    const restored = projectRunController.restore('chat-1')
    expect(restored?.status).toBe('interrupted')
    expect(restored?.elapsed_ms).toBe(HOUR)
    expect(restored?.steps).toBe(18)
    expect(restored?.todos.map((todo) => todo.status)).toEqual(['done', 'in_progress'])
    expect(restored?.usage?.requests).toBe(9)
    expect(restored?.usage?.totalTokens).toBe(15000)
    expect(restored?.error).toContain('interrupted')

    const resumed = projectRunController.resume('anthropic', 'claude-recovery')
    expect(resumed?.state.id).toBe('run-recovery')
    expect(resumed?.state.goal).toBe('Recover safely after a process interruption')
    expect(resumed?.state.provider).toBe('anthropic')
    expect(resumed?.state.model).toBe('claude-recovery')
    expect(resumed?.state.error).toBe('')
    expect(resumed?.state.todos[1]?.text).toBe('Finish implementation')

    vi.setSystemTime(started_at + 150 * 60 * 1000)
    projectRunController.request_pause()
    expect(projectRunController.get_state()?.elapsed_ms).toBe(2 * HOUR)
  })

  it('rolls bounded project context forward across repeated autonomous segments', async () => {
    durable_state.run
      .mockResolvedValueOnce(runtime_result({ reply: 'Segment one inspected the architecture.', step: 1 }))
      .mockResolvedValueOnce(runtime_result({ reply: 'Segment two implemented the runtime change.', step: 2 }))
      .mockResolvedValueOnce(runtime_result({ reply: 'Segment three verified the migration.', step: 3 }))

    const first = await runAgentSession(runtime_input())
    expect(first.contextCompaction).toContain('Segment one inspected the architecture.')

    await runAgentSession(runtime_input())
    const second_input = durable_state.run.mock.calls[1][0] as AgentSessionInput
    expect(String(second_input.conversation?.[0]?.content || '')).toContain('AUTONOMOUS PROJECT CONTEXT')
    expect(String(second_input.conversation?.[0]?.content || '')).toContain('Segment one inspected the architecture.')

    const third = await runAgentSession(runtime_input())
    const third_input = durable_state.run.mock.calls[2][0] as AgentSessionInput
    expect(String(third_input.conversation?.[0]?.content || '')).toContain('Segment two implemented the runtime change.')
    expect(third.contextCompaction).toContain('Segment three verified the migration.')
    expect(String(third.contextCompaction || '').length).toBeLessThanOrEqual(12000)
    expect(durable_state.save_compacted).toHaveBeenCalledTimes(3)
  })

  it('continues automatically through an unfinished acceptance gate before returning', async () => {
    durable_state.run
      .mockResolvedValueOnce(runtime_result({
        reply: 'Implementation finished, but verification is still open.',
        todo_status: 'in_progress',
        step: 1,
      }))
      .mockResolvedValueOnce(runtime_result({
        reply: 'Verification finished successfully.',
        todo_status: 'done',
        step: 2,
      }))

    const input = runtime_input()
    input.settings.agent_multi_enabled = true
    const notices: Array<Record<string, unknown>> = []
    input.onEvent = (event) => notices.push(event)

    const result = await runAgentSession(input)

    expect(durable_state.run).toHaveBeenCalledTimes(2)
    const recovery_input = durable_state.run.mock.calls[1][0] as AgentSessionInput
    expect(recovery_input.userInput).toContain('AUTONOMOUS ACCEPTANCE GATE')
    expect(recovery_input.userInput).toContain('Continue working without asking the user')
    expect(recovery_input.todos?.some((todo) => todo.id === 'autonomous-acceptance')).toBe(false)
    expect(notices.some((event) => String(event.summary || '').includes('remediation pass 1/2'))).toBe(true)
    expect(result.todos.every((todo) => todo.status === 'done')).toBe(true)
    expect(result.summary.acceptance).toMatchObject({ accepted: true, remediationPasses: 1 })
  })
})
