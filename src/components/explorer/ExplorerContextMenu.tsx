import type { WorkspaceClipboardState, WorkspaceNode } from '../../types/workspace'
import { MenuItem, MenuSeparator } from '../MenuDropdown'

interface ExplorerContextMenuProps {
  clipboard: WorkspaceClipboardState | null
  rootPath: string
  target: WorkspaceNode | null
  x: number
  y: number
  onClose: () => void
  onCopyPath: (target_path: string, relative: boolean) => void
  onCreate: (kind: 'file' | 'directory') => void
  onCutCopy: (operation: 'cut' | 'copy') => void
  onDelete: () => void
  onPaste: () => void
  onRename: () => void
  onReveal: () => void
}

function ExplorerContextMenu({
  clipboard,
  rootPath,
  target,
  x,
  y,
  onClose,
  onCopyPath,
  onCreate,
  onCutCopy,
  onDelete,
  onPaste,
  onRename,
  onReveal,
}: ExplorerContextMenuProps) {
  const target_path = target?.path ?? rootPath
  const root_selected = target_path === rootPath

  return (
    <>
      <button aria-label="Close Explorer menu" className="fixed inset-0 z-[290]" onClick={onClose} type="button" />
      <div
        className="fixed z-[300] min-w-56 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-1 shadow-2xl"
        onContextMenu={(event) => event.preventDefault()}
        style={{ left: x, top: y }}
      >
        <MenuItem onClick={() => onCreate('file')}>New File</MenuItem>
        <MenuItem onClick={() => onCreate('directory')}>New Folder</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={onReveal}>Open Containing Folder</MenuItem>
        <MenuSeparator />
        <MenuItem disabled={root_selected} onClick={() => onCutCopy('cut')}>
          Cut
        </MenuItem>
        <MenuItem disabled={root_selected} onClick={() => onCutCopy('copy')}>
          Copy
        </MenuItem>
        <MenuItem disabled={!clipboard} onClick={onPaste}>
          Paste
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => onCopyPath(target_path, false)}>Copy Path</MenuItem>
        <MenuItem onClick={() => onCopyPath(target_path, true)}>Copy Relative Path</MenuItem>
        <MenuSeparator />
        <MenuItem disabled={root_selected} onClick={onRename}>
          Rename
        </MenuItem>
        <MenuItem disabled={root_selected} onClick={onDelete}>
          Delete
        </MenuItem>
      </div>
    </>
  )
}

export default ExplorerContextMenu
