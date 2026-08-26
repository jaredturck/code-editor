/**
 * Exercises the observable sub agent runtime contract, with regression cases for “registers
 * an agent when a task is posted” and “posts task batches and preserves task ids”. The
 * suite documents caller-visible behavior so implementation refactors cannot silently
 * weaken those guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSTP } from '@/platform/stpBuilder'
import type { STPBuildInput, STPTask } from '@/platform/stpBuilder'
import type { SubAgentSettings } from '@/platform/agent/subAgentTypes'
import {
  AGENT_STATUS,
  TASK_STATUS,
  broadcastToAgents,
  executeSTP,
  getAgentRoster,
  getTaskStatus,
  isAgentAvailable,
  pollTaskResult,
  postTask,
  postTaskBatch,
  resolveAgentId,
  startSubAgentLoop,
  waitForAllTasks,
  waitForTask,
} from '@/platform/subAgentRuntime'
import { jsonResponse } from '../helpers/http'
import { setKey } from '@/platform/keyStore'

// Opens AI response through the interaction path owned by the surrounding test scenario.
function openAIResponse(content: string, usage: Record<string, number> = {}) {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage,
  })
}

// Creates task for the surrounding test scenario.
function makeTask(overrides: STPBuildInput = {}): STPTask {
  return buildSTP({
    goal: 'Complete the test task',
    toAgent: `agent-${crypto.randomUUID()}`,
    outputSchema: { answer: '' },
    budget: { maxSteps: 3, timeoutMs: 5000 },
    ...overrides,
  })
}

const aiSettings: SubAgentSettings = {
  ai_provider: 'openai',
  ai_api_key: 'fake-key',
  ai_model: 'fake-model',
}

beforeEach(() => {
  setKey('openai', 'fake-key')
})

describe('subAgentRuntime', () => {
  it.each([
    [{ ai_provider: 'anthropic', ai_model: 'other' }, 'claude'],
    [{ ai_provider: 'openai', ai_model: 'claude-4' }, 'claude'],
    [{ ai_provider: 'opencode', ai_model: 'model' }, 'deepseek'],
    [{ ai_provider: 'openrouter', ai_model: 'deepseek-r1' }, 'deepseek'],
    [{ ai_provider: 'local', ai_model: 'llama3' }, 'local'],
    [{ ai_provider: 'openai', ai_model: 'gpt-4o' }, 'openai'],
    [{ ai_provider: 'gemini', ai_model: 'gemini-2' }, 'gemini'],
    [{ ai_provider: 'other', ai_model: 'other' }, 'unknown'],
  ])('resolves agent identity for %o', (settings, expected) => {
    expect(resolveAgentId(settings)).toBe(expected)
  })

  it('registers an agent when a task is posted', () => {
    const task = makeTask()
    expect(postTask(task)).toBe(task.taskId)
    expect(getTaskStatus(task.taskId)).toBe(TASK_STATUS.PENDING)
    expect(isAgentAvailable(task.toAgent)).toBe(true)
    expect(getAgentRoster()).toContainEqual(
      expect.objectContaining({
        id: task.toAgent,
        status: AGENT_STATUS.IDLE,
        queueDepth: 1,
      }),
    )
  })

  it('posts task batches and preserves task ids', () => {
    const tasks = [makeTask(), makeTask()]
    expect(postTaskBatch(tasks)).toEqual(tasks.map((task) => task.taskId))
  })

  it('reports unknown tasks and empty results', () => {
    expect(getTaskStatus('missing-task')).toBe('unknown')
    expect(pollTaskResult('missing-task')).toBeNull()
  })

  it('broadcasts context updates into queued tasks', () => {
    const task = makeTask({ context: { existing: true } })
    postTask(task)
    broadcastToAgents('new context', { root: '/project' })
    expect(task.context).toEqual({
      existing: true,
      root: '/project',
      broadcast: 'new context',
    })
  })

  it('times out while waiting for a missing task', async () => {
    vi.useFakeTimers()
    const pending = waitForTask('never-completes', 1000)
    const rejection = expect(pending).rejects.toThrow('timed out after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
  })

  it('waits for all task ids using the same timeout behavior', async () => {
    vi.useFakeTimers()
    const pending = waitForAllTasks(['missing-a', 'missing-b'], 500)
    const rejection = expect(pending).rejects.toThrow('timed out after 500ms')
    await vi.advanceTimersByTimeAsync(500)
    await rejection
  })

  it('executes a final JSON response without tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        openAIResponse('{"answer":"done"}', {
          prompt_tokens: 4,
          completion_tokens: 2,
        }),
      ),
    )
    const task = makeTask()
    const result = await executeSTP(task, aiSettings)
    expect(result).toMatchObject({
      taskId: task.taskId,
      agentId: task.toAgent,
      status: TASK_STATUS.DONE,
      result: { answer: 'done' },
      toolsUsed: [],
      stepsUsed: 1,
    })
  })

  it('extracts JSON from fenced model output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAIResponse('```json\n{"answer":"fenced"}\n```')))
    const result = await executeSTP(makeTask(), aiSettings)
    expect(result.result).toEqual({ answer: 'fenced' })
  })

  it('asks again after prose and accepts a later JSON response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAIResponse('I should return JSON.'))
      .mockResolvedValueOnce(openAIResponse('{"answer":"retry"}'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await executeSTP(makeTask(), aiSettings)
    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'retry' },
      stepsUsed: 2,
    })
  })

  it('executes an allowed tool call and feeds the result back to the model', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/local/fs/read') {
        return Promise.resolve(jsonResponse({ content: 'fixture content' }))
      }
      const modelCallIndex = fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).includes('api.openai.com'),
      ).length
      return Promise.resolve(
        modelCallIndex === 1
          ? openAIResponse('{"tool":"files.read","args":{"path":"README.md"}}')
          : openAIResponse('{"answer":"read complete"}'),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const task = makeTask({ tools: { available: ['files.read'] } })
    const result = await executeSTP(task, aiSettings)
    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'read complete' },
      toolsUsed: ['files.read'],
      stepsUsed: 2,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/local/fs/read', expect.any(Object))
  })

  it('treats an explicit empty tool whitelist as no tools', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAIResponse('{"tool":"files.read","args":{"path":"README.md"}}'))
      .mockResolvedValueOnce(openAIResponse('{"answer":"continued without tools"}'))
    vi.stubGlobal('fetch', fetchMock)

    const task = makeTask({ tools: { available: [] } })
    const result = await executeSTP(task, aiSettings)
    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'continued without tools' },
      toolsUsed: [],
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/local/fs/read')).toBe(false)
  })

  it('rejects forbidden tools and allows the model to recover', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAIResponse('{"tool":"files.write","args":{"path":"a.txt","content":"x"}}'))
      .mockResolvedValueOnce(openAIResponse('{"answer":"recovered"}'))
    vi.stubGlobal('fetch', fetchMock)

    const task = makeTask({
      tools: { available: ['files.write'], forbidden: ['files.write'] },
    })
    const result = await executeSTP(task, aiSettings)
    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'recovered' },
      toolsUsed: [],
    })
  })

  it('returns partial when final output misses schema fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAIResponse('{"other":"value"}')))
    const result = await executeSTP(makeTask(), aiSettings)
    expect(result.status).toBe(TASK_STATUS.PARTIAL)
    expect(result.satisfactionHint).toContain('missing output fields: answer')
  })

  it('stops repeated local output without relying on a fixed step ceiling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAIResponse('not json')))
    const result = await executeSTP(makeTask({ budget: { maxSteps: 1, timeoutMs: 5000 } }), aiSettings)
    expect(result).toMatchObject({ status: TASK_STATUS.PARTIAL, result: null })
    expect(result.stepsUsed).toBeGreaterThan(1)
    expect(result.stepsUsed).toBeLessThan(10)
    expect(result.satisfactionHint).toContain('repeating the same response')
  })

  it('returns failed when the model request fails and bridge fallback also fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await executeSTP(makeTask(), aiSettings)
    expect(result.status).toBe(TASK_STATUS.FAILED)
    expect(result.satisfactionHint).toContain('proxy fallback failed')
  })

  it('executes explicit steps before requesting final output', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/local/fs/read') return Promise.resolve(jsonResponse({ content: 'read result' }))
      return Promise.resolve(openAIResponse('{"answer":"summarized"}'))
    })
    vi.stubGlobal('fetch', fetchMock)

    const task = makeTask({
      tools: { available: ['files.read'] },
      steps: [{ action: 'files.read', args: { path: 'README.md' } }],
    })
    const result = await executeSTP(task, aiSettings)
    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'summarized' },
      toolsUsed: ['files.read'],
      stepsUsed: 2,
    })
  })

  it('runs queued tasks through the background loop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAIResponse('{"answer":"loop done"}')))
    const task = makeTask()
    postTask(task)
    const loop = startSubAgentLoop(task.toAgent, aiSettings)

    const result = await waitForTask(task.taskId, 3000)
    loop.stop()

    expect(result).toMatchObject({
      status: TASK_STATUS.DONE,
      result: { answer: 'loop done' },
    })
    expect(pollTaskResult(task.taskId)).toEqual(result)
  })

  it('exports stable status constants', () => {
    expect(TASK_STATUS.TIMEOUT).toBe('timeout')
    expect(AGENT_STATUS.SUSPENDED).toBe('suspended')
  })
})
