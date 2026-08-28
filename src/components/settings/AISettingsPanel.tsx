import { useEffect, useState } from 'react'
import { testConnection } from '@/platform/aiService'
import {
  getImageGenerationStatus,
  installImageGenerationModels,
  type ImageGenerationStatus,
} from '@/platform/imageGenerationBridge'
import type { AgentRoleId } from '@/platform/agent/agentIdentity'
import {
  readOrbSettings,
  subscribeSettingsChanged,
  writeOrbSettings,
  type OrbSettings,
} from '@/platform/settingsStorage'
import {
  agent_role_details,
  ai_settings_sections,
  clamp_number,
  get_primary_agent_model,
  permission_tier_options,
  set_primary_agent_model,
  type AISettingsSection,
} from '@/settings/aiSettings'
import type { AISettings as LegacyAISettings } from '@/types/editor'

interface AISettingsPanelProps {
  active_section: AISettingsSection
  editor_ai: LegacyAISettings
  highlighted_setting: string | null
  on_editor_ai_change: (settings: LegacyAISettings) => void
  on_section_change: (section: AISettingsSection) => void
}

const input_class =
  'h-9 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-xs text-[var(--text)] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/25'

function SettingsToggle({ checked, disabled = false, onChange }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-sky-500/35 ${
        checked ? 'border-sky-400/60 bg-sky-500' : 'border-[var(--input-border)] bg-[var(--surface-3)]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:brightness-110'}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function SettingsRow({ children, description, highlighted, id, label }: { children: React.ReactNode; description: string; highlighted: boolean; id: string; label: string }) {
  return (
    <div
      className={`flex min-h-16 items-center gap-5 rounded-xl border px-4 py-3 transition ${
        highlighted
          ? 'border-sky-400 bg-sky-500/10 shadow-[0_0_0_3px_rgba(56,189,248,0.12),0_0_32px_rgba(56,189,248,0.15)]'
          : 'border-transparent hover:border-[var(--border)] hover:bg-black/[0.035]'
      }`}
      data-setting-id={id}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--text)]">{label}</div>
        <div className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</h3>
      <div className="rounded-2xl border border-[var(--border)] bg-black/[0.04] p-1">{children}</div>
    </section>
  )
}

function AISettingsPanel({ active_section, editor_ai, highlighted_setting, on_editor_ai_change, on_section_change }: AISettingsPanelProps) {
  const [settings, set_settings] = useState<OrbSettings>(() => readOrbSettings())
  const [connection_busy, set_connection_busy] = useState(false)
  const [connection_message, set_connection_message] = useState('')
  const [image_status, set_image_status] = useState<ImageGenerationStatus | null>(null)
  const [image_busy, set_image_busy] = useState(false)
  const [image_message, set_image_message] = useState('')

  useEffect(() => subscribeSettingsChanged(set_settings), [])

  useEffect(() => {
    let cancelled = false
    void getImageGenerationStatus()
      .then((status) => {
        if (cancelled) return
        set_image_status(status)
        const current = readOrbSettings()
        if (status.ready && current.image_generation_auto_enabled_v1 !== true) {
          writeOrbSettings({
            ...current,
            image_generation_enabled: true,
            image_generation_auto_enabled_v1: true,
          })
        }
      })
      .catch((error) => {
        if (!cancelled) set_image_message(error instanceof Error ? error.message : 'Image generation status is unavailable.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const update = (patch: Partial<OrbSettings>) => {
    const next = writeOrbSettings({ ...settings, ...patch })
    set_settings(next)
  }

  const highlighted = (id: string) => highlighted_setting === id

  const test_local_connection = async () => {
    set_connection_busy(true)
    set_connection_message('')
    try {
      const result = await testConnection({ ...settings, ai_provider: 'local' } as never)
      set_connection_message(result.message || (result.ok ? 'Local model server connected.' : 'Local model server did not respond.'))
    } catch (error) {
      set_connection_message(error instanceof Error ? error.message : 'Local model connection failed.')
    } finally {
      set_connection_busy(false)
    }
  }

  const refresh_image_status = async () => {
    const status = await getImageGenerationStatus()
    set_image_status(status)
    return status
  }

  const install_image_models = async () => {
    set_image_busy(true)
    set_image_message('Downloading and verifying Z-Image Turbo models…')
    const poll = window.setInterval(() => {
      void refresh_image_status().catch(() => undefined)
    }, 1000)
    try {
      const status = await installImageGenerationModels()
      set_image_status(status)
      if (status.ready) {
        update({ image_generation_enabled: true, image_generation_auto_enabled_v1: true })
      }
      set_image_message(
        status.engineAvailable
          ? 'Image generation is ready and enabled.'
          : 'Models are installed, but the local image-generation runtime was not found.',
      )
    } catch (error) {
      set_image_message(error instanceof Error ? error.message : 'Z-Image Turbo installation failed.')
    } finally {
      window.clearInterval(poll)
      set_image_busy(false)
    }
  }

  const render_local_model = () => (
    <>
      <SettingsSection title="Local inference">
        <SettingsRow
          description="Address of the local OpenAI-compatible server used by the coding agent."
          highlighted={highlighted('ai-local-url')}
          id="ai-local-url"
          label="Local model server"
        >
          <input
            className={`${input_class} w-72`}
            onChange={(event) => {
              const value = event.target.value
              update({ ai_local_url: value })
              on_editor_ai_change({ ...editor_ai, ollama_url: value })
            }}
            placeholder="http://127.0.0.1:8080"
            value={String(settings.ai_local_url || editor_ai.ollama_url || '')}
          />
        </SettingsRow>
        <SettingsRow
          description="Model used by default for coding. Specialist agents can use a different model below."
          highlighted={highlighted('ai-model')}
          id="ai-model"
          label="Default model"
        >
          <input
            className={`${input_class} w-72`}
            onChange={(event) => update({ ai_provider: 'local', ai_model: event.target.value })}
            placeholder="Qwen coding model"
            value={String(settings.ai_model || '')}
          />
        </SettingsRow>
        <div className="flex items-center justify-end gap-3 px-4 py-3">
          {connection_message ? <span className="min-w-0 flex-1 text-[10px] text-[var(--muted)]">{connection_message}</span> : <span className="flex-1" />}
          <button
            className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
            disabled={connection_busy}
            onClick={() => void test_local_connection()}
            type="button"
          >
            {connection_busy ? 'Testing…' : 'Test local server'}
          </button>
        </div>
      </SettingsSection>
      <SettingsSection title="Image generation">
        <SettingsRow
          description="Allow the coding agent to generate image assets for your projects when useful."
          highlighted={highlighted('image-generation-enabled')}
          id="image-generation-enabled"
          label="Enable image generation"
        >
          <SettingsToggle
            checked={image_status?.ready === true && settings.image_generation_enabled === true}
            disabled={image_status?.ready !== true || image_busy}
            onChange={(value) => update({ image_generation_enabled: value, image_generation_auto_enabled_v1: true })}
          />
        </SettingsRow>
        <SettingsRow
          description="Uses the compact Z-Image Turbo models. Downloads about 6 GB, runs on GPU 1, and unloads after five minutes of inactivity."
          highlighted={highlighted('image-generation-runtime')}
          id="image-generation-runtime"
          label="Z-Image Turbo models"
        >
          <div className="flex items-center gap-2">
            {!image_status?.installed ? (
              <button
                className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
                disabled={image_busy}
                onClick={() => void install_image_models()}
                type="button"
              >
                {image_busy ? `${image_status?.installPercent || 0}%` : 'Install models (~6 GB)'}
              </button>
            ) : null}
            <button
              className="h-9 rounded-md border border-[var(--input-border)] px-3 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
              onClick={() => void refresh_image_status().catch((error) => set_image_message(error instanceof Error ? error.message : 'Status refresh failed.'))}
              type="button"
            >
              Refresh
            </button>
          </div>
        </SettingsRow>
        <div className="px-4 py-3 text-[10px] leading-4 text-[var(--muted)]">
          {image_message || (image_status?.ready
            ? `Ready · GPU ${image_status.gpuIndex} · ${image_status.running ? 'model loaded' : 'loads on first use'}`
            : image_status?.installed && !image_status.engineAvailable
              ? 'Models installed · local image-generation runtime not found'
              : image_status
                ? 'Image generation models are not installed.'
                : 'Checking image generation…')}
        </div>
      </SettingsSection>
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-[10px] leading-4 text-[var(--muted)]">
        Coding models run locally. Cloud model providers, semantic indexing, and automatic coding-model downloads are not used.
      </div>
    </>
  )

  const render_agents = () => {
    const roles = Object.keys(agent_role_details) as AgentRoleId[]
    return (
      <>
        <SettingsSection title="Specialist roles">
          {roles.map((role) => {
            const detail = agent_role_details[role]
            const binding = get_primary_agent_model(settings, role)
            const tierKey = `agent_permission_tier_${role}` as keyof OrbSettings
            return (
              <SettingsRow
                description={detail.description}
                highlighted={highlighted(`agent-${role}`)}
                id={`agent-${role}`}
                key={role}
                label={detail.label}
              >
                <div className="flex items-center gap-2">
                  <input
                    className={`${input_class} w-52`}
                    onChange={(event) => update({ agent_models: set_primary_agent_model(settings, role, { model: event.target.value }) })}
                    placeholder={String(settings.ai_model || 'local model')}
                    value={binding?.model || ''}
                  />
                  <select
                    aria-label={`${detail.label} permission tier`}
                    className={input_class}
                    onChange={(event) => update({ [tierKey]: Number(event.target.value) } as Partial<OrbSettings>)}
                    value={Number(settings[tierKey] ?? detail.default_tier)}
                  >
                    {permission_tier_options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </SettingsRow>
            )
          })}
        </SettingsSection>
        <SettingsSection title="Coordination">
          <SettingsRow description="Use specialist agents for research, implementation, and review when helpful." highlighted={highlighted('agent-multi-enabled')} id="agent-multi-enabled" label="Specialist agents">
            <SettingsToggle checked={settings.agent_multi_enabled === true} onChange={(value) => update({ agent_multi_enabled: value })} />
          </SettingsRow>
          <SettingsRow description="Allow an agent to ask another specialist for focused help when useful." highlighted={highlighted('agent-peer-consult')} id="agent-peer-consult" label="Specialist consultation">
            <SettingsToggle checked={settings.agent_peer_consult_enabled !== false} onChange={(value) => update({ agent_peer_consult_enabled: value })} />
          </SettingsRow>
        </SettingsSection>
      </>
    )
  }

  const render_autonomy = () => (
    <>
      <SettingsSection title="Workspace access">
        <SettingsRow description="Allow the coding agent to read files in the current project." highlighted={highlighted('permissions-file-read')} id="permissions-file-read" label="Read project files">
          <SettingsToggle checked={settings.permissions_file_read === true} onChange={(value) => update({ permissions_file_read: value })} />
        </SettingsRow>
        <SettingsRow description="Allow the coding agent to create and edit files in the current project." highlighted={highlighted('permissions-file-write')} id="permissions-file-write" label="Write project files">
          <SettingsToggle checked={settings.permissions_file_write === true} onChange={(value) => update({ permissions_file_write: value })} />
        </SettingsRow>
        <SettingsRow description="Allow the coding agent to run terminal commands for the current project." highlighted={highlighted('permissions-terminal')} id="permissions-terminal" label="Run terminal commands">
          <SettingsToggle checked={settings.permissions_terminal === true} onChange={(value) => update({ permissions_terminal: value })} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Execution safety">
        <SettingsRow description="Allow terminal commands that access the network, such as package managers." highlighted={highlighted('agent-network')} id="agent-network" label="Network commands">
          <SettingsToggle checked={settings.agent_allow_network_commands === true} onChange={(value) => update({ agent_allow_network_commands: value })} />
        </SettingsRow>
        <SettingsRow description="Ask for approval before installing dependencies that have not already been allowed." highlighted={highlighted('agent-package-guard')} id="agent-package-guard" label="Confirm package installs">
          <SettingsToggle checked={settings.agent_package_install_guard !== false} onChange={(value) => update({ agent_package_install_guard: value })} />
        </SettingsRow>
        <SettingsRow description="Prevent the coding agent from running sudo or other elevated shell commands." highlighted={highlighted('agent-block-sudo')} id="agent-block-sudo" label="Block elevated commands">
          <SettingsToggle checked={settings.agent_block_sudo !== false} onChange={(value) => update({ agent_block_sudo: value })} />
        </SettingsRow>
        <SettingsRow description="Start a fresh model context after this many minutes. The overall project continues." highlighted={highlighted('agent-context-minutes')} id="agent-context-minutes" label="Context handoff time">
          <input
            className={`${input_class} w-24`}
            min={1}
            max={120}
            onChange={(event) => update({ agent_session_minutes: clamp_number(event.target.value, 1, 120, 18) })}
            type="number"
            value={Number(settings.agent_session_minutes || 18)}
          />
        </SettingsRow>
        <SettingsRow description="Start a fresh model context after this many tool actions." highlighted={highlighted('agent-context-actions')} id="agent-context-actions" label="Context action limit">
          <input
            className={`${input_class} w-24`}
            min={16}
            max={400}
            onChange={(event) => update({ agent_context_action_limit: clamp_number(event.target.value, 16, 400, 120) } as Partial<OrbSettings>)}
            type="number"
            value={Number(settings.agent_context_action_limit || 120)}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )

  const render_skills = () => (
    <SettingsSection title="Development skills">
      <SettingsRow description="Load task-specific coding instructions when they are relevant." highlighted={highlighted('skills-enabled')} id="skills-enabled" label="Skills">
        <SettingsToggle checked={settings.skills_enabled !== false} onChange={(value) => update({ skills_enabled: value })} />
      </SettingsRow>
      <SettingsRow description="Automatically choose the most relevant installed skill for the current work." highlighted={highlighted('skills-auto-switch')} id="skills-auto-switch" label="Automatic skill selection">
        <SettingsToggle checked={settings.skills_auto_switch !== false} onChange={(value) => update({ skills_auto_switch: value })} />
      </SettingsRow>
      <SettingsRow description="Maximum amount of skill instructions loaded into one model context." highlighted={highlighted('skills-token-budget')} id="skills-token-budget" label="Skill context budget">
        <input className={`${input_class} w-28`} min={256} max={16000} onChange={(event) => update({ skills_token_budget: clamp_number(event.target.value, 256, 16000, 2200) })} type="number" value={Number(settings.skills_token_budget || 2200)} />
      </SettingsRow>
    </SettingsSection>
  )

  const visibleSection: AISettingsSection = ai_settings_sections.some((section) => section.id === active_section) ? active_section : 'providers'
  let content: React.ReactNode
  if (visibleSection === 'providers') content = render_local_model()
  else if (visibleSection === 'agents') content = render_agents()
  else if (visibleSection === 'autonomy') content = render_autonomy()
  else content = render_skills()

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-black/[0.04] p-1">
        {ai_settings_sections.map((section) => (
          <button
            aria-current={visibleSection === section.id ? 'page' : undefined}
            className={`rounded-lg px-3 py-2 text-[11px] transition ${
              visibleSection === section.id
                ? 'bg-sky-500/14 text-sky-300'
                : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
            }`}
            key={section.id}
            onClick={() => on_section_change(section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>
      {content}
    </div>
  )
}

export default AISettingsPanel
