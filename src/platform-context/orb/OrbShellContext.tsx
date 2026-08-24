/**
 * Owns renderer state that belongs to the desktop orb shell, including minimized mode,
 * menus, hover state, and native window requests. It hides Electron-specific details so the
 * same renderer can still operate in a normal browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isDesktopShellMode } from '@/platform/runtimeMode'
import { OrbShellContext, type OrbPosition, type OrbShellContextValue, type OrbState } from './useOrbShell'

// Returns initial orb position without requiring callers to know where or how it is stored.
function getInitialOrbPosition(): OrbPosition {
  if (typeof window === 'undefined' || !isDesktopShellMode()) return { x: 80, y: 80 }

  const orbSize = 72
  const centerX = Math.round((window.innerWidth - orbSize) / 2)
  const centerY = Math.round((window.innerHeight - orbSize) / 2)
  return { x: Math.max(12, centerX), y: Math.max(12, centerY) }
}

export interface OrbShellProviderProps {
  children: ReactNode
}

// Provides orb shell state and actions to descendant renderer components.
export function OrbShellProvider({ children }: OrbShellProviderProps): React.JSX.Element {
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [isPillsVisible, setIsPillsVisible] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isFullWindow, setIsFullWindow] = useState(false)
  const [position, setPosition] = useState<OrbPosition>(getInitialOrbPosition)
  const [isPinned, setIsPinned] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPillHideTimer = useCallback((): void => {
    if (!hoverTimerRef.current) return
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  const showPills = useCallback((): void => {
    clearPillHideTimer()
    setIsPillsVisible(true)
  }, [clearPillHideTimer])

  const hidePills = useCallback(
    (delay = 0): void => {
      clearPillHideTimer()
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null
        setIsPillsVisible(false)
      }, delay)
    },
    [clearPillHideTimer],
  )

  const keepPillsVisible = useCallback((): void => {
    clearPillHideTimer()
  }, [clearPillHideTimer])

  const dismissPills = useCallback((): void => {
    clearPillHideTimer()
    setIsPillsVisible(false)
  }, [clearPillHideTimer])

  useEffect(() => clearPillHideTimer, [clearPillHideTimer])

  const value = useMemo<OrbShellContextValue>(
    () => ({
      orbState,
      setOrbState,
      isPillsVisible,
      showPills,
      hidePills,
      keepPillsVisible,
      isMinimized,
      setIsMinimized,
      isFullWindow,
      setIsFullWindow,
      position,
      setPosition,
      isPinned,
      setIsPinned,
      dismissPills,
    }),
    [
      orbState,
      isPillsVisible,
      showPills,
      hidePills,
      keepPillsVisible,
      isMinimized,
      isFullWindow,
      position,
      isPinned,
      dismissPills,
    ],
  )

  return <OrbShellContext.Provider value={value}>{children}</OrbShellContext.Provider>
}
