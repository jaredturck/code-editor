import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/agent/agentIdentity', () => ({
  resolveAgentIdentity: () => ({
    role: 'orchestrator',
    provider: 'openai',
    model: 'gpt-test',
    keyId: '1',
    explicitlyAssigned: true,
  }),
  resolveAgentRoleSettings: (_role: string, settings: Record<string, unknown>) => ({
    identity: {
      role: 'orchestrator',
      provider: 'openai',
      model: 'gpt-test',
      keyId: '1',
      explicitlyAssigned: true,
    },
    settings,
  }),
}))

vi.mock('@/platform/keyStore', () => ({
  hasKeyFor: () => true,
}))

vi.mock('@/platform/providers/providerRegistry', () => ({
  findAIProvider: () => ({ id: 'openai', label: 'OpenAI', requiresApiKey: true }),
}))

vi.mock('@/platform/agent/toolCatalog', () => ({
  getToolPresentation: (tool: string) => ({ actionVerb: tool }),
}))

vi.mock('@/platform/security', () => ({
  stripTerminalControlCharacters: (value: string) => value,
}))

import {
  build_core_agent_settings,
  build_project_run_input,
  get_core_agent_tool_allowlist,
} from '../src/chat/agentChat'

function configured_settings() {
  return {
    ai_provider: 'openai',
    ai_model: 'gpt-test',
    agent_multi_enabled: true,
    agent_peer_consult_enabled: true,
    agent_peer_review: 'closing',
    agent_overwatch_continuous: true,
    agent_execution_policy: 'hybrid',
    agent_model_routing: 'on',
    agent_required_local_model: 'qwen-local-a',
    agent_models: [
      {
        id: 'orchestrator:openai:gpt-test:1',
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-test',
        primary: true,
      },
      {
        id: 'executor:local:qwen-local-a:1',
        role: 'executor',
        provider: 'local',
        model: 'qwen-local-a',
        primary: true,
      },
      { id: 'scout:local:qwen-local-b:1', role: 'scout', provider: 'local', model: 'qwen-local-b', primary: true },
      {
        id: 'scout:anthropic:claude-test:1',
        role: 'scout',
        provider: 'anthropic',
        model: 'claude-test',
        primary: false,
      },
    ],
    agent_permission_tier_orchestrator: 3,
    permissions_file_read: true,
    permissions_file_write: true,
    permissions_terminal: true,
  }
}

describe('multi-agent Agent Chat integration', () => {
  it('exposes delegation, recall and review tools only for configured workspace runs', () => {
    const tools = get_core_agent_tool_allowlist('/workspace', true, true)
    expect(tools).toContain('agent.available')
    expect(tools).toContain('agent.delegate')
    expect(tools).toContain('agent.recallAll')
    expect(tools).toContain('agent.review')
    expect(tools).toContain('agent.overwatch')

    expect(get_core_agent_tool_allowlist('/workspace', true, false)).not.toContain('agent.delegate')
    expect(get_core_agent_tool_allowlist(null, true, true)).not.toContain('agent.delegate')
  })

  it('preserves configured multi-agent behavior only while a workspace is open', () => {
    const workspace = build_core_agent_settings(configured_settings() as never, '/workspace')
    expect(workspace.agent_multi_enabled).toBe(true)
    expect(workspace.agent_peer_consult_enabled).toBe(true)
    expect(workspace.agent_peer_review).toBe('closing')
    expect(workspace.agent_overwatch_continuous).toBe(true)
    expect(workspace.agent_tool_allowlist).toContain('agent.delegate')
    expect(workspace.agent_tool_allowlist).toContain('terminal.exec')

    const no_workspace = build_core_agent_settings(configured_settings() as never, null)
    expect(no_workspace.agent_multi_enabled).toBe(false)
    expect(no_workspace.agent_peer_consult_enabled).toBe(false)
    expect(no_workspace.agent_peer_review).toBe('off')
    expect(no_workspace.agent_overwatch_continuous).toBe(false)
    expect(no_workspace.agent_tool_allowlist).not.toContain('agent.delegate')
  })

  it('keeps cloud peers but admits at most one local model to a parallel runtime roster', () => {
    const workspace = build_core_agent_settings(configured_settings() as never, '/workspace')
    const models = workspace.agent_models as Array<Record<string, unknown>>
    const local_models = models.filter((entry) => entry.provider === 'local')
    const cloud_models = models.filter((entry) => entry.provider !== 'local')

    expect(local_models).toHaveLength(1)
    expect(local_models[0].model).toBe('qwen-local-a')
    expect(cloud_models.map((entry) => entry.model)).toEqual(expect.arrayContaining(['gpt-test', 'claude-test']))
  })

  it('teaches long autonomous runs safe parallelism and reviewed completion', () => {
    const prompt = build_project_run_input('Refactor the project autonomously', 'automatic')
    expect(prompt).toContain('agent.available')
    expect(prompt).toContain('waitMs:0')
    expect(prompt).toContain('agent.recallAll')
    expect(prompt).toContain('Never assign overlapping write scopes')
    expect(prompt).toContain('file leases')
    expect(prompt).toContain('re-read the live file')
    expect(prompt).toContain('changed-file paths')
    expect(prompt).toContain('agent.review')
    expect(prompt).toContain('re-review')
  })
})
