import { useState, type DragEvent, type MouseEvent } from 'react'
import type { WorkspaceNode } from '../../types/workspace'

interface ExplorerTreeRowProps {
  active: boolean
  depth: number
  expanded: boolean
  selected: boolean
  node: WorkspaceNode
  onContextMenu: (event: MouseEvent<HTMLDivElement>, node: WorkspaceNode) => void
  onDropEntry: (source_path: string, target_path: string, operation: 'copy' | 'cut') => void
  onOpen: (node: WorkspaceNode) => void
  onSelect: (node: WorkspaceNode) => void
  onToggle: (node: WorkspaceNode) => void
  children?: React.ReactNode
}

function ExplorerTreeRow({
  active,
  depth,
  expanded,
  selected,
  node,
  onContextMenu,
  onDropEntry,
  onOpen,
  onSelect,
  onToggle,
  children,
}: ExplorerTreeRowProps) {
  const [drop_target, set_drop_target] = useState(false)
  const can_expand = node.kind === 'directory' && !node.is_symlink
  const row_class = selected
    ? 'bg-[var(--selected)] text-[var(--text)]'
    : active
      ? 'bg-sky-500/10 text-[var(--text)]'
      : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'

  const handle_drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const source_path = event.dataTransfer.getData('application/x-code-editor-workspace-path')

    if (!source_path || source_path === node.path) {
      return
    }

    set_drop_target(false)
    onDropEntry(source_path, node.path, event.ctrlKey ? 'copy' : 'cut')
  }

  return (
    <>
      <div
        className={`group flex h-6 min-w-0 items-center pr-1 text-xs ${row_class} ${drop_target ? 'ring-1 ring-inset ring-sky-500' : ''}`}
        draggable={node.path !== node.parent_path}
        onClick={() => onSelect(node)}
        onContextMenu={(event) => onContextMenu(event, node)}
        onDoubleClick={() => onOpen(node)}
        onDragEnter={(event) => {
          event.preventDefault()
          set_drop_target(true)
        }}
        onDragLeave={() => set_drop_target(false)}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copyMove'
          event.dataTransfer.setData('application/x-code-editor-workspace-path', node.path)
        }}
        onDrop={handle_drop}
        role="treeitem"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-[11px] text-[var(--muted)]"
          disabled={!can_expand}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node)
          }}
          tabIndex={-1}
          type="button"
        >
          {can_expand ? (expanded ? '⌄' : '›') : ''}
        </button>
        <span
          aria-hidden="true"
          className={`mr-1.5 inline-flex w-4 shrink-0 justify-center ${node.kind === 'directory' ? 'text-amber-400/80' : 'text-sky-400/80'}`}
        >
          {node.kind === 'directory' ? '▰' : '▪'}
        </span>
        <span className={`truncate ${node.is_symlink ? 'italic' : ''}`} title={node.path}>
          {node.name}
        </span>
        {node.loading && <span className="ml-auto text-[9px] text-[var(--muted)]">…</span>}
      </div>
      {children}
    </>
  )
}

export default ExplorerTreeRow
