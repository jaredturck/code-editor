import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/keyStore', () => ({
  getKey: () => 'test-key',
  hasKeyFor: () => true,
  normalizeKeyId: (value: unknown) => String(value || '1'),
}))

vi.mock('@/platform/providers/providerRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/providers/providerRegistry')>()),
  findAIProvider: (provider: string) => ({
    id: provider,
    label: provider === 'local' ? 'Local' : 'Cloud',
    requiresApiKey: provider !== 'local',
  }),
}))

vi.mock('@/platform/agent/toolCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/agent/toolCatalog')>()),
  getToolPresentation: (tool: string) => ({ actionVerb: tool || 'Tool' }),
  getToolDefinitions: () => [],
}))

vi.mock('@/platform/security', () => ({
  stripTerminalControlCharacters: (value: string) => value,
}))

vi.mock('@/platform/agent/modelHealthMonitor', () => ({
  startModelHealthMonitor: vi.fn(),
}))

vi.mock('@/platform/agent/runtime/sessionRunner', () => ({
  runAgentSession: vi.fn(),
}))

vi.mock('@/platform/chatSessionStore', () => ({
  loadChatContext: vi.fn(async () => ({})),
  saveCompacted: vi.fn(async () => undefined),
}))

import { build_core_agent_settings, build_project_run_input } from '../src/chat/agentChat'
import { buildHybridExecutionPlan } from '../src/platform/agent/cloudUsagePolicy'
import { withAutonomousModelExecution } from '../src/platform/agentRuntime'

function hybrid_settings() {
  const cloud_id = 'orchestrator:openai:gpt-test:1'
  return {
    ai_provider: 'openai',
    ai_model: 'gpt-test',
    agent_execution_policy: 'hybrid',
    agent_model_routing: 'on',
    agent_failover_mode: 'limited',
    agent_primary_assignment_id: cloud_id,
    agent_models: [
      {
        id: cloud_id,
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-test',
        keyId: '1',
        primary: true,
        tags: [],
        disabledTags: [],
      },
      {
        id: 'scout:local:qwen3.5:9b:1',
        role: 'scout',
        provider: 'local',
        model: 'qwen3.5:9b',
        keyId: '1',
        primary: true,
        tags: ['local', 'fast'],
        disabledTags: [],
      },
    ],
    permissions_file_read: true,
    permissions_file_write: true,
    permissions_terminal: false,
    agent_permission_tier_orchestrator: 3,
    agent_multi_enabled: false,
    agent_peer_consult_enabled: false,
  }
}

describe('Batch 2 autonomous execution boundaries', () => {
  it('preserves configured model routing and execution policy without enabling the team runtime', () => {
    const settings = build_core_agent_settings(hybrid_settings() as never, '/workspace')
    expect(settings.agent_execution_policy).toBe('hybrid')
    expect(settings.agent_model_routing).toBe('on')
    expect(settings.agent_multi_enabled).toBe(false)
    expect(settings.agent_peer_consult_enabled).toBe(false)
  })

  it('injects an iterative untrusted-evidence web research contract into project runs', () => {
    const prompt = build_project_run_input('Research the current API and update the integration', 'automatic')
    expect(prompt).toContain('search.web')
    expect(prompt).toContain('web.fetch')
    expect(prompt).toContain('untrusted evidence')
    expect(prompt).toContain('preserve source titles/URLs')
  })

  it('keeps hybrid local work single-agent when multi-agent mode is disabled', () => {
    const plan = buildHybridExecutionPlan(hybrid_settings())
    expect(plan).not.toBeNull()
    expect(plan?.localWorker.model).toBe('qwen3.5:9b')
    expect(plan?.finalResponder.model).toBe('gpt-test')
    expect(plan?.workingSettings.agent_multi_enabled).toBe(false)
    expect(plan?.workingSettings.agent_peer_consult_enabled).toBe(false)
  })

  it('adds bounded cloud consultation only to a persisted hybrid local-plus-cloud session', () => {
    const prepared = withAutonomousModelExecution({
      userInput: 'Implement the task',
      conversation: [],
      settings: {
        ...hybrid_settings(),
        chat_session: { id: 'chat-1' },
        agent_working_dir: '/workspace',
        agent_tool_allowlist: ['files.read', 'rag.retrieve'],
      },
    })
    expect(prepared.settings.agent_tool_allowlist).toContain('cloud.consult')
    expect(prepared.userInput).toContain('minimum relevant evidence')
    expect(prepared.userInput).toContain('shared cloud request budget')

    const cloud_only = withAutonomousModelExecution({
      userInput: 'Implement the task',
      conversation: [],
      settings: {
        ...hybrid_settings(),
        agent_models: hybrid_settings().agent_models.filter((entry) => entry.provider !== 'local'),
        chat_session: { id: 'chat-2' },
        agent_working_dir: '/workspace',
        agent_tool_allowlist: ['files.read'],
      },
    })
    expect(cloud_only.settings.agent_tool_allowlist).not.toContain('cloud.consult')
  })
})
