import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBridgePermissionState,
  buildPersistentPermissionPatch,
  readOrbSettings,
  subscribeSettingsChanged,
  writeOrbSettings,
  type OrbSettings,
  type PersistentPermissionKey,
} from '@/platform/settingsStorage'
export type SettingsPatch = Partial<OrbSettings>
export type SettingsUpdater = SettingsPatch | ((previous: OrbSettings) => SettingsPatch)

export interface OrbSettingsContextValue {
  settings: OrbSettings
  updateSettings: (updates: SettingsUpdater) => void
  grantPermissions: (permissionKeys: PersistentPermissionKey | PersistentPermissionKey[]) => Promise<OrbSettings>
}

export const OrbSettingsContext = createContext<OrbSettingsContextValue | null>(null)

function useStandaloneOrbSettings(): OrbSettingsContextValue {
  const [settings, setSettings] = useState<OrbSettings>(readOrbSettings)
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
    async (permissionKeys: PersistentPermissionKey | PersistentPermissionKey[]): Promise<OrbSettings> => {
      const patch = buildPersistentPermissionPatch(permissionKeys)
      if (!Object.keys(patch).length) return settingsRef.current

      const next = { ...settingsRef.current, ...patch } as OrbSettings
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

export function useOrbSettings(): OrbSettingsContextValue {
  const context = useContext(OrbSettingsContext)
  const standalone = useStandaloneOrbSettings()
  return context || standalone
}
