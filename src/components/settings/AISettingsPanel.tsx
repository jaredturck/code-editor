import { useEffect, useState } from 'react'
import { testConnection } from '@/platform/aiService'
import {
  cancelFileSemanticIndex,
  clearFileSemanticIndex,
  getFileIndexSources,
  getFileSemanticStatus,
  installFileSemanticModels,
  preflightFileSemanticIndex,
  rebuildFileSemanticIndex,
  rescanFileSemanticIndex,
  type BridgeFileIndexSource,
  type BridgeFileSemanticPreflight,
  type BridgeFileSemanticStatus,
} from '@/platform/desktopBridge'
import type { AgentRoleId } from '@/platform/agent/agentIdentity'
import { getCredentialStorageStatus, hasKeyFor, listProviderKeys, setKey } from '@/platform/keyStore'
import {
  buildDiscoveredModelsPatch,
  buildProviderValidationPatch,
  getCuratedModelsForKey,
  getProviderCatalog,
  getProviderValidation,
  getSelectedProviderModels,
  getValidProviderKeyIds,
  normalizeModelList,
  type ProviderKeyValidationRecord,
} from '@/platform/providers/providerConfiguration'
import { AI_PROVIDER_DEFINITIONS } from '@/platform/providers/providerRegistry'
import {
  buildBridgePermissionState,
  readOrbSettings,
  subscribeSettingsChanged,
  writeOrbSettings,
  type OrbSettings,
} from '@/platform/settingsStorage'
import {
  agent_role_details,
  ai_settings_sections,
  clamp_number,
  classify_provider_failure,
  get_primary_agent_model,
  permission_tier_options,
  set_primary_agent_model,
  set_provider_selected_models,
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

const provider_status_color: Record<string, string> = {
  valid: 'text-emerald-400',
  invalid: 'text-red-400',
  unavailable: 'text-amber-400',
  untested: 'text-[var(--muted)]',
}

const permission_keys = [
  ['permissions_file_read', 'Read workspace files', 'Allow brokered agent file reads.'],
  ['permissions_file_write', 'Write workspace files', 'Allow brokered agent file writes and edits.'],
  ['permissions_terminal', 'Run terminal commands', 'Allow brokered command execution and local program launch.'],
  ['permissions_screen_capture', 'Capture screen', 'Allow permissioned screen capture for vision tasks.'],
  ['permissions_mouse_control', 'Desktop automation', 'Allow permissioned mouse/automation capabilities.'],
  ['permissions_microphone', 'Use microphone', 'Allow the migrated transcription service to access microphone input.'],
] as const

function SettingsToggle({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
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
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

function SettingsRow({
  children,
  description,
  highlighted,
  id,
  label,
}: {
  children: React.ReactNode
  description: string
  highlighted: boolean
  id: string
  label: string
}) {
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

function credential_slot_id(provider_id: string, key_id: string) {
  return `${provider_id}:${key_id}`
}

function next_key_id(provider_id: string, pending_ids: string[] = []) {
  const ids = [...listProviderKeys(provider_id), ...pending_ids].map((value) => Number(value)).filter(Number.isFinite)
  return String((ids.length ? Math.max(...ids) : 1) + 1)
}

function validation_label(status: string) {
  if (status === 'valid') return 'Validated'
  if (status === 'invalid') return 'Invalid credential'
  if (status === 'unavailable') return 'Could not verify'
  return 'Not tested'
}

function AISettingsPanel({
  active_section,
  editor_ai,
  highlighted_setting,
  on_editor_ai_change,
  on_section_change,
}: AISettingsPanelProps) {
  const [platform_settings, set_platform_settings] = useState<OrbSettings>(() => readOrbSettings())
  const [credential_revision, set_credential_revision] = useState(0)
  const [key_inputs, set_key_inputs] = useState<Record<string, string>>({})
  const [extra_key_slots, set_extra_key_slots] = useState<Record<string, string[]>>({})
  const [provider_busy, set_provider_busy] = useState<Record<string, boolean>>({})
  const [provider_messages, set_provider_messages] = useState<Record<string, string>>({})
  const [models_provider, set_models_provider] = useState<string>(AI_PROVIDER_DEFINITIONS[0]?.id || 'openai')
  const [model_filter, set_model_filter] = useState('')
  const [manual_model, set_manual_model] = useState('')
  const [permission_error, set_permission_error] = useState('')
  const [permission_busy, set_permission_busy] = useState<Record<string, boolean>>({})
  const [semantic_status, set_semantic_status] = useState<BridgeFileSemanticStatus | null>(null)
  const [semantic_sources, set_semantic_sources] = useState<BridgeFileIndexSource[]>([])
  const [semantic_source_ids, set_semantic_source_ids] = useState<string[]>([])
  const [semantic_preflight, set_semantic_preflight] = useState<BridgeFileSemanticPreflight | null>(null)
  const [semantic_busy, set_semantic_busy] = useState('')
  const [semantic_error, set_semantic_error] = useState('')

  useEffect(() => subscribeSettingsChanged(set_platform_settings), [])

  useEffect(() => {
    if (active_section !== 'semantic') return
    let cancelled = false

    const load = async () => {
      set_semantic_error('')
      try {
        const [status, source_state] = await Promise.all([getFileSemanticStatus(false), getFileIndexSources()])
        if (cancelled) return
        set_semantic_status(status)
        set_semantic_sources(source_state.sources || [])
        set_semantic_source_ids(source_state.selectedSourceIds || [])
      } catch (error) {
        if (!cancelled) {
          set_semantic_error(error instanceof Error ? error.message : 'Could not read semantic index status.')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [active_section])

  useEffect(() => {
    if (active_section !== 'semantic' || semantic_status?.indexStatus !== 'building') return
    const timer = window.setInterval(() => {
      void getFileSemanticStatus(false)
        .then(set_semantic_status)
        .catch(() => undefined)
    }, 750)
    return () => window.clearInterval(timer)
  }, [active_section, semantic_status?.indexStatus])

  const update_platform_settings = (patch: Partial<OrbSettings>) => {
    const current = readOrbSettings()
    const next = writeOrbSettings({ ...current, ...patch })
    set_platform_settings(next)
    window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: next }))
    return next
  }

  const row = (id: string, label: string, description: string, control: React.ReactNode) => (
    <SettingsRow key={id} description={description} highlighted={highlighted_setting === id} id={id} label={label}>
      {control}
    </SettingsRow>
  )

  const save_key = (provider_id: string, key_id: string) => {
    const slot = credential_slot_id(provider_id, key_id)
    const value = String(key_inputs[slot] || '').trim()
    if (!value) return hasKeyFor(provider_id, key_id)

    const saved = setKey(provider_id, value, key_id)
    if (!saved) {
      set_provider_messages((current) => ({ ...current, [slot]: 'Secure credential storage rejected the key.' }))
      return false
    }

    set_key_inputs((current) => ({ ...current, [slot]: '' }))
    const current = readOrbSettings()
    update_platform_settings({
      provider_key_validation: buildProviderValidationPatch(current, provider_id, key_id, null),
      discovered_models: buildDiscoveredModelsPatch(current, provider_id, key_id, null),
    })
    set_provider_messages((current) => ({ ...current, [slot]: 'Saved securely. Test the key to discover models.' }))
    set_credential_revision((value) => value + 1)
    return true
  }

  const delete_key = (provider_id: string, key_id: string) => {
    const slot = credential_slot_id(provider_id, key_id)
    if (!setKey(provider_id, '', key_id)) {
      set_provider_messages((current) => ({
        ...current,
        [slot]: 'Secure credential storage could not remove the key.',
      }))
      return
    }

    const current = readOrbSettings()
    update_platform_settings({
      provider_key_validation: buildProviderValidationPatch(current, provider_id, key_id, null),
      discovered_models: buildDiscoveredModelsPatch(current, provider_id, key_id, null),
    })
    set_key_inputs((current) => ({ ...current, [slot]: '' }))
    set_provider_messages((current) => ({ ...current, [slot]: 'Credential removed.' }))
    set_extra_key_slots((current) => ({
      ...current,
      [provider_id]: (current[provider_id] || []).filter((value) => value !== key_id),
    }))
    set_credential_revision((value) => value + 1)
  }

  const test_provider = async (provider_id: string, key_id = '1') => {
    const provider = AI_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider_id)
    if (!provider) return
    const slot = credential_slot_id(provider_id, key_id)

    if (provider.requiresApiKey) {
      const pending_key = String(key_inputs[slot] || '').trim()
      if (pending_key && !save_key(provider_id, key_id)) return
      if (!pending_key && !hasKeyFor(provider_id, key_id)) {
        set_provider_messages((current) => ({ ...current, [slot]: 'Save an API key before testing.' }))
        return
      }
    }

    set_provider_busy((current) => ({ ...current, [slot]: true }))
    set_provider_messages((current) => ({ ...current, [slot]: 'Testing connection…' }))

    try {
      const current = readOrbSettings()
      const selected_models = getSelectedProviderModels(current, provider_id)
      const result = await testConnection(
        {
          ...current,
          ai_provider: provider_id,
          ai_model: provider_id === 'local' ? '' : selected_models[0] || provider.defaultModel,
        },
        key_id,
      )
      const record: ProviderKeyValidationRecord = {
        status: result.ok ? 'valid' : classify_provider_failure(result.message),
        testedAt: Date.now(),
        message: result.message,
        models: normalizeModelList(result.models),
      }
      update_platform_settings({
        provider_key_validation: buildProviderValidationPatch(current, provider_id, key_id, record),
        discovered_models: buildDiscoveredModelsPatch(current, provider_id, key_id, record.models),
      })
      set_provider_messages((previous) => ({ ...previous, [slot]: result.message }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection test failed.'
      update_platform_settings({
        provider_key_validation: buildProviderValidationPatch(readOrbSettings(), provider_id, key_id, {
          status: classify_provider_failure(message),
          testedAt: Date.now(),
          message,
          models: [],
        }),
      })
      set_provider_messages((previous) => ({ ...previous, [slot]: message }))
    } finally {
      set_provider_busy((current) => ({ ...current, [slot]: false }))
      set_credential_revision((value) => value + 1)
    }
  }

  const update_selected_models = (provider_id: string, models: string[]) => {
    const selected = normalizeModelList(models)
    const current = readOrbSettings()
    const next = update_platform_settings({
      provider_selected_models: set_provider_selected_models(current, provider_id, selected),
    })

    if (provider_id === 'local') {
      const selected_model = selected[0] || ''
      on_editor_ai_change({ ...editor_ai, selected_model })
      if (selected_model && !get_primary_agent_model(next, 'orchestrator')) {
        update_platform_settings({ ai_provider: 'local', ai_model: selected_model })
      }
    }
  }

  const update_role = (role: AgentRoleId, provider: string, model: string, key_id: string) => {
    const current = readOrbSettings()
    update_platform_settings({
      agent_models: set_primary_agent_model(current, role, provider && model ? { provider, model, key_id } : null),
    })
  }

  const update_permission = async (key: (typeof permission_keys)[number][0], value: boolean) => {
    if (permission_busy[key]) return
    set_permission_error('')
    set_permission_busy((current) => ({ ...current, [key]: true }))
    const current = readOrbSettings()
    const next = { ...current, [key]: value } as OrbSettings
    const update_bridge = window.orbitDesktop?.security?.updateBridgePermissions
    if (!update_bridge) {
      set_permission_error('The trusted desktop permission bridge is unavailable.')
      set_permission_busy((current) => ({ ...current, [key]: false }))
      return
    }

    try {
      const result = await update_bridge(buildBridgePermissionState(next))
      if (result?.ok === false) {
        set_permission_error(result.error || 'The trusted bridge rejected the permission change.')
        return
      }
      update_platform_settings({ [key]: value } as Partial<OrbSettings>)
    } catch (error) {
      set_permission_error(error instanceof Error ? error.message : 'The permission change failed.')
    } finally {
      set_permission_busy((current) => ({ ...current, [key]: false }))
    }
  }

  const refresh_semantic_status = async () => {
    const [status, source_state] = await Promise.all([getFileSemanticStatus(false), getFileIndexSources()])
    set_semantic_status(status)
    set_semantic_sources(source_state.sources || [])
    set_semantic_source_ids(source_state.selectedSourceIds || [])
    return status
  }

  const run_semantic_action = async (action: string, operation: () => Promise<BridgeFileSemanticStatus>) => {
    if (semantic_busy) return
    set_semantic_busy(action)
    set_semantic_error('')
    try {
      const status = await operation()
      set_semantic_status(status)
      if (status.indexStatus !== 'building') await refresh_semantic_status()
    } catch (error) {
      set_semantic_error(error instanceof Error ? error.message : 'Semantic index operation failed.')
    } finally {
      set_semantic_busy('')
    }
  }

  const preflight_semantic_index = async () => {
    if (semantic_busy) return
    set_semantic_busy('preflight')
    set_semantic_error('')
    try {
      const preflight = await preflightFileSemanticIndex(semantic_source_ids)
      set_semantic_preflight(preflight)
      if (!preflight.requiresConfirmation) {
        const status = await rebuildFileSemanticIndex(false, semantic_source_ids)
        set_semantic_status(status)
      }
    } catch (error) {
      set_semantic_error(error instanceof Error ? error.message : 'Semantic index preflight failed.')
    } finally {
      set_semantic_busy('')
    }
  }

  const render_providers = () => {
    const storage = getCredentialStorageStatus()
    void credential_revision

    return (
      <>
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-[11px] ${
            storage.available && storage.persistent
              ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
              : 'border-red-500/30 bg-red-500/5 text-red-300'
          }`}
        >
          <div className="font-medium">
            {storage.available && storage.persistent
              ? 'Secure credential storage is active'
              : 'Secure credential storage unavailable'}
          </div>
          <div className="mt-1 opacity-80">
            {storage.available && storage.persistent
              ? `API keys are stored with Electron safeStorage (${storage.backend || 'OS credential store'}) and are never written to editor settings.`
              : storage.reason ||
                'Cloud provider credentials cannot be saved until the secure desktop bridge is available.'}
          </div>
        </div>

        {AI_PROVIDER_DEFINITIONS.map((provider) => {
          const stored_keys = provider.requiresApiKey ? listProviderKeys(provider.id) : ['1']
          const slots = Array.from(new Set([...stored_keys, ...(extra_key_slots[provider.id] || [])]))
          const validation = getProviderValidation(platform_settings, provider.id, '1')

          return (
            <SettingsSection key={provider.id} title={provider.label}>
              {provider.id === 'local'
                ? row(
                    'provider-local-url',
                    'Local server address',
                    'Ollama-compatible endpoint used by the migrated local provider.',
                    <div className="flex items-center gap-2">
                      <input
                        className={`${input_class} w-72 font-mono`}
                        onChange={(event) => {
                          const value = event.target.value
                          update_platform_settings({
                            ai_local_url: value,
                            provider_key_validation: buildProviderValidationPatch(
                              readOrbSettings(),
                              'local',
                              '1',
                              null,
                            ),
                          })
                          on_editor_ai_change({ ...editor_ai, ollama_url: value })
                        }}
                        value={String(platform_settings.ai_local_url || editor_ai.ollama_url)}
                      />
                      <button
                        className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                        disabled={provider_busy['local:1']}
                        onClick={() => void test_provider('local')}
                        type="button"
                      >
                        {provider_busy['local:1'] ? 'Testing…' : 'Test & discover'}
                      </button>
                    </div>,
                  )
                : null}

              {provider.requiresApiKey
                ? slots.map((key_id) => {
                    const slot = credential_slot_id(provider.id, key_id)
                    const stored = hasKeyFor(provider.id, key_id)
                    const key_validation = getProviderValidation(platform_settings, provider.id, key_id)
                    return (
                      <div
                        className="rounded-xl border border-transparent px-4 py-3 hover:border-[var(--border)]"
                        data-setting-id={key_id === '1' ? `provider-${provider.id}-status` : undefined}
                        key={slot}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-16 text-xs font-medium text-[var(--text)]">Key {key_id}</div>
                          <input
                            aria-label={`${provider.label} Key ${key_id}`}
                            autoComplete="off"
                            className={`${input_class} min-w-0 flex-1 font-mono`}
                            onChange={(event) =>
                              set_key_inputs((current) => ({ ...current, [slot]: event.target.value }))
                            }
                            placeholder={
                              stored ? 'Stored securely — enter a replacement' : provider.keyPlaceholder || 'API key'
                            }
                            type="password"
                            value={key_inputs[slot] || ''}
                          />
                          <button
                            className="h-9 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40"
                            disabled={
                              !storage.available || !storage.persistent || !String(key_inputs[slot] || '').trim()
                            }
                            onClick={() => save_key(provider.id, key_id)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
                            disabled={
                              !storage.available ||
                              !storage.persistent ||
                              provider_busy[slot] ||
                              (!stored && !String(key_inputs[slot] || '').trim())
                            }
                            onClick={() => void test_provider(provider.id, key_id)}
                            type="button"
                          >
                            {provider_busy[slot] ? 'Testing…' : 'Test'}
                          </button>
                          {stored ? (
                            <button
                              className="h-9 rounded-md px-2 text-xs text-red-400 hover:bg-red-500/10"
                              onClick={() => delete_key(provider.id, key_id)}
                              type="button"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="ml-[76px] mt-2 flex items-center justify-between gap-3 text-[10px]">
                          <span
                            className={provider_status_color[key_validation.status] || provider_status_color.untested}
                          >
                            {stored ? validation_label(key_validation.status) : 'No key stored'}
                            {key_validation.models.length ? ` · ${key_validation.models.length} models` : ''}
                          </span>
                          {provider_messages[slot] || key_validation.message ? (
                            <span
                              className="max-w-[65%] truncate text-right text-[var(--muted)]"
                              title={provider_messages[slot] || key_validation.message}
                            >
                              {provider_messages[slot] || key_validation.message}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                : row(
                    `provider-${provider.id}-status`,
                    'Connection status',
                    provider_messages['local:1'] ||
                      validation.message ||
                      'Test the local endpoint explicitly; Settings never creates background model traffic.',
                    <span
                      className={`text-xs ${provider_status_color[validation.status] || provider_status_color.untested}`}
                    >
                      {validation_label(validation.status)}
                    </span>,
                  )}

              {provider.requiresApiKey ? (
                <div className="flex items-center justify-between px-4 pb-3 pt-1">
                  <button
                    className="text-[11px] text-sky-300 hover:text-sky-200 disabled:opacity-40"
                    disabled={!storage.available || !storage.persistent}
                    onClick={() => {
                      const key_id = next_key_id(provider.id, extra_key_slots[provider.id] || [])
                      set_extra_key_slots((current) => ({
                        ...current,
                        [provider.id]: [...(current[provider.id] || []), key_id],
                      }))
                    }}
                    type="button"
                  >
                    + Add another key
                  </button>
                  {provider.keyHelpUrl ? (
                    <button
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
                      onClick={() => window.editor_api.file.open_external(provider.keyHelpUrl || '')}
                      type="button"
                    >
                      Get an API key ↗
                    </button>
                  ) : null}
                </div>
              ) : null}
            </SettingsSection>
          )
        })}
      </>
    )
  }

  const render_models = () => {
    const catalog = getProviderCatalog(platform_settings, models_provider)
    const selected = getSelectedProviderModels(platform_settings, models_provider)
    const filter = model_filter.trim().toLowerCase()
    const visible = catalog.filter((model) => model.toLowerCase().includes(filter)).slice(0, 250)
    const provider = AI_PROVIDER_DEFINITIONS.find((entry) => entry.id === models_provider)

    return (
      <>
        <SettingsSection title="Model catalog">
          {row(
            'model-provider',
            'Provider',
            'Choose a validated provider to inspect its discovered model catalog.',
            <select
              className={`${input_class} w-64`}
              onChange={(event) => {
                set_models_provider(event.target.value)
                set_model_filter('')
                set_manual_model('')
              }}
              value={models_provider}
            >
              {AI_PROVIDER_DEFINITIONS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>,
          )}
          {row(
            'model-search',
            'Filter models',
            'Search the models returned by the provider/runtime during explicit connection testing.',
            <input
              className={`${input_class} w-64`}
              onChange={(event) => set_model_filter(event.target.value)}
              placeholder="Search model IDs…"
              value={model_filter}
            />,
          )}
        </SettingsSection>

        <SettingsSection title={`${provider?.label || models_provider} · selected for agents`}>
          <div className="px-4 py-3">
            {selected.length ? (
              <div className="flex flex-wrap gap-2">
                {selected.map((model) => (
                  <button
                    className="rounded-md border border-sky-500/25 bg-sky-500/8 px-2 py-1 text-[10px] text-sky-300 hover:bg-red-500/10 hover:text-red-300"
                    key={model}
                    onClick={() =>
                      update_selected_models(
                        models_provider,
                        selected.filter((item) => item !== model),
                      )
                    }
                    title="Remove from the agent model shortlist"
                    type="button"
                  >
                    {model} ×
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--muted)]">No models selected for this provider.</div>
            )}
            {!catalog.length ? (
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
                <input
                  aria-label="Manual model ID"
                  className={`${input_class} min-w-0 flex-1 font-mono`}
                  onChange={(event) => set_manual_model(event.target.value)}
                  placeholder="Provider does not expose a model catalog — enter a model ID"
                  value={manual_model}
                />
                <button
                  className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
                  disabled={!manual_model.trim()}
                  onClick={() => {
                    update_selected_models(models_provider, [...selected, manual_model.trim()])
                    set_manual_model('')
                  }}
                  type="button"
                >
                  Add
                </button>
              </div>
            ) : null}
          </div>
        </SettingsSection>

        <SettingsSection title="Discovered models">
          {catalog.length ? (
            <div className="max-h-[390px] overflow-y-auto p-1">
              {visible.map((model) => {
                const checked = selected.includes(model)
                return (
                  <label
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--hover)]"
                    key={model}
                  >
                    <input
                      checked={checked}
                      onChange={() =>
                        update_selected_models(
                          models_provider,
                          checked ? selected.filter((item) => item !== model) : [...selected, model],
                        )
                      }
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text)]">{model}</span>
                  </label>
                )
              })}
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-[11px] text-[var(--muted)]">No models match the filter.</div>
              ) : null}
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-[11px] text-[var(--muted)]">
              No discovered models yet. Test this provider in <strong>Providers</strong> first.
            </div>
          )}
        </SettingsSection>

        <SettingsSection title="Existing Code Editor AI">
          {row(
            'ollama-model',
            'Current local Chat model',
            'The existing AI Chat panel still uses this Ollama model until it is connected to the full agent runtime.',
            <input
              className={`${input_class} w-72 font-mono`}
              onChange={(event) => on_editor_ai_change({ ...editor_ai, selected_model: event.target.value })}
              placeholder="Select in AI Chat"
              value={editor_ai.selected_model}
            />,
          )}
          {row(
            'speech-model',
            'Speech transcription model',
            'Ollama model used by the existing voice-input path until audio is consolidated onto the migrated transcription service.',
            <input
              className={`${input_class} w-72 font-mono`}
              onChange={(event) => on_editor_ai_change({ ...editor_ai, speech_model: event.target.value })}
              value={editor_ai.speech_model}
            />,
          )}
        </SettingsSection>
      </>
    )
  }

  const render_agents = () => {
    const roles = Object.keys(agent_role_details) as AgentRoleId[]

    return (
      <SettingsSection title="Agent role assignments">
        {roles.map((role) => {
          const detail = agent_role_details[role]
          const current = get_primary_agent_model(platform_settings, role)
          const ready_providers = AI_PROVIDER_DEFINITIONS.filter((provider) => {
            if (provider.id === current?.provider) return true
            const models = getSelectedProviderModels(platform_settings, provider.id)
            const keys = provider.id === 'local' ? ['1'] : getValidProviderKeyIds(platform_settings, provider.id)
            return (
              models.length > 0 &&
              keys.length > 0 &&
              getProviderValidation(platform_settings, provider.id, keys[0]).status === 'valid'
            )
          })
          const provider_id = current?.provider || ''
          const key_ids = provider_id === 'local' ? ['1'] : getValidProviderKeyIds(platform_settings, provider_id)
          const key_id = current?.keyId || key_ids[0] || '1'
          const models = provider_id ? getCuratedModelsForKey(platform_settings, provider_id, key_id) : []
          const tier_key = `agent_permission_tier_${role}` as keyof OrbSettings
          const tier = Number(platform_settings[tier_key] ?? detail.default_tier)

          return (
            <div
              className="rounded-xl border border-transparent px-4 py-4 hover:border-[var(--border)]"
              data-setting-id={`agent-role-${role}`}
              key={role}
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium text-[var(--text)]">{detail.label}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{detail.description}</div>
                </div>
                {current ? (
                  <button
                    className="text-[10px] text-red-400 hover:text-red-300"
                    onClick={() => update_role(role, '', '', '1')}
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-[minmax(0,1.1fr)_90px_minmax(0,1.5fr)_130px] gap-2">
                <select
                  aria-label={`${detail.label} provider`}
                  className={input_class}
                  onChange={(event) => {
                    const provider = event.target.value
                    if (!provider) {
                      update_role(role, '', '', '1')
                      return
                    }
                    const keys = provider === 'local' ? ['1'] : getValidProviderKeyIds(platform_settings, provider)
                    const next_key = keys[0] || '1'
                    const next_model = getCuratedModelsForKey(platform_settings, provider, next_key)[0] || ''
                    update_role(role, provider, next_model, next_key)
                  }}
                  value={provider_id}
                >
                  <option value="">Unassigned</option>
                  {ready_providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${detail.label} key`}
                  className={input_class}
                  disabled={!provider_id || provider_id === 'local' || key_ids.length <= 1}
                  onChange={(event) => {
                    const next_key = event.target.value
                    const next_models = getCuratedModelsForKey(platform_settings, provider_id, next_key)
                    const next_model = next_models.includes(current?.model || '')
                      ? current?.model || ''
                      : next_models[0] || ''
                    update_role(role, provider_id, next_model, next_key)
                  }}
                  value={key_id}
                >
                  {(key_ids.length ? key_ids : [key_id]).map((value) => (
                    <option key={value} value={value}>
                      Key {value}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${detail.label} model`}
                  className={input_class}
                  disabled={!provider_id}
                  onChange={(event) => update_role(role, provider_id, event.target.value, key_id)}
                  value={current?.model || ''}
                >
                  {!current?.model ? <option value="">Select model…</option> : null}
                  {current?.model && !models.includes(current.model) ? (
                    <option value={current.model}>{current.model} · unavailable</option>
                  ) : null}
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${detail.label} permission tier`}
                  className={input_class}
                  onChange={(event) =>
                    update_platform_settings({ [tier_key]: Number(event.target.value) } as Partial<OrbSettings>)
                  }
                  value={tier}
                >
                  {permission_tier_options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </SettingsSection>
    )
  }

  const render_routing = () => (
    <>
      <SettingsSection title="Execution">
        {row(
          'ai-execution-policy',
          'Execution policy',
          'Choose whether an answering model may collaborate with the configured model mesh.',
          <select
            className={`${input_class} w-56`}
            onChange={(event) => update_platform_settings({ agent_execution_policy: event.target.value })}
            value={String(platform_settings.agent_execution_policy || 'hybrid')}
          >
            <option value="hybrid">Hybrid · allow model mesh</option>
            <option value="primary_only">Primary model only</option>
            <option value="local_only">Local models only</option>
          </select>,
        )}
        {row(
          'ai-model-routing',
          'Complexity-aware model routing',
          'Allow the runtime to select among configured healthy models according to task complexity.',
          <SettingsToggle
            checked={String(platform_settings.agent_model_routing || 'off') === 'on'}
            onChange={(value) => update_platform_settings({ agent_model_routing: value ? 'on' : 'off' })}
          />,
        )}
        {row(
          'ai-stateful-loop',
          'Stateful agent loop',
          'Preserve native provider tool/message state between agent actions where supported.',
          <select
            className={`${input_class} w-48`}
            onChange={(event) => update_platform_settings({ agent_stateful_loop: event.target.value })}
            value={String(platform_settings.agent_stateful_loop || 'auto')}
          >
            <option value="auto">Automatic</option>
            <option value="on">Always when supported</option>
            <option value="off">Legacy controller loop</option>
          </select>,
        )}
        {row(
          'ai-native-tools',
          'Native tool calling',
          'Use provider-native tool calls on capable models instead of forcing JSON-in-text control.',
          <SettingsToggle
            checked={platform_settings.native_tools_enabled !== false}
            onChange={(value) => update_platform_settings({ native_tools_enabled: value })}
          />,
        )}
        {row(
          'ai-toolset',
          'Advertised tool surface',
          'Automatic favors a lean terminal-first surface for capable models and a structured surface for weaker models.',
          <select
            className={`${input_class} w-48`}
            onChange={(event) => update_platform_settings({ agent_toolset: event.target.value })}
            value={String(platform_settings.agent_toolset || 'auto')}
          >
            <option value="auto">Automatic</option>
            <option value="lean">Lean</option>
            <option value="structured">Structured</option>
          </select>,
        )}
        {row(
          'ai-streaming',
          'Stream model output',
          'Stream supported provider responses while the agent is working.',
          <SettingsToggle
            checked={platform_settings.streaming_enabled !== false}
            onChange={(value) => update_platform_settings({ streaming_enabled: value })}
          />,
        )}
      </SettingsSection>
      <SettingsSection title="Recovery and collaboration">
        {row(
          'ai-failover',
          'Model failover',
          'Switch to another compatible healthy model when the current model repeatedly fails.',
          <select
            className={`${input_class} w-48`}
            onChange={(event) => update_platform_settings({ agent_failover_mode: event.target.value })}
            value={String(platform_settings.agent_failover_mode || 'limited')}
          >
            <option value="off">Off</option>
            <option value="limited">Limited</option>
            <option value="exhaust">Use all candidates</option>
          </select>,
        )}
        {row(
          'ai-health-monitoring',
          'Model health monitoring',
          'Track failures and periodically re-check degraded/suspended model assignments.',
          <SettingsToggle
            checked={platform_settings.agent_health_check_enabled !== false}
            onChange={(value) => update_platform_settings({ agent_health_check_enabled: value })}
          />,
        )}
        {row(
          'ai-multi-agent',
          'Enable multi-agent runtime',
          'Allow the configured Orchestrator to delegate to Executor, Scout and Reviewer roles.',
          <SettingsToggle
            checked={platform_settings.agent_multi_enabled === true}
            onChange={(value) => update_platform_settings({ agent_multi_enabled: value })}
          />,
        )}
      </SettingsSection>
    </>
  )

  const render_autonomy = () => (
    <>
      <SettingsSection title="Safety policy">
        {row(
          'ai-safety-profile',
          'Safety profile',
          'Strict keeps conservative defaults; Balanced permits broader brokered operations within configured permissions.',
          <select
            className={`${input_class} w-44`}
            onChange={(event) => update_platform_settings({ agent_safety_profile: event.target.value })}
            value={String(platform_settings.agent_safety_profile || 'strict')}
          >
            <option value="strict">Strict</option>
            <option value="balanced">Balanced</option>
          </select>,
        )}
        {row(
          'ai-explicit-approval',
          'Require explicit approval',
          'Request approval for guarded actions even when broad capability permission is available.',
          <SettingsToggle
            checked={platform_settings.agent_require_explicit_approval === true}
            onChange={(value) => update_platform_settings({ agent_require_explicit_approval: value })}
          />,
        )}
        {row(
          'ai-block-sudo',
          'Block sudo / privilege escalation',
          'Keep privileged shell commands blocked by default.',
          <SettingsToggle
            checked={platform_settings.agent_block_sudo !== false}
            onChange={(value) => update_platform_settings({ agent_block_sudo: value })}
          />,
        )}
        {row(
          'ai-network-commands',
          'Allow terminal network commands',
          'Permit brokered terminal commands such as curl/wget subject to the web policy.',
          <SettingsToggle
            checked={platform_settings.agent_allow_network_commands === true}
            onChange={(value) => update_platform_settings({ agent_allow_network_commands: value })}
          />,
        )}
      </SettingsSection>

      <SettingsSection title="Persistent capabilities">
        {permission_error ? (
          <div className="mx-2 my-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-[10px] text-red-300">
            {permission_error}
          </div>
        ) : null}
        {permission_keys.map(([key, label, description]) =>
          row(
            `ai-${key}`,
            label,
            description,
            <SettingsToggle
              checked={platform_settings[key] === true}
              disabled={permission_busy[key] === true}
              onChange={(value) => void update_permission(key, value)}
            />,
          ),
        )}
      </SettingsSection>

      <SettingsSection title="Web and packages">
        {row(
          'ai-web-site-guard',
          'Per-site web guard',
          'Require site approval before the agent ingests web content from a new domain.',
          <SettingsToggle
            checked={platform_settings.agent_web_site_guard !== false}
            onChange={(value) => update_platform_settings({ agent_web_site_guard: value })}
          />,
        )}
        {row(
          'ai-package-guard',
          'Package installation guard',
          'Require approval before pip/npm/cargo and other dependency installation commands.',
          <SettingsToggle
            checked={platform_settings.agent_package_install_guard !== false}
            onChange={(value) => update_platform_settings({ agent_package_install_guard: value })}
          />,
        )}
        {row(
          'ai-package-venv',
          'Require project Python environment',
          'Prefer a project-local .venv instead of allowing raw system/global pip installs.',
          <SettingsToggle
            checked={platform_settings.agent_package_require_venv !== false}
            onChange={(value) => update_platform_settings({ agent_package_require_venv: value })}
          />,
        )}
      </SettingsSection>
    </>
  )

  const render_limits = () => (
    <>
      <SettingsSection title="Long-running sessions">
        {row(
          'ai-session-minutes',
          'Session duration budget',
          'Minutes an agent may work before the runtime asks whether to extend the current run.',
          <input
            className={`${input_class} w-28`}
            max={1440}
            min={1}
            onChange={(event) =>
              update_platform_settings({
                agent_session_minutes: Math.round(
                  clamp_number(event.target.value, 1, 1440, Number(platform_settings.agent_session_minutes || 15)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.agent_session_minutes || 15)}
          />,
        )}
        {row(
          'ai-cloud-budget',
          'Cloud request budget',
          'Shared remote-inference request ceiling across delegation, consultation, retries and synthesis.',
          <input
            className={`${input_class} w-28`}
            max={500}
            min={1}
            onChange={(event) =>
              update_platform_settings({
                agent_cloud_request_budget: Math.round(
                  clamp_number(event.target.value, 1, 500, Number(platform_settings.agent_cloud_request_budget || 50)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.agent_cloud_request_budget || 50)}
          />,
        )}
        {row(
          'ai-output-cap',
          'Heavy-work output token cap',
          '0 uses the tuned model default; non-zero values are clamped by the runtime to each model family ceiling.',
          <input
            className={`${input_class} w-32`}
            max={128000}
            min={0}
            onChange={(event) =>
              update_platform_settings({
                agent_max_output_tokens: Math.round(
                  clamp_number(event.target.value, 0, 128000, Number(platform_settings.agent_max_output_tokens || 0)),
                ),
              })
            }
            step={1024}
            type="number"
            value={Number(platform_settings.agent_max_output_tokens || 0)}
          />,
        )}
        {row(
          'ai-repeat-cap',
          'Repeated tool-call guard',
          'Maximum times the same normalized tool call may run in one session before it is blocked.',
          <input
            className={`${input_class} w-24`}
            max={50}
            min={1}
            onChange={(event) =>
              update_platform_settings({
                agent_tool_repeat_cap: Math.round(
                  clamp_number(event.target.value, 1, 50, Number(platform_settings.agent_tool_repeat_cap || 4)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.agent_tool_repeat_cap || 4)}
          />,
        )}
        {row(
          'ai-context-warning',
          'Context compaction threshold',
          'Warn/summarize when the remaining context fraction reaches this threshold.',
          <div className="flex items-center gap-2">
            <input
              className={`${input_class} w-24`}
              max={50}
              min={5}
              onChange={(event) =>
                update_platform_settings({
                  context_budget_warn_ratio:
                    clamp_number(
                      event.target.value,
                      5,
                      50,
                      Math.round(Number(platform_settings.context_budget_warn_ratio || 0.15) * 100),
                    ) / 100,
                })
              }
              type="number"
              value={Math.round(Number(platform_settings.context_budget_warn_ratio || 0.15) * 100)}
            />
            <span className="text-xs text-[var(--muted)]">%</span>
          </div>,
        )}
      </SettingsSection>
    </>
  )

  const render_skills = () => (
    <>
      <SettingsSection title="Skill runtime">
        {row(
          'ai-skills-enabled',
          'Enable agent skills',
          'Allow the runtime to select and load reusable IRIS skill instructions during agent work.',
          <SettingsToggle
            checked={platform_settings.skills_enabled !== false}
            onChange={(value) => update_platform_settings({ skills_enabled: value })}
          />,
        )}
        {row(
          'ai-skills-auto-switch',
          'Automatic skill profile',
          'Automatically derive the active skill profile from the configured provider and model family.',
          <SettingsToggle
            checked={platform_settings.skills_auto_switch !== false}
            onChange={(value) => update_platform_settings({ skills_auto_switch: value })}
          />,
        )}
        {row(
          'ai-skills-profile',
          'Manual skill profile',
          'Used only when automatic profile selection is disabled.',
          <input
            className={`${input_class} w-64 font-mono`}
            disabled={platform_settings.skills_auto_switch !== false}
            onChange={(event) => update_platform_settings({ skills_active_profile: event.target.value })}
            placeholder="default-model"
            value={String(platform_settings.skills_active_profile || '')}
          />,
        )}
      </SettingsSection>
      <SettingsSection title="Skill selection limits">
        {row(
          'ai-skills-token-budget',
          'Skill instruction token budget',
          'Maximum prompt budget reserved for progressively disclosed skill instructions.',
          <input
            className={`${input_class} w-28`}
            min={256}
            max={16000}
            onChange={(event) =>
              update_platform_settings({
                skills_token_budget: Math.round(
                  clamp_number(event.target.value, 256, 16000, Number(platform_settings.skills_token_budget || 2200)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.skills_token_budget || 2200)}
          />,
        )}
        {row(
          'ai-skills-max-active',
          'Maximum active skills',
          'Limit how many full skill instruction sets may be loaded into one agent context.',
          <input
            className={`${input_class} w-24`}
            min={1}
            max={20}
            onChange={(event) =>
              update_platform_settings({
                skills_max_active: Math.round(
                  clamp_number(event.target.value, 1, 20, Number(platform_settings.skills_max_active || 4)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.skills_max_active || 4)}
          />,
        )}
        {row(
          'ai-skills-relevance',
          'Minimum relevance score',
          'Only skills meeting this relevance threshold are eligible for automatic loading.',
          <input
            className={`${input_class} w-24`}
            min={0}
            max={20}
            onChange={(event) =>
              update_platform_settings({
                skills_min_relevance_score: Math.round(
                  clamp_number(event.target.value, 0, 20, Number(platform_settings.skills_min_relevance_score || 3)),
                ),
              })
            }
            type="number"
            value={Number(platform_settings.skills_min_relevance_score || 3)}
          />,
        )}
      </SettingsSection>
    </>
  )

  const render_semantic = () => {
    const status_label = semantic_status?.indexStatus || 'unknown'
    const sources_locked = semantic_status?.indexStatus === 'building' || semantic_status?.indexStatus === 'ready'
    const selected_source_ids = new Set(semantic_source_ids)

    return (
      <>
        <SettingsSection title="Semantic filesystem index">
          {row(
            'ai-semantic-status',
            'Index status',
            semantic_error ||
              semantic_status?.error ||
              'The semantic index is encrypted and remains separate from agent filesystem write authority.',
            <span className="text-xs capitalize text-[var(--text)]">
              {status_label}
              {semantic_status?.fileCount ? ` · ${semantic_status.fileCount.toLocaleString()} files` : ''}
            </span>,
          )}
          {row(
            'ai-semantic-models',
            'Embedding models',
            'Semantic text and media models are installed only after an explicit user action.',
            <div className="flex items-center gap-2">
              <span className="max-w-64 truncate text-[10px] text-[var(--muted)]">
                {semantic_status
                  ? `${semantic_status.embeddingModelInstalled ? 'Text ready' : 'Text missing'} · ${semantic_status.imageModelInstalled ? 'Image ready' : 'Image missing'}`
                  : 'Status unavailable'}
              </span>
              <button
                className="h-9 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"
                disabled={Boolean(semantic_busy)}
                onClick={() => void run_semantic_action('install', installFileSemanticModels)}
                type="button"
              >
                {semantic_busy === 'install' ? 'Installing…' : 'Install models'}
              </button>
            </div>,
          )}
        </SettingsSection>

        <SettingsSection title="Indexed locations">
          <div className="px-4 py-3 text-[10px] text-[var(--muted)]">
            Indexing a location allows semantic discovery only; it does not grant the agent permission to modify that
            location.
          </div>
          {semantic_sources.length ? (
            semantic_sources.map((source) => (
              <label
                className={`flex min-h-11 items-center gap-3 rounded-lg px-4 py-2 ${
                  sources_locked || !source.available
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer hover:bg-[var(--hover)]'
                }`}
                key={source.id}
              >
                <input
                  checked={source.alwaysSelected || selected_source_ids.has(source.id)}
                  disabled={sources_locked || source.alwaysSelected || !source.available}
                  onChange={(event) => {
                    set_semantic_preflight(null)
                    set_semantic_source_ids((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(source.id)
                      else next.delete(source.id)
                      return Array.from(next)
                    })
                  }}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-[var(--text)]">{source.label}</div>
                  <div className="truncate font-mono text-[9px] text-[var(--muted)]">{source.path}</div>
                </div>
                <span className="text-[9px] uppercase text-[var(--muted)]">{source.kind}</span>
              </label>
            ))
          ) : (
            <div className="px-4 py-6 text-center text-[11px] text-[var(--muted)]">
              {platform_settings.permissions_file_read
                ? 'No index locations are currently available.'
                : 'Enable Read workspace files under Autonomy before configuring semantic locations.'}
            </div>
          )}
        </SettingsSection>

        {semantic_preflight?.requiresConfirmation ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[11px] text-amber-200">
            <div className="font-medium">Large semantic index confirmation required</div>
            <div className="mt-1 opacity-80">
              Preflight found {semantic_preflight.fileCount.toLocaleString()} eligible files. Building this index can
              take significant time and local compute.
            </div>
            <button
              className="mt-3 h-9 rounded-md border border-amber-400/40 px-3 text-xs hover:bg-amber-500/10 disabled:opacity-40"
              disabled={Boolean(semantic_busy)}
              onClick={() =>
                void run_semantic_action('rebuild', () => rebuildFileSemanticIndex(true, semantic_source_ids))
              }
              type="button"
            >
              Build large index
            </button>
          </div>
        ) : null}

        <SettingsSection title="Index maintenance">
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <button
              className="h-9 rounded-md border border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
              disabled={Boolean(semantic_busy) || semantic_status?.indexStatus === 'building'}
              onClick={() => void preflight_semantic_index()}
              type="button"
            >
              {semantic_busy === 'preflight'
                ? 'Checking…'
                : semantic_status?.indexStatus === 'ready'
                  ? 'Rebuild index'
                  : 'Build index'}
            </button>
            <button
              className="h-9 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"
              disabled={Boolean(semantic_busy) || semantic_status?.indexStatus !== 'ready'}
              onClick={() => void run_semantic_action('rescan', rescanFileSemanticIndex)}
              type="button"
            >
              {semantic_busy === 'rescan' ? 'Refreshing…' : 'Refresh changed files'}
            </button>
            {semantic_status?.indexStatus === 'building' ? (
              <button
                className="h-9 rounded-md border border-amber-500/30 px-3 text-xs text-amber-300 hover:bg-amber-500/10"
                onClick={() => void run_semantic_action('cancel', cancelFileSemanticIndex)}
                type="button"
              >
                Cancel indexing
              </button>
            ) : null}
            <button
              className="h-9 rounded-md border border-red-500/25 px-3 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
              disabled={
                Boolean(semantic_busy) ||
                semantic_status?.indexStatus === 'building' ||
                semantic_status?.indexStatus === 'missing'
              }
              onClick={() => {
                if (window.confirm('Delete the encrypted semantic file index? Source files will not be changed.')) {
                  void run_semantic_action('clear', clearFileSemanticIndex)
                }
              }}
              type="button"
            >
              {semantic_busy === 'clear' ? 'Clearing…' : 'Clear index'}
            </button>
          </div>
          {semantic_status?.indexStatus === 'building' ? (
            <div className="px-4 pb-3 text-[10px] text-[var(--muted)]">
              {semantic_status.stage || 'Indexing'}
              {semantic_status.total ? ` · ${semantic_status.completed || 0}/${semantic_status.total}` : ''}
            </div>
          ) : null}
        </SettingsSection>
      </>
    )
  }

  let content: React.ReactNode
  if (active_section === 'providers') content = render_providers()
  else if (active_section === 'models') content = render_models()
  else if (active_section === 'agents') content = render_agents()
  else if (active_section === 'routing') content = render_routing()
  else if (active_section === 'autonomy') content = render_autonomy()
  else if (active_section === 'limits') content = render_limits()
  else if (active_section === 'skills') content = render_skills()
  else content = render_semantic()

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-black/[0.04] p-1">
        {ai_settings_sections.map((section) => (
          <button
            aria-current={active_section === section.id ? 'page' : undefined}
            className={`rounded-lg px-3 py-2 text-[11px] transition ${
              active_section === section.id
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
