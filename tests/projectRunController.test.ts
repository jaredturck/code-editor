import { beforeEach, describe, expect, it, vi } from 'vitest'

const session_storage = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
}))

vi.mock('../src/platform/chatSessionStore', () => ({
  getChatSessionState: (id: string) => session_storage.values.get(id) || null,
  saveChatSessionState: (id: string, patch: Record<string, unknown>) => {
    const current = session_storage.values.get(id) || {}
    session_storage.values.set(id, { ...current, ...patch })
  },
}))

import {
  is_resumable_project_run_status,
  normalize_project_run_todos,
  project_run_elapsed_ms,
  project_run_progress,
  projectRunController,
} from '../src/chat/projectRunController'

describe('project run controller', () => {
  beforeEach(() => {
    session_storage.values.clear()
    projectRunController.set_workspace_root(null)
    projectRunController.clear('chat-1')
    session_storage.values.clear()
  })

  it('persists lifecycle checkpoints and distinguishes pause from cancellation', () => {
    const segment = projectRunController.begin({
      id: 'run-1',
      chat_id: 'chat-1',
      goal: 'Build the feature',
      mode: 'automatic',
      provider: 'openai',
      model: 'gpt-test',
      todos: [],
    })

    expect(segment.signal.aborted).toBe(false)
    projectRunController.set_status('running', { last_activity: 'Working' })
    projectRunController.checkpoint({
      todos: [{ id: 1, text: 'Inspect code', status: 'in_progress' }],
      steps: 2,
    })
    expect(projectRunController.get_state()?.checkpoint_count).toBe(2)
    expect(projectRunController.get_state()?.todos[0]?.text).toBe('Inspect code')

    expect(projectRunController.request_pause()).toBe(true)
    expect(segment.signal.aborted).toBe(true)
    expect(projectRunController.get_state()?.status).toBe('paused')
    expect(is_resumable_project_run_status(projectRunController.get_state()!.status)).toBe(true)

    projectRunController.finish_segment()
    const resumed = projectRunController.resume('anthropic', 'claude-test')
    expect(resumed?.signal.aborted).toBe(false)
    expect(projectRunController.get_state()?.status).toBe('running')
    expect(projectRunController.get_state()?.provider).toBe('anthropic')
    expect(projectRunController.get_state()?.model).toBe('claude-test')

    projectRunController.request_cancel()
    expect(resumed?.signal.aborted).toBe(true)
    expect(projectRunController.get_state()?.status).toBe('cancelled')
  })

  it('pauses an active run when the open workspace changes', () => {
    projectRunController.set_workspace_root('/workspace-a')
    const segment = projectRunController.begin({
      id: 'run-1',
      chat_id: 'chat-1',
      goal: 'Change workspace safely',
      mode: 'automatic',
      provider: 'openai',
      model: 'gpt-test',
      todos: [],
    })
    projectRunController.set_status('running')

    projectRunController.set_workspace_root('/workspace-b')

    expect(segment.signal.aborted).toBe(true)
    expect(projectRunController.get_state()).toMatchObject({
      status: 'paused',
      workspace_root: '/workspace-a',
    })
    expect(projectRunController.get_state()?.error).toContain('Workspace changed')

    projectRunController.finish_segment()
    expect(projectRunController.resume('openai', 'gpt-test')).toBeNull()
    expect(projectRunController.get_state()?.error).toContain('Open the workspace')

    projectRunController.set_workspace_root('/workspace-a')
    const resumed = projectRunController.resume('openai', 'gpt-test')
    expect(resumed?.signal.aborted).toBe(false)
    expect(projectRunController.get_state()?.status).toBe('running')
    projectRunController.request_cancel()
  })

  it('persists bounded structured runtime summary for autonomous resume', () => {
    projectRunController.begin({
      id: 'run-1',
      chat_id: 'chat-1',
      goal: 'Build the feature',
      mode: 'automatic',
      provider: 'openai',
      model: 'gpt-test',
      todos: [],
    })

    projectRunController.set_status('paused', {
      summary: {
        usage: { totalTokens: 42 },
        verificationState: {
          version: 1,
          contractKey: 'contract-1',
          required: true,
          mutationEpoch: 3,
          nextCandidate: 5,
          requirements: ['tests'],
          candidates: {},
          evidence: {},
        },
        taskPreflightPlan: {
          taskType: 'implementation',
          developmentTask: true,
          verificationRequired: true,
        },
        verification: { required: true, passed: false },
        arbitraryLargeResult: { secret: 'drop-me' },
      },
    })

    const state = projectRunController.get_state()!
    expect(state.summary).toBe('')
    expect(state.usage?.totalTokens).toBe(42)
    expect(state.runtime_summary).toEqual({
      verificationState: {
        version: 1,
        contractKey: 'contract-1',
        required: true,
        mutationEpoch: 3,
        nextCandidate: 5,
        requirements: ['tests'],
        candidates: {},
        evidence: {},
      },
      taskPreflightPlan: {
        taskType: 'implementation',
        developmentTask: true,
        verificationRequired: true,
      },
      verification: { required: true, passed: false },
    })

    const stored = session_storage.values.get('chat-1')?.projectRun as Record<string, unknown>
    expect(stored.runtime_summary).toEqual(state.runtime_summary)
    expect(stored).not.toHaveProperty('arbitraryLargeResult')

    projectRunController.finish_segment()
    projectRunController.restore('chat-1')
    expect(projectRunController.get_state()?.runtime_summary).toEqual(state.runtime_summary)
  })

  it('turns a persisted active run into an interrupted resumable run on restore', () => {
    session_storage.values.set('chat-1', {
      projectRun: {
        id: 'run-1',
        chat_id: 'chat-1',
        goal: 'Long task',
        mode: 'plan_first',
        status: 'running',
        provider: 'openai',
        model: 'gpt-test',
        started_at: 1000,
        updated_at: 7000,
        checkpoint_at: 7000,
        checkpoint_count: 3,
        elapsed_ms: 2000,
        segment_started_at: 4000,
        todos: [{ id: 1, text: 'Continue work', status: 'pending' }],
        steps: 4,
        summary: 'Checkpoint summary',
        last_activity: 'Working',
        error: '',
      },
    })

    const restored = projectRunController.restore('chat-1')
    expect(restored?.status).toBe('interrupted')
    expect(restored?.elapsed_ms).toBe(5000)
    expect(restored?.segment_started_at).toBe(0)
    expect(restored?.error).toContain('interrupted')
  })

  it('bounds persisted run fields and normalizes TODO state without retaining arbitrary fields', () => {
    const todos = normalize_project_run_todos([
      { id: 7, text: 'Done task', status: 'done', secret: 'drop-me' },
      { id: 8, text: 'Blocked task', status: 'blocked', dependsOn: [7] },
      { id: 9, text: 'Working task', status: 'IN_PROGRESS' },
      { id: 'x'.repeat(300), text: 'y'.repeat(1500), status: 'pending', dependsOn: Array(50).fill('z'.repeat(300)) },
    ])

    expect(todos).toEqual([
      { id: '7', text: 'Done task', status: 'done', dependsOn: [] },
      { id: '8', text: 'Blocked task', status: 'blocked', dependsOn: ['7'] },
      { id: '9', text: 'Working task', status: 'in_progress', dependsOn: [] },
      {
        id: 'x'.repeat(200),
        text: 'y'.repeat(1000),
        status: 'pending',
        dependsOn: Array(30).fill('z'.repeat(200)),
      },
    ])
    expect(project_run_progress(todos)).toEqual({ total: 4, done: 1, blocked: 1, active: 1 })
    expect(project_run_elapsed_ms(null)).toBe(0)
  })
})
