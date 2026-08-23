/**
 * Owns the clipboard state shared by orb and panel components. The context centralizes
 * lifecycle and updates so consumers observe one source of truth.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface ClipboardContextValue {
  clipboardHistory: string[]
  addToClipboard: (text: string) => void
}

const ClipboardContext = createContext<ClipboardContextValue | null>(null)

export interface ClipboardProviderProps {
  children: ReactNode
}

// Provides clipboard state and actions to descendant renderer components.
export function ClipboardProvider({ children }: ClipboardProviderProps): React.JSX.Element {
  const [clipboardHistory, setClipboardHistory] = useState<string[]>([])

  const addToClipboard = useCallback((text: string): void => {
    setClipboardHistory((previous) => [text, ...previous.filter((item) => item !== text)].slice(0, 50))
  }, [])

  const value = useMemo<ClipboardContextValue>(
    () => ({ clipboardHistory, addToClipboard }),
    [clipboardHistory, addToClipboard],
  )

  return <ClipboardContext.Provider value={value}>{children}</ClipboardContext.Provider>
}

// Coordinates clipboard history state and side effects for the React feature that consumes this
// hook.
export function useClipboardHistory(): ClipboardContextValue {
  const context = useContext(ClipboardContext)
  if (!context) throw new Error('useClipboardHistory must be used within OrbProvider')
  return context
}
