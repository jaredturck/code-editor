/**
 * Exercises the observable desktop shell window contract, with regression cases for
 * “reports no control without a desktop bridge” and “moves the native window through the
 * preload bridge”. The suite documents caller-visible behavior so implementation refactors
 * cannot silently weaken those guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canControlDesktopWindow,
  finishDesktopLauncherDrag,
  getDesktopScreenSources,
  hideDesktopWindow,
  hasDesktopBridge,
  minimizeDesktopWindow,
  notifyDesktopWorkspaceReady,
  onDesktopWorkspacePanel,
  openDesktopEditorWindow,
  openDesktopWorkspacePanel,
  moveDesktopWindowBy,
  resizeDesktopWindow,
  setDesktopLauncherExpanded,
  setDesktopWindowMode,
} from '@/platform/desktopShellWindow'

describe('desktopShellWindow', () => {
  beforeEach(() => {
    delete window.orbitDesktop
  })

  it('reports no control without a desktop bridge', () => {
    expect(canControlDesktopWindow()).toBe(false)
  })

  it('moves the native window through the preload bridge', () => {
    const moveWindowBy = vi.fn()
    window.orbitDesktop = { isDesktopShell: true, moveWindowBy }
    moveDesktopWindowBy(12, -4)
    expect(moveWindowBy).toHaveBeenCalledWith(12, -4)
  })

  it('finishes launcher dragging through the preload bridge', async () => {
    const result = {
      mode: 'collapsed' as const,
      position: { x: -66, y: 494 },
      bounds: { x: 0, y: 580, width: 500, height: 500 },
    }
    const finishLauncherDrag = vi.fn().mockResolvedValue(result)
    window.orbitDesktop = { isDesktopShell: true, finishLauncherDrag }

    await expect(finishDesktopLauncherDrag(0, 1079)).resolves.toEqual(result)
    expect(finishLauncherDrag).toHaveBeenCalledWith(0, 1079)
  })

  it('minimizes the native window through the preload bridge', () => {
    const minimizeWindow = vi.fn()
    window.orbitDesktop = { isDesktopShell: true, minimizeWindow }
    minimizeDesktopWindow()
    expect(minimizeWindow).toHaveBeenCalledOnce()
  })

  it('resizes the workspace through the preload bridge', () => {
    const resizeWindow = vi.fn()
    window.orbitDesktop = { isDesktopShell: true, resizeWindow }
    const bounds = { x: 120, y: 80, width: 900, height: 640 }

    resizeDesktopWindow(bounds)

    expect(resizeWindow).toHaveBeenCalledWith(bounds)
  })

  it('updates the launcher shape through the preload bridge', async () => {
    const result = {
      mode: 'expanded' as const,
      position: { x: 214, y: 214 },
      bounds: { x: 100, y: 80, width: 500, height: 500 },
    }
    const setLauncherExpanded = vi.fn().mockResolvedValue(result)
    window.orbitDesktop = { isDesktopShell: true, setLauncherExpanded }
    const orbBounds = { x: 12, y: 12, width: 72, height: 72 }

    await expect(setDesktopLauncherExpanded(true, orbBounds)).resolves.toEqual(result)
    expect(setLauncherExpanded).toHaveBeenCalledWith(true, orbBounds)
  })

  it('returns null when launcher resizing is unavailable', async () => {
    window.orbitDesktop = { isDesktopShell: true }
    await expect(
      setDesktopLauncherExpanded(false, {
        x: 12,
        y: 12,
        width: 72,
        height: 72,
      }),
    ).resolves.toBeNull()
  })

  it('passes mode and anchor data to the preload bridge', async () => {
    const setWindowMode = vi.fn().mockResolvedValue({ width: 600, height: 500 })
    window.orbitDesktop = { isDesktopShell: true, setWindowMode }

    await expect(
      setDesktopWindowMode('expanded', {
        anchorX: 10,
        anchorY: 20,
        extraWidth: 30,
      }),
    ).resolves.toEqual({ width: 600, height: 500 })

    expect(setWindowMode).toHaveBeenCalledWith({
      mode: 'expanded',
      anchorX: 10,
      anchorY: 20,
      extraWidth: 30,
    })
  })

  it('returns null when desktop control is unavailable', async () => {
    await expect(setDesktopWindowMode('compact')).resolves.toBeUndefined()
  })

  it('returns null when the preload bridge rejects', async () => {
    window.orbitDesktop = {
      isDesktopShell: true,
      setWindowMode: vi.fn().mockRejectedValue(new Error('failed')),
    }
    await expect(setDesktopWindowMode('compact')).resolves.toBeNull()
  })

  it('reports and reads the desktop bridge through the renderer adapter', async () => {
    const getScreenSources = vi.fn().mockResolvedValue([{ id: 'screen:1', name: 'Screen 1' }])
    window.orbitDesktop = { getScreenSources }

    expect(hasDesktopBridge()).toBe(true)
    await expect(getDesktopScreenSources()).resolves.toEqual([{ id: 'screen:1', name: 'Screen 1' }])
    expect(getScreenSources).toHaveBeenCalledOnce()
  })

  it('returns null when desktop screen-source lookup fails', async () => {
    window.orbitDesktop = {
      getScreenSources: vi.fn().mockRejectedValue(new Error('failed')),
    }
    await expect(getDesktopScreenSources()).resolves.toBeNull()
  })
  it('opens panels in and hides the independent workspace through the preload bridge', () => {
    const openWorkspacePanel = vi.fn()
    const hideWindow = vi.fn()
    window.orbitDesktop = {
      isDesktopShell: true,
      openWorkspacePanel,
      hideWindow,
    }

    openDesktopWorkspacePanel('search')
    hideDesktopWindow()

    expect(openWorkspacePanel).toHaveBeenCalledWith('search')
    expect(hideWindow).toHaveBeenCalledOnce()
  })

  it('opens the independent editor window through the preload bridge', () => {
    const openEditorWindow = vi.fn()
    window.orbitDesktop = { isDesktopShell: true, openEditorWindow }

    openDesktopEditorWindow()

    expect(openEditorWindow).toHaveBeenCalledOnce()
  })

  it('notifies Electron after the workspace renderer has mounted', () => {
    const notifyWorkspaceReady = vi.fn()
    window.orbitDesktop = {
      isDesktopShell: true,
      notifyWorkspaceReady,
    }

    notifyDesktopWorkspaceReady()

    expect(notifyWorkspaceReady).toHaveBeenCalledOnce()
  })

  it('subscribes to workspace panel requests through the preload bridge', () => {
    const unsubscribe = vi.fn()
    const onWorkspacePanel = vi.fn().mockReturnValue(unsubscribe)
    const listener = vi.fn()
    window.orbitDesktop = { isDesktopShell: true, onWorkspacePanel }

    const cleanup = onDesktopWorkspacePanel(listener)
    expect(onWorkspacePanel).toHaveBeenCalledWith(listener)
    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
