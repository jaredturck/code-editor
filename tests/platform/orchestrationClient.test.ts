/**
 * Exercises the observable orchestration client contract, with regression cases for
 * “rejects absent, failed, timed-out, empty, and schema-mismatched results” and “accepts
 * valid results and warns when near the step budget”. The suite documents caller-visible
 * behavior so implementation refactors cannot silently weaken those guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { STPTask } from '@/platform/stpBuilder'
import type { SubAgentLoopHandle } from '@/platform/agent/subAgentTypes'

const runtime = vi.hoisted(() => ({
  postTask: vi.fn((stp: STPTask) => stp.taskId),
  postTaskBatch: vi.fn<(tasks: STPTask[]) => string[]>(),
  waitForTask: vi.fn<(taskId: string, timeoutMs?: number) => Promise<unknown>>(),
  waitForAllTasks: vi.fn<(taskIds: string[], timeoutMs?: number) => Promise<unknown[]>>(),
  pollTaskResult: vi.fn<(taskId: string) => unknown>(),
  getTaskStatus: vi.fn<(taskId: string) => string>(() => 'unknown'),
  getAgentRoster: vi.fn<() => Array<Record<string, unknown>>>(() => []),
  isAgentAvailable: vi.fn<(agentId: string) => boolean>(() => true),
  broadcastToAgents: vi.fn<(message: unknown, context?: Record<string, unknown>) => void>(),
  startSubAgentLoop: vi.fn<(agentId: string, settings: Record<string, unknown>) => SubAgentLoopHandle>(() => ({
    stop: vi.fn(),
  })),
  resolveAgentId: vi.fn<(settings: Record<string, unknown>) => string>(() => 'claude'),
  TASK_STATUS: {
    PENDING: 'pending',
    RUNNING: 'running',
    DONE: 'done',
    FAILED: 'failed',
    TIMEOUT: 'timeout',
    PARTIAL: 'partial',
  },
}))

vi.mock('@/platform/subAgentRuntime', () => runtime)

import {
  delegateParallel,
  detectOrchestrationMode,
  ensureSubAgentLoop,
  evaluateDelegationResult,
  handleAgentBroadcast,
  handleAgentDelegate,
  handleAgentRecall,
  handleAgentRoster,
  handleAgentStatus,
  handleAgentVerify,
  inspectStandbyRoster,
  pickDelegateMember,
  reassignFailedPart,
  resolveCurrentRole,
  resolveDelegateTarget,
  stopAllSubAgentLoops,
  stopSubAgentLoop,
  syncStandbyPool,
} from '@/platform/orchestrationClient'
import { resetModelHealth } from '@/platform/agent/modelHealth'
import { clearKey, setKey } from '@/platform/keyStore'

describe('orchestrationClient', () => {
  beforeEach(() => {
    stopAllSubAgentLoops()
    clearKey('openai')
    clearKey('anthropic')
    setKey('openai', 'test-openai-key')
    runtime.postTask.mockImplementation((stp) => stp.taskId)
    runtime.waitForTask.mockReset()
    runtime.waitForAllTasks.mockReset()
    runtime.pollTaskResult.mockReset()
    runtime.getTaskStatus.mockReset().mockReturnValue('unknown')
    runtime.getAgentRoster.mockReset().mockReturnValue([])
    runtime.isAgentAvailable.mockReset().mockReturnValue(true)
    runtime.broadcastToAgents.mockReset()
    runtime.startSubAgentLoop.mockReset().mockImplementation(() => ({ stop: vi.fn() }))
  })

  it('rejects absent, failed, timed-out, empty, and schema-mismatched results', () => {
    expect(evaluateDelegationResult({}, null)).toEqual({
      satisfied: false,
      reason: 'no_result',
    })
    expect(evaluateDelegationResult({}, { status: 'failed' })).toEqual({
      satisfied: false,
      reason: 'agent_failed',
    })
    expect(evaluateDelegationResult({}, { status: 'timeout' })).toEqual({
      satisfied: false,
      reason: 'timeout',
    })
    expect(evaluateDelegationResult({}, { status: 'done', result: {} })).toEqual({
      satisfied: false,
      reason: 'empty_result',
    })
    expect(
      evaluateDelegationResult({ output: { schema: { answer: '' } } }, { status: 'done', result: { other: true } }),
    ).toEqual({
      satisfied: false,
      reason: 'missing_fields: answer',
    })
  })

  it('accepts valid results regardless of reasoning turns used', () => {
    // The old "near step budget" warning was removed with the user-facing steps system — a valid
    // result is simply satisfied, no matter how many reasoning turns it took.
    expect(
      evaluateDelegationResult(
        { budget: { maxSteps: 10 } },
        {
          status: 'done',
          result: { answer: 'ok' },
          stepsUsed: 9,
        },
      ),
    ).toEqual({ satisfied: true, reason: 'ok' })

    expect(
      evaluateDelegationResult(
        {},
        {
          status: 'done',
          result: { answer: 'ok' },
          stepsUsed: 2,
        },
      ),
    ).toEqual({ satisfied: true, reason: 'ok' })
  })

  it('separates the target role from its assigned provider and model', () => {
    const target = resolveDelegateTarget('deepseek', {
      ai_provider: 'anthropic',
      ai_model: 'claude-sonnet',
      agent_models: [
        {
          role: 'executor',
          provider: 'openrouter',
          model: 'deepseek/deepseek-r1',
          keyId: '1',
          primary: true,
        },
      ],
    })

    expect(target).toMatchObject({
      agentId: 'executor',
      role: 'executor',
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1',
      identity: {
        role: 'executor',
        provider: 'openrouter',
        model: 'deepseek/deepseek-r1',
        explicitlyAssigned: true,
      },
      subSettings: {
        ai_provider: 'anthropic',
        ai_model: 'claude-sonnet',
      },
    })
  })

  it('builds and posts a normalized delegated task', async () => {
    const result = await handleAgentDelegate(
      {
        toAgent: 'executor',
        type: 'discover',
        instructions: 'Find configs',
        scope: 'src only',
        constraints: ['read only'],
        tools: ['files.find'],
        preferredTools: ['files.find'],
        forbiddenTools: ['files.write'],
        outputSchema: { files: [] },
        maxSteps: 4,
        timeoutMs: 12000,
        maxOutputChars: 1000,
        priority: 'high',
      },
      { ai_provider: 'openai' },
    )

    expect(result).toMatchObject({ toAgent: 'executor', status: 'posted' })
    expect(result.summary).toContain('[STP discover → executor]')
    expect(runtime.startSubAgentLoop).toHaveBeenCalledWith('executor', {
      ai_provider: 'openai',
    })
    expect(runtime.postTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'discover',
        priority: 'high',
        toAgent: 'executor',
        agentIdentity: expect.objectContaining({
          role: 'executor',
          provider: 'openai',
          model: '',
        }),
        objective: expect.objectContaining({
          goal: 'Find configs',
          scope: 'src only',
        }),
        tools: expect.objectContaining({
          available: ['files.find'],
          forbidden: ['files.write'],
        }),
        budget: expect.objectContaining({ maxSteps: 4, timeoutMs: 12000 }),
      }),
    )
  })

  it('can post without waiting for idle', async () => {
    await handleAgentDelegate(
      { instructions: 'Task', waitForIdle: false },
      { ai_provider: 'local', ai_model: 'test-local' },
    )
    expect(runtime.isAgentAvailable).not.toHaveBeenCalled()
  })

  it('recalls ready and pending task results', async () => {
    runtime.pollTaskResult.mockReturnValueOnce({
      status: 'done',
      result: { answer: 'ok' },
      toolsUsed: ['files.read'],
      stepsUsed: 2,
      tokensUsed: 20,
      satisfactionHint: 'good',
      durationMs: 10,
    })
    await expect(handleAgentRecall({ taskId: 'task-1' })).resolves.toEqual({
      taskId: 'task-1',
      status: 'done',
      result: { answer: 'ok' },
      toolsUsed: ['files.read'],
      stepsUsed: 2,
      tokensUsed: 20,
      satisfactionHint: 'good',
      durationMs: 10,
      ready: true,
    })

    runtime.pollTaskResult.mockReturnValueOnce(null)
    runtime.getTaskStatus.mockReturnValueOnce('pending')
    await expect(handleAgentRecall({ taskId: 'task-2' })).resolves.toMatchObject({
      taskId: 'task-2',
      status: 'pending',
      ready: false,
    })
  })

  it('waits for recall results and converts timeout errors', async () => {
    runtime.waitForTask.mockResolvedValueOnce({
      status: 'done',
      result: { answer: 'ok' },
    })
    await expect(handleAgentRecall({ taskId: 'task', waitMs: 1000 })).resolves.toMatchObject({
      status: 'done',
      result: { answer: 'ok' },
    })

    runtime.waitForTask.mockRejectedValueOnce(new Error('timed out'))
    await expect(handleAgentRecall({ taskId: 'task', waitMs: 1000 })).resolves.toMatchObject({
      status: 'timeout',
      result: null,
      satisfactionHint: 'timed out',
      durationMs: 1000,
    })
  })

  it('validates required task ids', async () => {
    await expect(handleAgentRecall({})).rejects.toThrow('taskId is required')
    expect(() => handleAgentStatus({})).toThrow('taskId is required')
    await expect(handleAgentVerify({})).rejects.toThrow('taskId is required')
  })

  it('returns status, roster, and broadcast results', () => {
    runtime.getTaskStatus.mockReturnValue('running')
    runtime.getAgentRoster.mockReturnValue([{ id: 'executor' }])
    expect(handleAgentStatus({ taskId: 'task' })).toEqual({
      taskId: 'task',
      status: 'running',
    })
    expect(handleAgentRoster()).toEqual({ agents: [{ id: 'executor' }] })
    expect(
      handleAgentBroadcast({
        message: ' update ',
        contextUpdate: { root: '/project' },
      }),
    ).toEqual({
      broadcasted: true,
      message: 'update',
    })
    expect(runtime.broadcastToAgents).toHaveBeenCalledWith('update', {
      root: '/project',
    })
  })

  it('verifies missing, passing, and failed task results', async () => {
    runtime.pollTaskResult.mockReturnValueOnce(null)
    await expect(handleAgentVerify({ taskId: 'missing' })).resolves.toMatchObject({
      verdict: 'not_ready',
    })

    runtime.pollTaskResult.mockReturnValueOnce({
      status: 'done',
      result: { answer: 'ok' },
      satisfactionHint: 'good',
    })
    await expect(handleAgentVerify({ taskId: 'pass', criteria: 'has answer' })).resolves.toMatchObject({
      verdict: 'pass',
      reason: 'ok',
      criteria: 'has answer',
      result: { answer: 'ok' },
    })

    runtime.pollTaskResult.mockReturnValueOnce({
      status: 'failed',
      result: null,
    })
    await expect(handleAgentVerify({ taskId: 'fail' })).resolves.toMatchObject({
      verdict: 'fail',
      reason: 'agent_failed',
    })
  })

  it('delegates tasks in parallel and waits for all results', async () => {
    runtime.waitForAllTasks.mockResolvedValue([{ taskId: 'one' }, { taskId: 'two' }])
    const results = await delegateParallel(
      [
        { instructions: 'One', toAgent: 'executor', waitForIdle: false },
        { instructions: 'Two', toAgent: 'scout', waitForIdle: false },
      ],
      { ai_provider: 'local', ai_model: 'test-local' },
      5000,
    )
    expect(results).toEqual([{ taskId: 'one' }, { taskId: 'two' }])
    expect(runtime.waitForAllTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(String), expect.any(String)]),
      5000,
    )
  })

  it('starts loops idempotently and stops one or all loops', () => {
    const firstHandle = { stop: vi.fn() }
    const secondHandle = { stop: vi.fn() }
    runtime.startSubAgentLoop.mockReturnValueOnce(firstHandle).mockReturnValueOnce(secondHandle)

    ensureSubAgentLoop('executor', { model: 'one' })
    ensureSubAgentLoop('executor', { model: 'two' })
    ensureSubAgentLoop('scout', { model: 'three' })
    expect(runtime.startSubAgentLoop).toHaveBeenCalledTimes(2)

    stopSubAgentLoop('executor')
    expect(firstHandle.stop).toHaveBeenCalledOnce()
    stopAllSubAgentLoops()
    expect(secondHandle.stop).toHaveBeenCalledOnce()
  })

  it('detects solo, dual, and full orchestration modes', async () => {
    const now = Date.now()
    runtime.getAgentRoster.mockReturnValueOnce([])
    const solo = await detectOrchestrationMode()
    expect(solo.mode).toBe('solo')
    expect([...solo.available, ...solo.offline].sort()).toEqual(['executor', 'orchestrator', 'scout'])
    expect(solo.available.filter((role) => role !== 'orchestrator')).toEqual([])

    runtime.getAgentRoster.mockReturnValueOnce([{ id: 'executor', lastSeen: now, status: 'idle' }])
    await expect(detectOrchestrationMode()).resolves.toMatchObject({
      mode: 'dual',
      available: ['executor', 'orchestrator'],
      offline: ['scout'],
    })

    runtime.getAgentRoster.mockReturnValueOnce([
      { id: 'executor', lastSeen: now, status: 'idle' },
      { id: 'scout', lastSeen: now, status: 'idle' },
    ])
    await expect(detectOrchestrationMode()).resolves.toMatchObject({
      mode: 'full',
      available: ['executor', 'scout', 'orchestrator'],
      offline: [],
    })
  })

  it('resolves explicit and inferred current roles', () => {
    expect(
      resolveCurrentRole({
        ai_provider: 'openai',
        ai_model: 'gpt-4o',
        agent_models: [
          {
            role: 'orchestrator',
            provider: 'openai',
            model: 'gpt-4o',
            keyId: '1',
            primary: true,
          },
        ],
      }),
    ).toBe('orchestrator')
    expect(resolveCurrentRole({ ai_provider: 'anthropic', ai_model: 'other' })).toBe('orchestrator')
    expect(resolveCurrentRole({ ai_provider: 'local', ai_model: 'llama3' })).toBe('scout')
    expect(resolveCurrentRole({ ai_provider: 'openai', ai_model: 'gpt-4o' })).toBe('executor')
  })
})

describe('standby pool (§2 — per-key, distributed)', () => {
  // Local members are connectable without a stored key, so the pool can be exercised without the
  // credential bridge. The multi-key guarantee (distinct members per key) is covered in modelMesh.
  const POOL_SETTINGS = {
    agent_multi_enabled: true,
    agent_standby_mode: 'eager',
    agent_models: [
      {
        role: 'orchestrator',
        provider: 'local',
        model: 'orc',
        keyId: '1',
        primary: true,
      },
      {
        role: 'executor',
        provider: 'local',
        model: 'exec-a',
        keyId: '1',
        primary: true,
      },
      { role: 'executor', provider: 'local', model: 'exec-b', keyId: '1' },
      {
        role: 'scout',
        provider: 'local',
        model: 'scout-a',
        keyId: '1',
        primary: true,
      },
    ],
  }

  beforeEach(() => {
    stopAllSubAgentLoops()
    runtime.startSubAgentLoop.mockReset().mockImplementation(() => ({ stop: vi.fn() }))
    runtime.isAgentAvailable.mockReset().mockReturnValue(true)
  })

  it('puts every connectable worker member on standby (eager), excluding the orchestrator answerer', () => {
    const pool = syncStandbyPool(POOL_SETTINGS as never)
    expect(pool.members.slice().sort()).toEqual(['executor', 'executor#2', 'scout'])
    expect(pool.roles.slice().sort()).toEqual(['executor', 'scout'])
    // One loop per worker member; the orchestrator primary (the answerer) is NOT looped.
    const started = runtime.startSubAgentLoop.mock.calls.map((c) => c[0]).sort()
    expect(started).toEqual(['executor', 'executor#2', 'scout'])
  })

  it('honors the team-role allowlist — excluded roles never load (and are not flagged as dropped)', () => {
    const pool = syncStandbyPool({
      agent_multi_enabled: true,
      agent_standby_mode: 'eager',
      // Keep extra orchestrators out of the team; only executors may load.
      agent_team_roles: ['executor'],
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'local',
          model: 'orc',
          keyId: '1',
          primary: true,
        },
        { role: 'orchestrator', provider: 'local', model: 'orc-2', keyId: '1' },
        {
          role: 'executor',
          provider: 'local',
          model: 'exec-a',
          keyId: '1',
          primary: true,
        },
        {
          role: 'scout',
          provider: 'local',
          model: 'scout-a',
          keyId: '1',
          primary: true,
        },
      ],
    } as never)
    expect(pool.connected.map((m) => m.role)).toEqual(['executor'])
    expect(pool.dropped).toHaveLength(0)
  })

  it('silently excludes a keyless cloud member at runtime while diagnostics retain the reason', () => {
    const settings = {
      agent_multi_enabled: true,
      agent_standby_mode: 'eager',
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'local',
          model: 'orc',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'local',
          model: 'exec-a',
          keyId: '1',
          primary: true,
        },
        { role: 'executor', provider: 'anthropic', model: 'opus', keyId: '1' },
      ],
    }
    const pool = syncStandbyPool(settings as never)
    expect(pool.connected.map((m) => m.model).sort()).toEqual(['exec-a'])
    expect(pool.dropped).toEqual([])

    const diagnostics = inspectStandbyRoster(settings as never)
    expect(diagnostics.dropped).toHaveLength(1)
    expect(diagnostics.dropped[0].member.model).toBe('opus')
    expect(diagnostics.dropped[0].reason).toMatch(/no api key saved for anthropic/i)
  })

  it('tears the pool down and starts nothing when multi-agent is off', () => {
    const pool = syncStandbyPool({ agent_multi_enabled: false } as never)
    expect(pool).toEqual({
      members: [],
      roles: [],
      connected: [],
      dropped: [],
    })
    expect(runtime.startSubAgentLoop).not.toHaveBeenCalled()
  })

  it('does not pre-start loops in lazy mode', () => {
    syncStandbyPool({ ...POOL_SETTINGS, agent_standby_mode: 'lazy' } as never)
    expect(runtime.startSubAgentLoop).not.toHaveBeenCalled()
  })

  it('spreads delegations across a role’s keyed members (round-robin)', () => {
    syncStandbyPool(POOL_SETTINGS as never)
    const first = pickDelegateMember('executor', POOL_SETTINGS as never).agentId
    const second = pickDelegateMember('executor', POOL_SETTINGS as never).agentId
    // Two consecutive delegations hit two DIFFERENT executor members (different keys), not Key 1 twice.
    expect([first, second].sort()).toEqual(['executor', 'executor#2'])
  })

  it('falls back to the role primary when no members are pooled', () => {
    const target = pickDelegateMember('executor', {
      ai_provider: 'local',
      ai_model: 'test-local',
    } as never)
    expect(target.agentId).toBe('executor')
  })

  it('targets a specific member id directly (a teamwork part owner)', () => {
    syncStandbyPool(POOL_SETTINGS as never)
    expect(pickDelegateMember('executor#2', POOL_SETTINGS as never).agentId).toBe('executor#2')
    expect(pickDelegateMember('executor#2', POOL_SETTINGS as never).agentId).toBe('executor#2')
  })

  it('reassigns a failed teammate part to another healthy same-role member (§F4)', () => {
    resetModelHealth()
    syncStandbyPool(POOL_SETTINGS as never)
    const reassign = reassignFailedPart('executor', POOL_SETTINGS as never)
    expect(reassign?.memberId).toBe('executor#2')
  })

  it('keeps delegation and teammate reassignment local during enforced local-only runs', () => {
    setKey('openai', 'test-cloud-key')
    const mixedSettings = {
      agent_multi_enabled: true,
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'local',
          model: 'local-orc',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'openai',
          model: 'cloud-exec',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'local',
          model: 'local-exec-a',
          keyId: '1',
        },
        {
          role: 'executor',
          provider: 'local',
          model: 'local-exec-b',
          keyId: '1',
        },
      ],
    }
    syncStandbyPool(mixedSettings as never)

    const localOnlySettings = {
      ...mixedSettings,
      agent_local_only_enforced: true,
      agent_models: mixedSettings.agent_models.filter((entry) => entry.provider === 'local'),
    }
    const picked = pickDelegateMember('executor', localOnlySettings as never)
    expect(picked.identity.provider).toBe('local')

    resetModelHealth()
    const reassigned = reassignFailedPart(picked.agentId, localOnlySettings as never)
    expect(reassigned?.memberId).toBeTruthy()
    expect(['local-exec-a', 'local-exec-b'].includes(String(reassigned?.model || ''))).toBe(true)
  })
})
