/**
 * Owns renderer state that belongs to the desktop orb shell, including minimized mode,
 * menus, hover state, and native window requests. It hides Electron-specific details so the
 * same renderer can still operate in a normal browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { isDesktopShellMode } from '@/platform/runtimeMode'

export type OrbState = 'idle' | 'listening' | 'processing' | 'error' | 'connected' | string

export interface OrbPosition {
  x: number
  y: number
}

export interface OrbShellContextValue {
  orbState: OrbState
  setOrbState: Dispatch<SetStateAction<OrbState>>
  isPillsVisible: boolean
  showPills: () => void
  hidePills: (delay?: number) => void
  keepPillsVisible: () => void
  isMinimized: boolean
  setIsMinimized: Dispatch<SetStateAction<boolean>>
  isFullWindow: boolean
  setIsFullWindow: Dispatch<SetStateAction<boolean>>
  position: OrbPosition
  setPosition: Dispatch<SetStateAction<OrbPosition>>
  isPinned: boolean
  setIsPinned: Dispatch<SetStateAction<boolean>>
  /** Internal cross-context action used when opening a panel. */
  dismissPills: () => void
}

const OrbShellContext = createContext<OrbShellContextValue | null>(null)

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

// Coordinates orb shell state and side effects for the React feature that consumes this hook.
export function useOrbShell(): OrbShellContextValue {
  const context = useContext(OrbShellContext)
  if (!context) throw new Error('useOrbShell must be used within OrbProvider')
  return context
}
