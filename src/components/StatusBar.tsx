import type { TextEditorDocument } from '../types/editor'

interface StatusBarProps {
  activeDocument: TextEditorDocument | null
  onToggleIndentation: () => void
  onToggleLanguage: () => void
}

function StatusBar({ activeDocument, onToggleIndentation, onToggleLanguage }: StatusBarProps) {
  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-end gap-1 border-t border-[var(--border)] bg-[var(--surface-1)] px-2 text-[11px] text-[var(--muted)]">
      {activeDocument && (
        <>
          <button
            className="h-full px-2 hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onToggleIndentation}
            type="button"
          >
            {activeDocument.indent_style === 'spaces' ? 'Spaces' : 'Tabs'}: {activeDocument.indent_size}
          </button>
          <span className="px-2">UTF-8</span>
          <button
            className="h-full min-w-20 px-2 text-left hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onToggleLanguage}
            type="button"
          >
            {activeDocument.language}
          </button>
        </>
      )}
    </footer>
  )
}

export default StatusBar
