import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBridgePermissionState,
  buildPersistentPermissionPatch,
  readOrbSettings,
  subscribeSettingsChanged,
  writeOrbSettings,
  type OrbSettings,
  type PersistentPermissionKey,
} from '@/platform/settingsStorage'

export type AgentSettings = OrbSettings
export type SettingsPatch = Partial<AgentSettings>
export type SettingsUpdater = SettingsPatch | ((previous: AgentSettings) => SettingsPatch)

export interface AgentSettingsContextValue {
  settings: AgentSettings
  updateSettings: (updates: SettingsUpdater) => void
  grantPermissions: (permissionKeys: PersistentPermissionKey | PersistentPermissionKey[]) => Promise<AgentSettings>
}

/**
 * Provides the live agent/platform settings used by Code Editor.
 *
 * The old IRIS provider layer was never mounted by Code Editor, so settings are intentionally
 * sourced from the shared persistent store and its module-level change subscription instead of
 * a presentation-specific React context.
 */
export function useAgentSettings(): AgentSettingsContextValue {
  const [settings, setSettings] = useState<AgentSettings>(readOrbSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => subscribeSettingsChanged(setSettings), [])

  const updateSettings = useCallback((updates: SettingsUpdater): void => {
    const previous = settingsRef.current
    const patch = typeof updates === 'function' ? updates(previous) : updates
    if (!patch || typeof patch !== 'object') return

    const next = writeOrbSettings({ ...previous, ...patch })
    settingsRef.current = next
    setSettings(next)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: next }))
    }
  }, [])

  const grantPermissions = useCallback(
    async (permissionKeys: PersistentPermissionKey | PersistentPermissionKey[]): Promise<AgentSettings> => {
      const patch = buildPersistentPermissionPatch(permissionKeys)
      if (!Object.keys(patch).length) return settingsRef.current

      const next = { ...settingsRef.current, ...patch } as AgentSettings
      const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions
      if (!updateBridgePermissions) {
        throw new Error('The trusted desktop permission bridge is unavailable.')
      }
      const result = await updateBridgePermissions(buildBridgePermissionState(next))
      if (result?.ok === false) {
        throw new Error(result.error || 'IRIS could not enable the requested permission.')
      }

      const saved = writeOrbSettings(next)
      settingsRef.current = saved
      setSettings(saved)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: saved }))
      }
      return saved
    },
    [],
  )

  return useMemo(() => ({ settings, updateSettings, grantPermissions }), [grantPermissions, settings, updateSettings])
}
