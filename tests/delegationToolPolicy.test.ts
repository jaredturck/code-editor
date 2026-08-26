import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ posted: null as Record<string, unknown> | null }))

vi.mock('@/platform/skillProfiles', () => ({
  buildSkillProfile: () => 'default-model',
}))

vi.mock('@/platform/agent/agentIdentity', () => ({
  normalizeAgentRole: (value: unknown) => String(value || 'executor').split('#')[0],
  resolveAgentRoleSettings: (role: string, settings: Record<string, unknown>) => ({
    identity: {
      role,
      provider: 'openai',
      model: `${role}-model`,
      keyId: '1',
      explicitlyAssigned: true,
    },
    settings: {
      ...settings,
      ai_provider: 'openai',
      ai_model: `${role}-model`,
    },
  }),
  applyAgentIdentityToSettings: (settings: Record<string, unknown>, identity: Record<string, unknown>) => ({
    ...settings,
    ai_provider: identity.provider,
    ai_model: identity.model,
  }),
  resolveCurrentAgentRole: () => 'orchestrator',
}))

vi.mock('@/platform/agent/modelTags', () => ({
  buildAgentRoster: () => [],
}))

vi.mock('@/platform/agent/modelHealth', () => ({
  recordModelFailure: vi.fn(),
  isModelHealthy: () => true,
  isModelCredentialReady: () => true,
}))

vi.mock('@/platform/keyStore', () => ({
  getKey: () => 'test-key',
}))

vi.mock('@/platform/settingsStorage', () => ({
  subscribeSettingsChanged: () => () => undefined,
}))

vi.mock('@/platform/subAgentRuntime', () => ({
  postTask: vi.fn((stp: Record<string, unknown>) => {
    state.posted = stp
    return String(stp.taskId)
  }),
  postTaskBatch: vi.fn(),
  waitForTask: vi.fn(),
  waitForAllTasks: vi.fn(),
  pollTaskResult: vi.fn(() => null),
  getTaskStatus: vi.fn(() => 'unknown'),
  getAgentRoster: vi.fn(() => []),
  isAgentAvailable: vi.fn(() => true),
  broadcastToAgents: vi.fn(),
  startSubAgentLoop: vi.fn(() => ({ stop: vi.fn() })),
  resolveAgentId: vi.fn(() => 'openai'),
  subscribeSubAgentEvents: vi.fn(() => () => undefined),
  TASK_STATUS: {
    DONE: 'done',
    FAILED: 'failed',
    TIMEOUT: 'timeout',
    PARTIAL: 'partial',
  },
}))

import { handleAgentDelegate } from '../src/platform/orchestrationClient'

const settings = {
  agent_multi_enabled: true,
  permissions_file_read: true,
  permissions_file_write: true,
  permissions_terminal: true,
}

beforeEach(() => {
  state.posted = null
})

describe('delegated STP tool policy', () => {
  it('uses role/tier automatic tools when the Orchestrator omits the tools argument', async () => {
    await handleAgentDelegate(
      {
        toAgent: 'executor',
        type: 'execute',
        instructions: 'Implement the isolated module change.',
      } as never,
      settings as never,
    )

    expect(state.posted).not.toBeNull()
    expect((state.posted?.tools as Record<string, unknown>).mode).toBe('auto')
  })

  it('preserves an explicit empty tools list as a tool-free assignment', async () => {
    await handleAgentDelegate(
      {
        toAgent: 'executor',
        type: 'verify',
        instructions: 'Reason about the supplied evidence without tools.',
        tools: [],
      } as never,
      settings as never,
    )

    const tools = state.posted?.tools as Record<string, unknown>
    expect(tools.mode).toBe('explicit')
    expect(tools.available).toEqual([])
  })
})
