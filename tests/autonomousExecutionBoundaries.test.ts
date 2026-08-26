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
import { withAutomaticApprovalPolicy, withAutonomousModelExecution } from '../src/platform/agentRuntime'

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
    permissions_screen_capture: false,
    permissions_mouse_control: false,
    agent_permission_tier_orchestrator: 3,
    agent_multi_enabled: false,
    agent_peer_consult_enabled: false,
  }
}

describe('autonomous execution boundaries', () => {
  it('preserves configured model routing and execution policy without enabling the team runtime', () => {
    const settings = build_core_agent_settings(hybrid_settings() as never, '/workspace')
    expect(settings.agent_execution_policy).toBe('hybrid')
    expect(settings.agent_model_routing).toBe('on')
    expect(settings.agent_multi_enabled).toBe(false)
    expect(settings.agent_peer_consult_enabled).toBe(false)
  })

  it('grants routine project authority in automatic mode without granting screen control', () => {
    const settings = build_core_agent_settings(
      {
        ...hybrid_settings(),
        permissions_file_read: false,
        permissions_file_write: false,
        permissions_terminal: false,
        agent_permission_tier_orchestrator: 1,
        agent_permission_tier_executor: 1,
        agent_require_explicit_approval: true,
        agent_allow_network_commands: false,
        agent_web_site_guard: true,
        search_web_require_paid_fallback_confirmation: true,
        agent_search_web_budget: 1,
      } as never,
      '/workspace',
      'automatic',
    )

    expect(settings.permissions_file_read).toBe(true)
    expect(settings.permissions_file_write).toBe(true)
    expect(settings.permissions_terminal).toBe(true)
    expect(settings.agent_permission_tier_orchestrator).toBe(3)
    expect(settings.agent_permission_tier_executor).toBe(3)
    expect(settings.agent_allow_network_commands).toBe(true)
    expect(settings.agent_require_explicit_approval).toBe(false)
    expect(settings.agent_web_site_guard).toBe(false)
    expect(settings.search_web_require_paid_fallback_confirmation).toBe(false)
    expect(settings.agent_search_web_budget).toBe(4)
    expect(settings.permissions_screen_capture).toBe(false)
    expect(settings.permissions_mouse_control).toBe(false)
    expect(settings.agent_tool_allowlist).toContain('search.web')
    expect(settings.agent_tool_allowlist).toContain('terminal.exec')
    expect(settings.agent_tool_allowlist).not.toContain('screen.capabilities')
  })

  it('keeps plan-first mode permission-driven', () => {
    const settings = build_core_agent_settings(
      {
        ...hybrid_settings(),
        permissions_file_read: false,
        permissions_file_write: false,
        permissions_terminal: false,
        agent_require_explicit_approval: false,
      } as never,
      '/workspace',
      'plan_first',
    )

    expect(settings.permissions_file_read).toBe(false)
    expect(settings.permissions_file_write).toBe(false)
    expect(settings.permissions_terminal).toBe(false)
    expect(settings.agent_require_explicit_approval).toBe(true)
  })

  it('injects autonomous web research and no-routine-approval guidance into project runs', () => {
    const prompt = build_project_run_input('Research the current API and update the integration', 'automatic')
    expect(prompt).toContain('search.web')
    expect(prompt).toContain('web.fetch')
    expect(prompt).toContain('untrusted evidence')
    expect(prompt).toContain('preserve source titles/URLs')
    expect(prompt).toContain('Do not ask the user to approve routine project-scoped development work')
    expect(prompt).toContain('Screen capture and mouse/desktop control are never implied')
  })

  it('auto-resolves limits and questions in automatic mode but forwards real approvals', async () => {
    const realApproval = vi.fn(async () => ({ approved: false, decision: 'deny' }))
    const prepared = withAutomaticApprovalPolicy({
      userInput: 'Implement the task',
      conversation: [],
      settings: { agent_project_run_mode: 'automatic' },
      onApprovalRequest: realApproval,
    } as never)

    await expect(
      prepared.onApprovalRequest?.({ requestType: 'limit', limitKind: 'tool_timeout' } as never),
    ).resolves.toMatchObject({ approved: true, decision: 'unlimited' })
    await expect(
      prepared.onApprovalRequest?.({
        requestType: 'question',
        requestedAction: 'continue the long-running task',
      } as never),
    ).resolves.toMatchObject({ answer: 'Continue' })
    await expect(
      prepared.onApprovalRequest?.({ requestType: 'question', planText: 'Do the work' } as never),
    ).resolves.toMatchObject({ approved: true, answer: 'Approve' })
    await expect(
      prepared.onApprovalRequest?.({ requestType: 'approval', reason: 'outside workspace' } as never),
    ).resolves.toMatchObject({ approved: false, decision: 'deny' })
    expect(realApproval).toHaveBeenCalledTimes(1)
  })

  it('does not replace plan-first approval handling', () => {
    const realApproval = vi.fn()
    const input = {
      userInput: 'Plan the task',
      conversation: [],
      settings: { agent_project_run_mode: 'plan_first' },
      onApprovalRequest: realApproval,
    }
    expect(withAutomaticApprovalPolicy(input as never)).toBe(input)
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
