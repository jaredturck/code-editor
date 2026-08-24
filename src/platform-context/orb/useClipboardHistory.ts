import { createContext, useContext } from 'react'

export interface ClipboardContextValue {
  clipboardHistory: string[]
  addToClipboard: (text: string) => void
}

export const ClipboardContext = createContext<ClipboardContextValue | null>(null)

export function useClipboardHistory(): ClipboardContextValue {
  const context = useContext(ClipboardContext)
  if (!context) throw new Error('useClipboardHistory must be used within OrbProvider')
  return context
}
