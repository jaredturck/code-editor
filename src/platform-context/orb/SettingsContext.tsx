/**
 * Owns the normalized application settings object and persists changes through the renderer
 * store and bridge mirror. Consumers read this context instead of inventing local defaults,
 * which preserves compatibility with older or partially populated settings.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  buildBridgePermissionState,
  buildPersistentPermissionPatch,
  readOrbSettings,
  subscribeSettingsChanged,
  writeOrbSettings,
  type OrbSettings,
  type PersistentPermissionKey,
} from '@/platform/settingsStorage';
import { resolveActiveSkillProfile } from '@/platform/skillProfiles';
import { ORB_ACCENT_PRESETS, normalizeOrbTheme, resolveAccentName } from '@/platform/orbAppearance';

export type SettingsPatch = Partial<OrbSettings>;
export type SettingsUpdater = SettingsPatch | ((previous: OrbSettings) => SettingsPatch);

export interface OrbSettingsContextValue {
  settings: OrbSettings;
  updateSettings: (updates: SettingsUpdater) => void;
  grantPermissions: (
    permissionKeys: PersistentPermissionKey | PersistentPermissionKey[],
  ) => Promise<OrbSettings>;
}

const OrbSettingsContext = createContext<OrbSettingsContextValue | null>(null);

export interface OrbSettingsProviderProps {
  children: ReactNode;
}

// Provides orb settings state and actions to descendant renderer components.
export function OrbSettingsProvider({ children }: OrbSettingsProviderProps): React.JSX.Element {
  const [settings, setSettings] = useState<OrbSettings>(readOrbSettings);
  const settingsRef = useRef(settings);
  const settingsChannelRef = useRef<BroadcastChannel | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const applyIncomingSettings = (incoming?: OrbSettings): void => {
      const next = incoming && typeof incoming === 'object' ? incoming : readOrbSettings();
      settingsRef.current = next;
      setSettings(next);
    };
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== 'iris_settings') return;
      applyIncomingSettings();
    };
    const handleSettingsEvent = (event: Event): void => {
      applyIncomingSettings((event as CustomEvent<OrbSettings>).detail);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('iris:settings-updated', handleSettingsEvent);

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('orbit-settings');
      settingsChannelRef.current = channel;
      channel.onmessage = (event) => applyIncomingSettings(event.data as OrbSettings);
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('iris:settings-updated', handleSettingsEvent);
      settingsChannelRef.current?.close();
      settingsChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const theme = normalizeOrbTheme(settings.appearance_theme);
    const accentName = resolveAccentName(theme, settings.appearance_accent);
    const accent = ORB_ACCENT_PRESETS[accentName];
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accentName;
    root.style.setProperty('--iris-accent', accent.main);
    root.style.setProperty('--iris-accent-soft', accent.soft);
    root.style.setProperty('--iris-accent-rgb', accent.rgb);
    root.style.setProperty('--iris-accent-secondary', accent.secondary);
    root.style.setProperty('--iris-blue', accent.main);
    root.style.setProperty('--iris-purple', accent.secondary);
  }, [settings.appearance_accent, settings.appearance_theme]);

  useEffect(() => {
    const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions;
    if (!updateBridgePermissions) return;

    // The packaged bridge starts fail-closed and receives only capabilities that the user
    // has explicitly granted. Launcher access follows terminal access because both can start
    // local programs; live desktop control follows the mouse-control permission.
    void updateBridgePermissions(buildBridgePermissionState(settings)).catch(() => {
      // A failed desktop security bridge is surfaced by the fail-closed storage startup.
    });
  }, [
    settings.permissions_file_read,
    settings.permissions_file_write,
    settings.permissions_terminal,
    settings.permissions_mouse_control,
    settings.permissions_microphone,
  ]);

  useEffect(() => {
    if (!settings.skills_enabled || settings.skills_auto_switch === false) return;

    const resolvedProfile = resolveActiveSkillProfile(settings);
    if (!resolvedProfile || settings.skills_active_profile === resolvedProfile) return;

    setSettings((previous) => {
      if (previous.skills_active_profile === resolvedProfile) return previous;
      const next: OrbSettings = {
        ...previous,
        skills_active_profile: resolvedProfile,
      };
      writeOrbSettings(next);
      return next;
    });
  }, [
    settings.ai_provider,
    settings.ai_model,
    settings.skills_enabled,
    settings.skills_auto_switch,
    settings.skills_active_profile,
  ]);

  const updateSettings = useCallback((updates: SettingsUpdater): void => {
    setSettings((previous) => {
      const patch = typeof updates === 'function' ? updates(previous) : updates;
      if (!patch || typeof patch !== 'object') return previous;

      const hasChanges = Object.entries(patch).some(
        ([key, value]) => !Object.is(previous[key], value),
      );
      if (!hasChanges) return previous;

      // writeOrbSettings normalizes (e.g. syncs the active model to the orchestrator's primary)
      // and persists; it returns the canonical object so the live state — and the broadcast
      // below — match exactly what was written to disk. Fall back to the merged patch if a write
      // ever returns nothing, so the provider never blows live settings away to undefined.
      const merged = { ...previous, ...patch } as OrbSettings;
      const next = (writeOrbSettings(merged) || merged) as OrbSettings;
      settingsRef.current = next;
      settingsChannelRef.current?.postMessage(next);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: next }));
      }
      return next;
    });
  }, []);

  const grantPermissions = useCallback(
    async (
      permissionKeys: PersistentPermissionKey | PersistentPermissionKey[],
    ): Promise<OrbSettings> => {
      const patch = buildPersistentPermissionPatch(permissionKeys);
      if (!Object.keys(patch).length) return settingsRef.current;

      const next = { ...settingsRef.current, ...patch } as OrbSettings;
      const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions;
      if (updateBridgePermissions) {
        const result = await updateBridgePermissions(buildBridgePermissionState(next));
        if (result && result.ok === false) {
          throw new Error(result.error || 'IRIS could not enable the requested permission.');
        }
      }

      settingsRef.current = next;
      writeOrbSettings(next);
      settingsChannelRef.current?.postMessage(next);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: next }));
      }
      setSettings(next);
      return next;
    },
    [],
  );

  const value = useMemo<OrbSettingsContextValue>(
    () => ({ settings, updateSettings, grantPermissions }),
    [grantPermissions, settings, updateSettings],
  );

  return <OrbSettingsContext.Provider value={value}>{children}</OrbSettingsContext.Provider>;
}

function useStandaloneOrbSettings(): OrbSettingsContextValue {
  const [settings, setSettings] = useState<OrbSettings>(readOrbSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => subscribeSettingsChanged(setSettings), []);

  const updateSettings = useCallback((updates: SettingsUpdater): void => {
    const previous = settingsRef.current;
    const patch = typeof updates === 'function' ? updates(previous) : updates;
    if (!patch || typeof patch !== 'object') return;
    const next = writeOrbSettings({ ...previous, ...patch });
    settingsRef.current = next;
    setSettings(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: next }));
    }
  }, []);

  const grantPermissions = useCallback(
    async (
      permissionKeys: PersistentPermissionKey | PersistentPermissionKey[],
    ): Promise<OrbSettings> => {
      const patch = buildPersistentPermissionPatch(permissionKeys);
      if (!Object.keys(patch).length) return settingsRef.current;

      const next = { ...settingsRef.current, ...patch } as OrbSettings;
      const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions;
      if (!updateBridgePermissions) {
        throw new Error('The trusted desktop permission bridge is unavailable.');
      }
      const result = await updateBridgePermissions(buildBridgePermissionState(next));
      if (result?.ok === false) {
        throw new Error(result.error || 'IRIS could not enable the requested permission.');
      }

      const saved = writeOrbSettings(next);
      settingsRef.current = saved;
      setSettings(saved);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('iris:settings-updated', { detail: saved }));
      }
      return saved;
    },
    [],
  );

  return useMemo(
    () => ({ settings, updateSettings, grantPermissions }),
    [grantPermissions, settings, updateSettings],
  );
}

// Coordinates agent settings state for both provider-backed IRIS surfaces and Code Editor
// integration points that deliberately do not mount the old IRIS application shell.
export function useOrbSettings(): OrbSettingsContextValue {
  const context = useContext(OrbSettingsContext);
  const standalone = useStandaloneOrbSettings();
  return context || standalone;
}
