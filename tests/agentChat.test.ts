import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrbSettings } from '../src/platform/settingsStorage'

const key_state = vi.hoisted(() => ({
  keys: new Map<string, string>(),
}))

vi.mock('@/platform/keyStore', () => ({
  getKey: (provider: string, key_id = '1') => key_state.keys.get(`${provider}:${key_id}`) || '',
  hasKeyFor: (provider: string, key_id = '1') => key_state.keys.has(`${provider}:${key_id}`),
  normalizeKeyId: (value: unknown) => String(value || '1'),
}))

vi.mock('@/platform/providers/providerRegistry', () => ({
  findAIProvider: (provider: string) => {
    if (provider === 'openai') {
      return { id: 'openai', label: 'OpenAI', requiresApiKey: true }
    }
    if (provider === 'local') {
      return { id: 'local', label: 'Local', requiresApiKey: false }
    }
    return null
  },
}))

vi.mock('@/platform/agent/toolCatalog', () => ({
  getToolPresentation: (tool: string) => ({ actionVerb: tool ? `Run ${tool}` : 'Tool' }),
}))

vi.mock('@/platform/security', () => ({
  stripTerminalControlCharacters: (value: string) => value,
}))

import {
  build_core_agent_settings,
  build_project_run_input,
  build_project_run_seed_todos,
  get_core_agent_tool_allowlist,
  resolve_agent_chat_descriptor,
  normalize_persisted_attachment,
  sanitize_agent_timeline,
  should_block_core_agent_permission_grant,
} from '../src/chat/agentChat'

function agent_settings(): OrbSettings {
  return {
    ai_provider: 'openai',
    ai_model: 'legacy-model',
    agent_models: [
      {
        id: 'orchestrator:openai:gpt-test:2',
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-test',
        keyId: '2',
        primary: true,
        tags: [],
        disabledTags: [],
      },
    ],
    permissions_file_read: true,
    permissions_file_write: true,
    permissions_terminal: true,
    agent_multi_enabled: true,
    agent_model_routing: 'auto',
    agent_permission_tier_orchestrator: 3,
  } as unknown as OrbSettings
}

describe('core agent chat integration', () => {
  beforeEach(() => {
    key_state.keys.clear()
  })

  it('requires an explicitly configured Orchestrator credential before starting a cloud run', () => {
    const missing = resolve_agent_chat_descriptor(agent_settings())
    expect(missing.ready).toBe(false)
    expect(missing.status).toBe('missing-key')

    key_state.keys.set('openai:2', 'secret-key')
    const ready = resolve_agent_chat_descriptor(agent_settings())
    expect(ready.ready).toBe(true)
    expect(ready.provider).toBe('openai')
    expect(ready.model).toBe('gpt-test')
    expect(ready.key_id).toBe('2')
  })

  it('binds configured workspace and terminal authority without enabling multi-agent execution', () => {
    key_state.keys.set('openai:2', 'secret-key')
    const settings = build_core_agent_settings(agent_settings(), '/workspace')

    expect(settings.ai_provider).toBe('openai')
    expect(settings.ai_model).toBe('gpt-test')
    expect(settings.ai_runtime_api_key).toBe('secret-key')
    expect(settings.agent_working_dir).toBe('/workspace')
    expect(settings.agent_multi_enabled).toBe(false)
    expect(settings.agent_permission_tier_orchestrator).toBe(3)
    expect(settings.permissions_file_read).toBe(true)
    expect(settings.permissions_file_write).toBe(true)
    expect(settings.permissions_terminal).toBe(true)
    expect(settings.agent_tool_allowlist).toContain('search.web')
    expect(settings.agent_tool_allowlist).toContain('todo.update')
    expect(settings.agent_tool_allowlist).toContain('files.read')
    expect(settings.agent_tool_allowlist).toContain('files.write')
    expect(settings.agent_tool_allowlist).toContain('rag.retrieve')
    expect(settings.agent_tool_allowlist).toContain('terminal.exec')
    expect(settings.agent_tool_allowlist).not.toContain('agent.delegate')
    expect(settings.agent_tool_allowlist).not.toContain('system.processes')
  })

  it('supports plan-first runs without widening the core Chat capability boundary', () => {
    key_state.keys.set('openai:2', 'secret-key')
    const settings = build_core_agent_settings(agent_settings(), '/workspace', 'plan_first')
    const todos = build_project_run_seed_todos('Implement durable project runs', 'plan_first')
    const input = build_project_run_input('Implement durable project runs', 'plan_first')

    expect(settings.agent_project_run_mode).toBe('plan_first')
    expect(settings.agent_tool_allowlist).toContain('user.ask')
    expect(settings.agent_tool_allowlist).toContain('files.write')
    expect(settings.agent_tool_allowlist).toContain('rag.retrieve')
    expect(settings.agent_tool_allowlist).toContain('terminal.exec')
    expect(todos).toHaveLength(1)
    expect(todos[0].status).toBe('in_progress')
    expect(input).toContain('PLAN FIRST')
    expect(input).toContain('ask for approval')
  })

  it('builds a resume instruction that preserves the original project goal', () => {
    const input = build_project_run_input('Finish the migration', 'automatic', true)
    expect(input).toContain('Finish the migration')
    expect(input).toContain('persisted TODO state')
    expect(input).toContain('Do not redo completed tasks')
  })

  it('enables workspace search and RAG while keeping host-inspection tools out of Agent Chat', () => {
    const tools = get_core_agent_tool_allowlist('/workspace')
    expect(tools).toContain('search.web')
    expect(tools).toContain('chat.recall')
    expect(tools).toContain('files.read')
    expect(tools).toContain('files.edit')
    expect(tools).toContain('files.patch')
    expect(tools).toContain('search.ripgrep')
    expect(tools).toContain('search.find')
    expect(tools).toContain('search.fd')
    expect(tools).toContain('rag.retrieve')
    expect(tools).not.toContain('memory.query')
    expect(tools).not.toContain('system.stats')
    expect(tools).not.toContain('artifact.create')
  })

  it('keeps workspace RAG unavailable when no workspace is open', () => {
    const tools = get_core_agent_tool_allowlist(null)
    expect(tools).not.toContain('rag.retrieve')
    expect(tools).not.toContain('files.read')
    expect(tools).not.toContain('search.ripgrep')
  })

  it('refuses persistent machine-permission grants from the core Chat runtime', () => {
    expect(should_block_core_agent_permission_grant('permission', ['file_read'])).toBe(true)
    expect(should_block_core_agent_permission_grant('permission', ['terminal_exec'])).toBe(true)
    expect(should_block_core_agent_permission_grant('limit', [])).toBe(false)
    expect(should_block_core_agent_permission_grant('question', [])).toBe(false)
  })

  it('restores legacy image attachment shapes using their MIME type', () => {
    const attachment = normalize_persisted_attachment({
      id: 'image-1',
      name: 'diagram.png',
      type: 'image',
      mime_type: 'image/png',
      content: 'aW1hZ2U=',
    })

    expect(attachment?.type).toBe('image')
    expect(attachment?.mime_type).toBe('image/png')
    expect(attachment?.preview).toBe('data:image/png;base64,aW1hZ2U=')
  })

  it('removes raw reasoning streams while retaining bounded observable activity', () => {
    const timeline = sanitize_agent_timeline([
      { type: 'thinking', text: 'hidden reasoning' },
      { type: 'thinking_stream', delta: 'hidden token' },
      { type: 'tool_call', tool: 'search.web', argsPreview: 'typescript docs' },
      { type: 'tool_result', tool: 'search.web', status: 'ok', outputPreview: 'raw search result' },
      { type: 'phase', name: 'final' },
    ])

    expect(timeline).toHaveLength(3)
    expect(timeline.some((event) => event.type === 'thinking')).toBe(false)
    expect(timeline.some((event) => event.detail.includes('hidden'))).toBe(false)
    expect(timeline[0].tool).toBe('search.web')
  })
})
