import { MenuItem, MenuSeparator } from './MenuDropdown'

interface EditorTabContextMenuProps {
  canCopyPath: boolean
  canCopyRelativePath: boolean
  canCloseOthers: boolean
  canCloseSaved: boolean
  canCloseToRight: boolean
  x: number
  y: number
  onClose: () => void
  onCloseAll: () => void
  onCloseOthers: () => void
  onCloseSaved: () => void
  onCloseTab: () => void
  onCloseToRight: () => void
  onCopyBreadcrumbsPath: () => void
  onCopyPath: () => void
  onCopyRelativePath: () => void
  onOpenContainingFolder: () => void
  onRevealInExplorer: () => void
}

function EditorTabContextMenu({
  canCopyPath,
  canCopyRelativePath,
  canCloseOthers,
  canCloseSaved,
  canCloseToRight,
  x,
  y,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseSaved,
  onCloseTab,
  onCloseToRight,
  onCopyBreadcrumbsPath,
  onCopyPath,
  onCopyRelativePath,
  onOpenContainingFolder,
  onRevealInExplorer,
}: EditorTabContextMenuProps) {
  return (
    <>
      <button aria-label="Close tab menu" className="fixed inset-0 z-[290]" onClick={onClose} type="button" />
      <div
        className="fixed z-[300] min-w-56 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-1 shadow-2xl"
        onContextMenu={(event) => event.preventDefault()}
        style={{ left: x, top: y }}
      >
        <MenuItem onClick={onCloseTab}>Close</MenuItem>
        <MenuItem disabled={!canCloseOthers} onClick={onCloseOthers}>
          Close Others
        </MenuItem>
        <MenuItem disabled={!canCloseToRight} onClick={onCloseToRight}>
          Close to the Right
        </MenuItem>
        <MenuItem disabled={!canCloseSaved} onClick={onCloseSaved}>
          Close Saved
        </MenuItem>
        <MenuItem onClick={onCloseAll}>Close All</MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canCopyPath} onClick={onCopyPath}>
          Copy Path
        </MenuItem>
        <MenuItem disabled={!canCopyRelativePath} onClick={onCopyRelativePath}>
          Copy Relative Path
        </MenuItem>
        <MenuItem disabled={!canCopyRelativePath} onClick={onCopyBreadcrumbsPath}>
          Copy Breadcrumbs Path
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canCopyRelativePath} onClick={onOpenContainingFolder}>
          Open Containing Folder
        </MenuItem>
        <MenuItem disabled={!canCopyRelativePath} onClick={onRevealInExplorer}>
          Reveal in Explorer View
        </MenuItem>
      </div>
    </>
  )
}

export default EditorTabContextMenu
