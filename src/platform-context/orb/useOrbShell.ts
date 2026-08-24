import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'

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
  dismissPills: () => void
}

export const OrbShellContext = createContext<OrbShellContextValue | null>(null)

export function useOrbShell(): OrbShellContextValue {
  const context = useContext(OrbShellContext)
  if (!context) throw new Error('useOrbShell must be used within OrbProvider')
  return context
}
