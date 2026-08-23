/**
 * Exercises the observable orb context contract, with regression cases for “exposes the
 * initial orb state” and “exposes focused hooks for each state area”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readOrbSettings: vi.fn(),
  writeOrbSettings: vi.fn(),
  isDesktopShellMode: vi.fn(),
  setDesktopWindowMode: vi.fn(),
  hideDesktopWindow: vi.fn(),
  openDesktopWorkspacePanel: vi.fn(),
  onDesktopWorkspacePanel: vi.fn<(listener: (panel: string) => void) => () => void>(() => () => {}),
  publishDesktopAgentStatus: vi.fn(),
  onDesktopAgentStatus: vi.fn<(listener: (status: { running: boolean; thinking: string }) => void) => () => void>(
    () => () => {},
  ),
  requestDesktopAgentStop: vi.fn(),
  onDesktopAgentStopRequest: vi.fn<(listener: () => void) => () => void>(() => () => {}),
  getRuntimeWindowRole: vi.fn(),
  isDesktopOrbWindow: vi.fn(),
  isDesktopWorkspaceWindow: vi.fn(),
  resolveActiveSkillProfile: vi.fn(),
  updateBridgePermissions: vi.fn(),
}))

vi.mock('@/platform/settingsStorage', () => ({
  readOrbSettings: mocks.readOrbSettings,
  writeOrbSettings: mocks.writeOrbSettings,
  buildPersistentPermissionPatch: (keys: string | string[]) => {
    const values = Array.isArray(keys) ? keys : [keys]
    return {
      ...(values.includes('file_read') ? { permissions_file_read: true } : {}),
      ...(values.includes('microphone') ? { permissions_microphone: true } : {}),
    }
  },
  buildBridgePermissionState: (settings: Record<string, unknown>) => ({
    fileRead: settings.permissions_file_read === true,
    fileWrite: settings.permissions_file_write === true,
    terminal: settings.permissions_terminal === true,
    launcher: settings.permissions_terminal === true,
    automation: settings.permissions_mouse_control === true,
    microphone: settings.permissions_microphone === true,
  }),
}))
vi.mock('@/platform/runtimeMode', () => ({
  isDesktopShellMode: mocks.isDesktopShellMode,
  getRuntimeWindowRole: mocks.getRuntimeWindowRole,
  isDesktopOrbWindow: mocks.isDesktopOrbWindow,
  isDesktopWorkspaceWindow: mocks.isDesktopWorkspaceWindow,
}))
vi.mock('@/platform/desktopShellWindow', () => ({
  setDesktopWindowMode: mocks.setDesktopWindowMode,
  hideDesktopWindow: mocks.hideDesktopWindow,
  openDesktopWorkspacePanel: mocks.openDesktopWorkspacePanel,
  onDesktopWorkspacePanel: mocks.onDesktopWorkspacePanel,
  publishDesktopAgentStatus: mocks.publishDesktopAgentStatus,
  onDesktopAgentStatus: mocks.onDesktopAgentStatus,
  requestDesktopAgentStop: mocks.requestDesktopAgentStop,
  onDesktopAgentStopRequest: mocks.onDesktopAgentStopRequest,
}))
vi.mock('@/platform/skillProfiles', () => ({
  resolveActiveSkillProfile: mocks.resolveActiveSkillProfile,
}))

import {
  OrbProvider,
  useAgentStatus,
  useClipboardHistory,
  useOrb,
  useOrbSettings,
  useOrbShell,
  usePanels,
} from '@/platform-context/AgentSettingsContext'

function wrapper({ children }: React.PropsWithChildren) {
  return <OrbProvider>{children}</OrbProvider>
}

describe('OrbContext', () => {
  beforeEach(() => {
    mocks.readOrbSettings.mockReturnValue({
      orb_size: 'medium',
      skills_enabled: false,
      skills_auto_switch: true,
      skills_active_profile: 'default',
    })
    mocks.writeOrbSettings.mockReset()
    mocks.isDesktopShellMode.mockReturnValue(false)
    mocks.getRuntimeWindowRole.mockReturnValue('browser')
    mocks.isDesktopOrbWindow.mockReturnValue(false)
    mocks.isDesktopWorkspaceWindow.mockReturnValue(false)
    mocks.setDesktopWindowMode.mockReset()
    mocks.hideDesktopWindow.mockReset()
    mocks.openDesktopWorkspacePanel.mockReset()
    mocks.onDesktopWorkspacePanel.mockReset()
    mocks.onDesktopWorkspacePanel.mockReturnValue(() => {})
    mocks.publishDesktopAgentStatus.mockReset()
    mocks.onDesktopAgentStatus.mockReset()
    mocks.onDesktopAgentStatus.mockReturnValue(() => {})
    mocks.requestDesktopAgentStop.mockReset()
    mocks.onDesktopAgentStopRequest.mockReset()
    mocks.onDesktopAgentStopRequest.mockReturnValue(() => {})
    mocks.resolveActiveSkillProfile.mockReturnValue('default')
    mocks.updateBridgePermissions.mockReset().mockResolvedValue({ ok: true })
    window.orbitDesktop = {
      ...(window.orbitDesktop || {}),
      security: {
        getBridgePermissions: vi.fn().mockResolvedValue({ ok: true }),
        updateBridgePermissions: mocks.updateBridgePermissions,
      },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('exposes the initial orb state', () => {
    const { result } = renderHook(() => useOrb(), { wrapper })
    expect(result.current.orbState).toBe('idle')
    expect(result.current.activePanel).toBeNull()
    expect(result.current.position).toEqual({ x: 80, y: 80 })
  })

  it('exposes focused hooks for each state area', () => {
    const { result } = renderHook(
      () => ({
        shell: useOrbShell(),
        panels: usePanels(),
        settings: useOrbSettings(),
        agent: useAgentStatus(),
        clipboard: useClipboardHistory(),
      }),
      { wrapper },
    )

    expect(result.current.shell.orbState).toBe('idle')
    expect(result.current.panels.activePanel).toBeNull()
    expect(result.current.settings.settings.orb_size).toBe('medium')
    expect(result.current.agent.agentStatus.running).toBe(false)
    expect(result.current.clipboard.clipboardHistory).toEqual([])
  })

  it('opens and closes panels while hiding the pills', () => {
    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => result.current.showPills())
    expect(result.current.isPillsVisible).toBe(true)
    act(() => result.current.openPanel('chat'))
    expect(result.current.activePanel).toBe('chat')
    expect(result.current.isPillsVisible).toBe(false)
    act(() => result.current.closePanel())
    expect(result.current.activePanel).toBeNull()
  })

  it('delays pill hiding by the requested duration', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => result.current.showPills())
    act(() => result.current.hidePills(100))
    expect(result.current.isPillsVisible).toBe(true)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.isPillsVisible).toBe(false)
  })

  it('cancels a pending pill hide when the hover region is entered again', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => result.current.showPills())
    act(() => result.current.hidePills(3000))
    act(() => vi.advanceTimersByTime(1500))
    act(() => result.current.showPills())
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.isPillsVisible).toBe(true)
  })

  it('persists changed settings but ignores identical updates', () => {
    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => result.current.updateSettings({ orb_size: 'large' }))
    expect(result.current.settings.orb_size).toBe('large')
    expect(mocks.writeOrbSettings).toHaveBeenCalledWith(expect.objectContaining({ orb_size: 'large' }))

    mocks.writeOrbSettings.mockClear()
    act(() => result.current.updateSettings({ orb_size: 'large' }))
    expect(mocks.writeOrbSettings).not.toHaveBeenCalled()
  })

  it('persists contextual permission grants after synchronizing the desktop bridge', async () => {
    const { result } = renderHook(() => useOrbSettings(), { wrapper })

    await act(async () => {
      await result.current.grantPermissions('file_read')
    })

    expect(mocks.updateBridgePermissions).toHaveBeenCalledWith(expect.objectContaining({ fileRead: true }))
    expect(result.current.settings.permissions_file_read).toBe(true)
    expect(mocks.writeOrbSettings).toHaveBeenCalledWith(expect.objectContaining({ permissions_file_read: true }))
  })

  it('deduplicates clipboard history', () => {
    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => result.current.addToClipboard('npm run dev'))
    expect(result.current.clipboardHistory[0]).toBe('npm run dev')
    expect(result.current.clipboardHistory.filter((item) => item === 'npm run dev')).toHaveLength(1)
  })

  it('synchronizes desktop window mode when running in Electron', () => {
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.getRuntimeWindowRole.mockReturnValue('combined')
    const { result } = renderHook(() => useOrb(), { wrapper })
    expect(mocks.setDesktopWindowMode).toHaveBeenCalledWith('compact', expect.any(Object))
    act(() => result.current.openPanel('chat'))
    expect(mocks.setDesktopWindowMode).toHaveBeenLastCalledWith('expanded', expect.any(Object))
  })

  it('auto-switches and persists the active skill profile', () => {
    mocks.readOrbSettings.mockReturnValue({
      orb_size: 'medium',
      skills_enabled: true,
      skills_auto_switch: true,
      skills_active_profile: 'old',
    })
    mocks.resolveActiveSkillProfile.mockReturnValue('new-profile')
    const { result } = renderHook(() => useOrb(), { wrapper })
    expect(result.current.settings.skills_active_profile).toBe('new-profile')
    expect(mocks.writeOrbSettings).toHaveBeenCalledWith(
      expect.objectContaining({ skills_active_profile: 'new-profile' }),
    )
  })

  it('forwards launcher panel requests to the independent workspace', () => {
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.getRuntimeWindowRole.mockReturnValue('orb')
    mocks.isDesktopOrbWindow.mockReturnValue(true)
    const { result } = renderHook(() => useOrb(), { wrapper })

    act(() => result.current.openPanel('search'))

    expect(mocks.openDesktopWorkspacePanel).toHaveBeenCalledWith('search')
    expect(result.current.activePanel).toBeNull()
  })

  it('opens requested panels in the workspace and hides it after the last panel closes', () => {
    let openWorkspacePanel: ((panel: string) => void) | null = null
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.getRuntimeWindowRole.mockReturnValue('workspace')
    mocks.isDesktopWorkspaceWindow.mockReturnValue(true)
    mocks.onDesktopWorkspacePanel.mockImplementation((listener: (panel: string) => void) => {
      openWorkspacePanel = listener
      return () => {}
    })

    const { result } = renderHook(() => useOrb(), { wrapper })
    act(() => openWorkspacePanel?.('notes'))
    expect(result.current.activePanel).toBe('notes')

    act(() => result.current.closePanel('notes'))
    expect(result.current.activePanel).toBeNull()
    expect(mocks.hideDesktopWindow).toHaveBeenCalledOnce()
  })

  it('requires the provider', () => {
    expect(() => renderHook(() => useOrb())).toThrow('useOrb must be used within OrbProvider')
  })
})
