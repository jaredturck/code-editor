/**
 * Verifies the floating orb hover and drag lifecycle so the native launcher expands only
 * while its controls are in use and remains compact while the orb is being repositioned.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showPills: vi.fn(),
  hidePills: vi.fn(),
  keepPillsVisible: vi.fn(),
  dismissPills: vi.fn(),
  openPanel: vi.fn(),
  setPosition: vi.fn(),
  isDesktopShellMode: vi.fn(() => false),
  isDesktopOrbWindow: vi.fn(() => false),
  moveDesktopWindowBy: vi.fn(),
  finishDesktopLauncherDrag: vi.fn(),
  setDesktopLauncherExpanded: vi.fn(),
  minimizeDesktopWindow: vi.fn(),
  isPillsVisible: false,
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbShell: () => ({
    orbState: 'idle',
    isPillsVisible: mocks.isPillsVisible,
    showPills: mocks.showPills,
    hidePills: mocks.hidePills,
    keepPillsVisible: mocks.keepPillsVisible,
    dismissPills: mocks.dismissPills,
    isMinimized: false,
    isFullWindow: false,
    position: { x: 46, y: 46 },
    setPosition: mocks.setPosition,
    isPinned: false,
  }),
  useOrbSettings: () => ({ settings: { orb_size: 'medium' } }),
  useAgentStatus: () => ({ agentStatus: { running: false } }),
  usePanels: () => ({ openPanel: mocks.openPanel }),
}))

vi.mock('@/platform/runtimeMode', () => ({
  isDesktopShellMode: mocks.isDesktopShellMode,
  isDesktopOrbWindow: mocks.isDesktopOrbWindow,
}))
vi.mock('@/platform/desktopShellWindow', () => ({
  moveDesktopWindowBy: mocks.moveDesktopWindowBy,
  finishDesktopLauncherDrag: mocks.finishDesktopLauncherDrag,
  setDesktopLauncherExpanded: mocks.setDesktopLauncherExpanded,
  minimizeDesktopWindow: mocks.minimizeDesktopWindow,
}))
vi.mock('@/components/orb/OrbPills', () => ({ default: () => <div /> }))
vi.mock('@/components/orb/OrbContextMenu', () => ({ default: () => null }))
vi.mock('@/components/orb/ParticleOrb', () => ({ default: () => <div /> }))

import FloatingOrb from '@/components/orb/FloatingOrb'

const launcherResult = {
  mode: 'expanded' as const,
  position: { x: 214, y: 214 },
  bounds: { x: 100, y: 100, width: 500, height: 500 },
}

describe('FloatingOrb hover navigation', () => {
  beforeEach(() => {
    mocks.isPillsVisible = false
    mocks.showPills.mockReset()
    mocks.hidePills.mockReset()
    mocks.keepPillsVisible.mockReset()
    mocks.dismissPills.mockReset()
    mocks.openPanel.mockReset()
    mocks.setPosition.mockReset()
    mocks.isDesktopShellMode.mockReset()
    mocks.isDesktopShellMode.mockReturnValue(false)
    mocks.isDesktopOrbWindow.mockReset()
    mocks.isDesktopOrbWindow.mockReturnValue(false)
    mocks.moveDesktopWindowBy.mockReset()
    mocks.finishDesktopLauncherDrag.mockReset()
    mocks.finishDesktopLauncherDrag.mockResolvedValue({
      mode: 'collapsed',
      position: { x: -66, y: 494 },
      bounds: { x: 0, y: 580, width: 500, height: 500 },
    })
    mocks.setDesktopLauncherExpanded.mockReset()
    mocks.minimizeDesktopWindow.mockReset()
    mocks.setDesktopLauncherExpanded.mockResolvedValue(launcherResult)
  })

  it('opens only from the orb and schedules hiding after leaving the complete region', async () => {
    render(<FloatingOrb />)
    const hoverRegion = screen.getByTestId('floating-orb-hover-region')
    const orbTrigger = screen.getByTestId('floating-orb-trigger')

    fireEvent.mouseEnter(hoverRegion)
    expect(mocks.keepPillsVisible).toHaveBeenCalledTimes(1)
    expect(mocks.showPills).not.toHaveBeenCalled()

    fireEvent.mouseEnter(orbTrigger)
    await waitFor(() => expect(mocks.showPills).toHaveBeenCalledTimes(1))

    fireEvent.mouseLeave(hoverRegion)
    expect(mocks.hidePills).toHaveBeenCalledWith(3000)
  })

  it('expands the native launcher before showing its radial controls', async () => {
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.isDesktopOrbWindow.mockReturnValue(true)
    render(<FloatingOrb />)

    await waitFor(() =>
      expect(mocks.setDesktopLauncherExpanded).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ width: 72, height: 72 }),
      ),
    )
    mocks.setDesktopLauncherExpanded.mockClear()

    fireEvent.mouseEnter(screen.getByTestId('floating-orb-trigger'))

    await waitFor(() =>
      expect(mocks.setDesktopLauncherExpanded).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ width: 72, height: 72 }),
      ),
    )
    expect(mocks.showPills).toHaveBeenCalledOnce()
    expect(mocks.setPosition).toHaveBeenCalled()
  })

  it('keeps the native canvas active while dragging and applies the returned tucked position', async () => {
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.isDesktopOrbWindow.mockReturnValue(true)
    render(<FloatingOrb />)

    await waitFor(() => expect(mocks.setDesktopLauncherExpanded).toHaveBeenCalled())
    mocks.setDesktopLauncherExpanded.mockClear()
    mocks.showPills.mockClear()

    const orbTrigger = screen.getByTestId('floating-orb-trigger')
    fireEvent.mouseDown(orbTrigger, {
      button: 0,
      clientX: 40,
      clientY: 40,
      screenX: 400,
      screenY: 300,
    })
    const dragLayer = await screen.findByTestId('floating-orb-drag-layer')
    fireEvent.mouseMove(dragLayer, {
      clientX: 52,
      clientY: 52,
      screenX: 412,
      screenY: 312,
      movementX: 12,
      movementY: 12,
    })

    expect(mocks.dismissPills).toHaveBeenCalledOnce()
    expect(mocks.setDesktopLauncherExpanded).not.toHaveBeenCalledWith(false, expect.anything())

    fireEvent.mouseUp(dragLayer, { screenX: 0, screenY: 1080 })
    expect(mocks.finishDesktopLauncherDrag).toHaveBeenCalledWith(0, 1080)
    await waitFor(() => expect(mocks.setPosition).toHaveBeenCalledWith({ x: -66, y: 494 }))
    await waitFor(() => expect(mocks.showPills).toHaveBeenCalled())
    expect(mocks.keepPillsVisible).toHaveBeenCalled()
    expect(mocks.setDesktopLauncherExpanded).toHaveBeenCalledWith(true, expect.anything())
  })

  it('hides visible radial controls on a single left click', () => {
    mocks.isPillsVisible = true
    render(<FloatingOrb />)

    const orbTrigger = screen.getByTestId('floating-orb-trigger')
    fireEvent.mouseDown(orbTrigger, { button: 0, clientX: 40, clientY: 40 })
    fireEvent.mouseUp(orbTrigger, { button: 0, clientX: 40, clientY: 40 })

    expect(mocks.dismissPills).toHaveBeenCalledOnce()
    expect(mocks.minimizeDesktopWindow).not.toHaveBeenCalled()
  })

  it('minimizes the native launcher on a double click without treating it as a drag', () => {
    mocks.isDesktopShellMode.mockReturnValue(true)
    mocks.isDesktopOrbWindow.mockReturnValue(true)
    render(<FloatingOrb />)

    const orbTrigger = screen.getByTestId('floating-orb-trigger')
    fireEvent.doubleClick(orbTrigger, { button: 0 })

    expect(mocks.dismissPills).toHaveBeenCalled()
    expect(mocks.minimizeDesktopWindow).toHaveBeenCalledOnce()
    expect(mocks.finishDesktopLauncherDrag).not.toHaveBeenCalled()
  })
})
