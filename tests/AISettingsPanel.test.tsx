import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrbSettings } from '../src/platform/settingsStorage'

const state = vi.hoisted(() => ({
  settings: {
    ai_provider: 'openai',
    ai_model: 'gpt-4o',
    ai_local_url: 'http://127.0.0.1:11434',
    agent_models: null,
    provider_key_validation: {},
    provider_selected_models: {},
    discovered_models: {},
    agent_execution_policy: 'hybrid',
    agent_model_routing: 'off',
    agent_stateful_loop: 'auto',
    agent_toolset: 'auto',
    native_tools_enabled: true,
    streaming_enabled: true,
    agent_failover_mode: 'limited',
    agent_health_check_enabled: true,
    agent_multi_enabled: false,
    agent_safety_profile: 'strict',
    agent_block_sudo: true,
    agent_allow_network_commands: false,
    agent_require_explicit_approval: false,
    permissions_file_read: false,
    permissions_file_write: false,
    permissions_terminal: false,
    permissions_screen_capture: false,
    permissions_mouse_control: false,
    permissions_microphone: false,
    agent_web_site_guard: true,
    agent_package_install_guard: true,
    agent_package_require_venv: true,
    agent_session_minutes: 15,
    agent_cloud_request_budget: 50,
    agent_max_output_tokens: 0,
    agent_tool_repeat_cap: 4,
    context_budget_warn_ratio: 0.15,
    skills_enabled: true,
    skills_auto_switch: true,
    skills_active_profile: '',
    skills_token_budget: 2200,
    skills_max_active: 4,
    skills_min_relevance_score: 3,
  } as unknown as OrbSettings,
  set_key: vi.fn(() => true),
  update_bridge_permissions: vi.fn(async () => ({ ok: true })),
  run_auto_setup: vi.fn(),
}))

vi.mock('@/platform/settingsStorage', () => ({
  readOrbSettings: () => state.settings,
  subscribeSettingsChanged: () => () => undefined,
  writeOrbSettings: (next: OrbSettings) => {
    state.settings = next
    return next
  },
  buildBridgePermissionState: (settings: OrbSettings) => ({
    fileRead: settings.permissions_file_read === true,
    fileWrite: settings.permissions_file_write === true,
    terminal: settings.permissions_terminal === true,
    launcher: settings.permissions_terminal === true,
    automation: settings.permissions_mouse_control === true,
    microphone: settings.permissions_microphone === true,
  }),
}))

vi.mock('@/platform/keyStore', () => ({
  getCredentialStorageStatus: () => ({
    available: true,
    persistent: true,
    backend: 'test-safe-storage',
    reason: '',
  }),
  hasKeyFor: () => false,
  listProviderKeys: () => ['1'],
  setKey: state.set_key,
}))

vi.mock('@/platform/aiService', () => ({
  testConnection: vi.fn(async () => ({ ok: true, models: ['model-a'], message: 'Connected.' })),
}))

vi.mock('@/platform/autoSetup/autoSetupService', () => ({
  runAutomaticSetup: state.run_auto_setup,
}))

vi.mock('@/platform/desktopBridge', () => ({
  cancelFileSemanticIndex: vi.fn(),
  clearFileSemanticIndex: vi.fn(),
  getFileIndexSources: vi.fn(async () => ({ sources: [], selectedSourceIds: [], locked: false })),
  getFileSemanticStatus: vi.fn(async () => ({
    sources: [],
    ollamaAvailable: true,
    imageModelInstalled: false,
    embeddingModelInstalled: false,
    imageModel: '',
    embeddingModel: '',
    indexStatus: 'missing',
    nodeCount: 0,
    fileCount: 0,
    semanticCount: 0,
    skippedCount: 0,
    failedCount: 0,
  })),
  installFileSemanticModels: vi.fn(),
  preflightFileSemanticIndex: vi.fn(),
  rebuildFileSemanticIndex: vi.fn(),
  rescanFileSemanticIndex: vi.fn(),
}))

import AISettingsPanel from '../src/components/settings/AISettingsPanel'

function render_panel(
  active_section: Parameters<typeof AISettingsPanel>[0]['active_section'] = 'providers',
  overrides: Partial<Parameters<typeof AISettingsPanel>[0]> = {},
) {
  return render(
    <AISettingsPanel
      active_section={active_section}
      editor_ai={{
        ollama_url: 'http://127.0.0.1:11434',
        speech_model: 'speech',
      }}
      highlighted_setting={null}
      on_editor_ai_change={vi.fn()}
      on_section_change={vi.fn()}
      {...overrides}
    />,
  )
}

describe('AISettingsPanel', () => {
  beforeEach(() => {
    state.settings.provider_key_validation = {}
    state.settings.provider_selected_models = {}
    state.settings.discovered_models = {}
    state.settings.permissions_file_read = false
    state.set_key.mockClear()
    state.update_bridge_permissions.mockClear()
    state.run_auto_setup.mockReset()
    state.run_auto_setup.mockResolvedValue({
      patch: {
        ai_provider: 'openai',
        ai_model: 'gpt-auto',
        ai_local_url: 'http://127.0.0.1:11434',
        agent_required_local_model: 'qwen3.5:9b',
        agent_models: [
          {
            id: 'orchestrator:openai:gpt-auto:1',
            role: 'orchestrator',
            provider: 'openai',
            model: 'gpt-auto',
            keyId: '1',
            primary: true,
            tags: [],
            disabledTags: [],
          },
        ],
        agent_multi_enabled: true,
        agent_peer_consult_enabled: true,
        agent_peer_review: 'off',
        agent_model_routing: 'off',
        agent_execution_policy: 'hybrid',
        provider_selected_models: { openai: ['gpt-auto'], local: ['qwen3.5:9b'] },
      },
      summary: ['Local worker: qwen3.5:9b', 'Cloud responders: gpt-auto'],
      testedKeys: 1,
      validKeys: 1,
      localDetected: true,
    })
    state.settings.ai_provider = 'openai'
    state.settings.ai_model = 'gpt-4o'
    state.settings.agent_models = null
    state.settings.agent_multi_enabled = false
    delete (state.settings as unknown as Record<string, unknown>).agent_required_local_model
    Object.defineProperty(window, 'orbitDesktop', {
      configurable: true,
      value: {
        security: {
          updateBridgePermissions: state.update_bridge_permissions,
        },
      },
    })
  })

  it('shows secure provider configuration and the complete AI settings navigation', () => {
    render_panel()

    expect(screen.getByText('Secure credential storage is active')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Semantic Index' })).toBeInTheDocument()
  })

  it('requests a section change without replacing the Settings shell', () => {
    const on_section_change = vi.fn()
    render_panel('providers', { on_section_change })

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(on_section_change).toHaveBeenCalledWith('agents')
  })

  it('automatically configures the model mesh from the Models tab', async () => {
    const on_editor_ai_change = vi.fn()
    render_panel('models', { on_editor_ai_change })

    fireEvent.click(screen.getByRole('button', { name: 'Auto Configure' }))

    await waitFor(() => expect(state.run_auto_setup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(state.settings.agent_multi_enabled).toBe(true))
    expect(state.settings.ai_provider).toBe('openai')
    expect(state.settings.ai_model).toBe('gpt-auto')
    expect((state.settings as unknown as Record<string, unknown>).agent_required_local_model).toBe('qwen3.5:9b')
    expect(on_editor_ai_change).not.toHaveBeenCalled()
    expect(screen.getByText(/Auto setup complete\./)).toBeInTheDocument()
  })

  it('surfaces automatic setup failures without changing the settings shell', async () => {
    state.run_auto_setup.mockRejectedValueOnce(new Error('No suitable model configuration is available.'))
    render_panel('models')

    fireEvent.click(screen.getByRole('button', { name: 'Auto Configure' }))

    expect(await screen.findByText('No suitable model configuration is available.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto Configure' })).toBeEnabled()
  })

  it('keeps speech settings editable', () => {
    const on_editor_ai_change = vi.fn()
    render_panel('models', { on_editor_ai_change })

    fireEvent.change(screen.getByDisplayValue('speech'), { target: { value: 'new-speech-model' } })
    expect(on_editor_ai_change).toHaveBeenCalledWith(expect.objectContaining({ speech_model: 'new-speech-model' }))
  })

  it('stores provider secrets only through the secure credential bridge', () => {
    render_panel('providers')

    fireEvent.change(screen.getByLabelText('OpenAI Key 1'), { target: { value: 'secret-test-key' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1])

    expect(state.set_key).toHaveBeenCalledWith('openai', 'secret-test-key', '1')
    expect((state.settings as unknown as Record<string, unknown>).ai_api_key).toBeUndefined()
  })

  it('updates the trusted bridge before persisting a privileged capability toggle', async () => {
    render_panel('autonomy')

    const file_read = screen.getByText('Read workspace files').closest('[data-setting-id]')
    expect(file_read).not.toBeNull()
    fireEvent.click(file_read!.querySelector('[role="switch"]') as HTMLElement)

    await waitFor(() => expect(state.update_bridge_permissions).toHaveBeenCalledTimes(1))
    expect(state.update_bridge_permissions).toHaveBeenCalledWith(expect.objectContaining({ fileRead: true }))
    expect(state.settings.permissions_file_read).toBe(true)
  })
})
