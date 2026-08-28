import { useEffect } from 'react'

interface CopyContextMenuProps {
  x: number
  y: number
  value: string
  onClose: () => void
}

function CopyContextMenu({ x, y, value, onClose }: CopyContextMenuProps) {
  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handle_key_down)
    return () => window.removeEventListener('keydown', handle_key_down)
  }, [onClose])

  const menu_width = 120
  const menu_height = 38
  const left = Math.max(8, Math.min(x, window.innerWidth - menu_width - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - menu_height - 8))

  const copy = () => {
    window.editor_api.workspace.copy_text(value)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[300]"
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={onClose}
    >
      <div
        className="fixed min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
        style={{ left, top }}
      >
        <button
          className="flex h-7 w-full items-center rounded px-2 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]"
          onClick={copy}
          type="button"
        >
          Copy
        </button>
      </div>
    </div>
  )
}

export default CopyContextMenu
