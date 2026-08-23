/**
 * Exercises desktop-shell detection and the stable renderer role used by the three-window
 * Electron architecture.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { getRuntimeWindowRole, isDesktopShellMode } from '@/platform/runtimeMode'

describe('runtimeMode', () => {
  beforeEach(() => {
    delete window.orbitDesktop
    window.history.replaceState({}, '', '/')
  })

  it('detects the Electron preload bridge', () => {
    window.orbitDesktop = { isDesktopShell: true }
    expect(isDesktopShellMode()).toBe(true)
  })

  it('rejects an incomplete preload bridge', () => {
    window.orbitDesktop = { isDesktopShell: false }
    expect(isDesktopShellMode()).toBe(false)
  })

  it('detects the desktopShell query parameter', () => {
    window.history.replaceState({}, '', '/?desktopShell=1')
    expect(isDesktopShellMode()).toBe(true)
    expect(getRuntimeWindowRole()).toBe('combined')
  })

  it('does not treat other query values as desktop mode', () => {
    window.history.replaceState({}, '', '/?desktopShell=0')
    expect(isDesktopShellMode()).toBe(false)
    expect(getRuntimeWindowRole()).toBe('browser')
  })

  it('prefers the stable preload role after browser navigation changes the URL', () => {
    window.history.replaceState({}, '', '/login')
    window.orbitDesktop = { isDesktopShell: true, windowRole: 'workspace' }
    expect(getRuntimeWindowRole()).toBe('workspace')
  })

  it('recognizes the dedicated editor renderer role', () => {
    window.history.replaceState({}, '', '/?desktopShell=1&windowRole=editor')
    expect(getRuntimeWindowRole()).toBe('editor')

    window.orbitDesktop = { isDesktopShell: true, windowRole: 'editor' }
    window.history.replaceState({}, '', '/')
    expect(getRuntimeWindowRole()).toBe('editor')
  })

  it('reads the launcher role from the desktop URL before preload is available', () => {
    window.history.replaceState({}, '', '/?desktopShell=1&windowRole=orb')
    expect(getRuntimeWindowRole()).toBe('orb')
  })
})
