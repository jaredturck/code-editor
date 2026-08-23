/**
 * Detects whether the renderer is running in a normal browser, the compact Electron orb,
 * the independent workspace, or the dedicated editor window.
 */

import { canControlDesktopWindow } from '@/platform/desktopShellWindow'

export type RuntimeWindowRole = 'browser' | 'combined' | 'orb' | 'workspace' | 'editor'

export function isDesktopShellMode(): boolean {
  if (typeof window === 'undefined') return false
  if (canControlDesktopWindow()) return true

  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('desktopShell') === '1'
  } catch {
    return false
  }
}

export function getRuntimeWindowRole(): RuntimeWindowRole {
  if (typeof window === 'undefined') return 'browser'

  const preloadRole = window.orbitDesktop?.windowRole
  if (preloadRole === 'orb' || preloadRole === 'workspace' || preloadRole === 'editor') {
    return preloadRole
  }

  try {
    const params = new URLSearchParams(window.location.search)
    const queryRole = params.get('windowRole')
    if (queryRole === 'orb' || queryRole === 'workspace' || queryRole === 'editor') {
      return queryRole
    }
    if (params.get('desktopShell') === '1') return 'combined'
  } catch {
    /* browser fallback below */
  }

  return 'browser'
}

export function isDesktopOrbWindow(): boolean {
  return isDesktopShellMode() && getRuntimeWindowRole() === 'orb'
}

export function isDesktopWorkspaceWindow(): boolean {
  return isDesktopShellMode() && getRuntimeWindowRole() === 'workspace'
}

export function isDesktopEditorWindow(): boolean {
  return isDesktopShellMode() && getRuntimeWindowRole() === 'editor'
}
