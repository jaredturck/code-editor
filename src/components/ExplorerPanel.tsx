import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { WorkspaceClipboardState, WorkspaceNode, WorkspaceNodeKind } from '../types/workspace'
import ExplorerContextMenu from './explorer/ExplorerContextMenu'
import ExplorerInlineInput from './explorer/ExplorerInlineInput'
import ExplorerTreeRow from './explorer/ExplorerTreeRow'
import SearchPanel from './SearchPanel'
import SourceControlPanel from './SourceControlPanel'
import WorkspaceDeleteModal from './WorkspaceDeleteModal'
import type { ActivitySection } from '../types/editor'

interface ExplorerPanelProps {
  activeFilePath: string | null
  activeSection: ActivitySection
  clipboard: WorkspaceClipboardState | null
  expandedPaths: Set<string>
  nodes: Map<string, WorkspaceNode>
  rootName: string | null
  rootPath: string | null
  selectedPath: string | null
  selectedPaths: Set<string>
  onCollapseAll: () => void
  onCopyPath: (target_path: string, relative: boolean) => void
  onCreateEntry: (parent_path: string, name: string, kind: WorkspaceNodeKind) => Promise<boolean>
  onDeleteEntries: (target_paths: string[]) => Promise<boolean>
  onDropEntry: (source_path: string, target_path: string | null, operation: 'copy' | 'cut') => void
  onOpenFile: (file_path: string) => void
  onOpenFolder: () => void
  onPaste: (target_path: string | null) => void
  onRefresh: () => void
  onRenameEntry: (source_path: string, name: string) => Promise<boolean>
  onResize: (event: ReactPointerEvent<HTMLElement>) => void
  onRevealEntry: (target_path: string) => void
  onSelectPath: (target_path: string) => void
  onSelectPaths: (target_paths: string[], focused_path: string) => void
  onSelectSubtree: (target_path: string) => void
  onSetClipboard: (operation: 'copy' | 'cut', source_path: string) => void
  onTogglePathSelection: (target_path: string) => void
  onToggleFolder: (folder_path: string) => void
}

interface ExplorerEditState {
  mode: 'create' | 'rename'
  kind: WorkspaceNodeKind
  parent_path: string
  target_path: string | null
  initial_value: string
}

interface ExplorerMenuState {
  target_path: string | null
  x: number
  y: number
}

interface ExplorerBranchProps {
  activeFilePath: string | null
  depth: number
  editState: ExplorerEditState | null
  expandedPaths: Set<string>
  node: WorkspaceNode
  nodes: Map<string, WorkspaceNode>
  selectedPaths: Set<string>
  onCancelEdit: () => void
  onConfirmEdit: (value: string) => Promise<boolean>
  onContextMenu: (event: MouseEvent<HTMLDivElement>, node: WorkspaceNode) => void
  onDropEntry: (source_path: string, target_path: string, operation: 'copy' | 'cut') => void
  onOpenFile: (file_path: string) => void
  onRename: (target_path: string) => void
  onSelectNode: (event: MouseEvent<HTMLDivElement>, node: WorkspaceNode) => void
  onSelectSubtree: (target_path: string) => void
  onToggleFolder: (folder_path: string) => void
}

const panel_titles: Record<ActivitySection, string> = {
  explorer: 'EXPLORER',
  search: 'SEARCH',
  'source-control': 'SOURCE CONTROL',
}

function get_visible_nodes(root_path: string, nodes: Map<string, WorkspaceNode>, expanded_paths: Set<string>) {
  const visible_nodes: WorkspaceNode[] = []

  const visit = (node_path: string) => {
    const node = nodes.get(node_path)

    if (!node) {
      return
    }

    visible_nodes.push(node)

    if (node.kind !== 'directory' || !expanded_paths.has(node.path)) {
      return
    }

    for (const child_path of node.children ?? []) {
      visit(child_path)
    }
  }

  visit(root_path)
  return visible_nodes
}

function ExplorerBranch({
  activeFilePath,
  depth,
  editState,
  expandedPaths,
  node,
  nodes,
  selectedPaths,
  onCancelEdit,
  onConfirmEdit,
  onContextMenu,
  onDropEntry,
  onOpenFile,
  onRename,
  onSelectNode,
  onSelectSubtree,
  onToggleFolder,
}: ExplorerBranchProps) {
  const expanded = expandedPaths.has(node.path)
  const renaming = editState?.mode === 'rename' && editState.target_path === node.path
  const creating_child = editState?.mode === 'create' && editState.parent_path === node.path

  return (
    <>
      {renaming ? (
        <div className="flex h-7 items-center gap-1 bg-[var(--selected)] pr-1" style={{ paddingLeft: depth * 12 + 20 }}>
          <ExplorerInlineInput
            initialValue={editState.initial_value}
            onCancel={onCancelEdit}
            onConfirm={onConfirmEdit}
            selectBaseName={node.kind === 'file'}
          />
        </div>
      ) : (
        <ExplorerTreeRow
          active={activeFilePath === node.path}
          depth={depth}
          expanded={expanded}
          node={node}
          onContextMenu={onContextMenu}
          onDropEntry={onDropEntry}
          onOpen={(selected_node) => {
            if (selected_node.kind === 'directory') {
              onSelectSubtree(selected_node.path)
            } else {
              onOpenFile(selected_node.path)
            }
          }}
          onRename={(selected_node) => onRename(selected_node.path)}
          onSelect={onSelectNode}
          onToggle={(selected_node) => onToggleFolder(selected_node.path)}
          selected={selectedPaths.has(node.path)}
        />
      )}

      {node.kind === 'directory' && expanded && (
        <div role="group">
          {creating_child && (
            <div
              className="flex h-7 items-center gap-1 bg-[var(--selected)] pr-1"
              style={{ paddingLeft: (depth + 1) * 12 + 20 }}
            >
              <ExplorerInlineInput initialValue="" onCancel={onCancelEdit} onConfirm={onConfirmEdit} />
            </div>
          )}
          {node.children?.map((child_path) => {
            const child_node = nodes.get(child_path)

            if (!child_node) {
              return null
            }

            return (
              <ExplorerBranch
                activeFilePath={activeFilePath}
                depth={depth + 1}
                editState={editState}
                expandedPaths={expandedPaths}
                key={child_path}
                node={child_node}
                nodes={nodes}
                onCancelEdit={onCancelEdit}
                onConfirmEdit={onConfirmEdit}
                onContextMenu={onContextMenu}
                onDropEntry={onDropEntry}
                onOpenFile={onOpenFile}
                onRename={onRename}
                onSelectNode={onSelectNode}
                onSelectSubtree={onSelectSubtree}
                onToggleFolder={onToggleFolder}
                selectedPaths={selectedPaths}
              />
            )
          })}
          {node.error && <div className="px-6 py-1 text-[10px] text-red-400">{node.error}</div>}
        </div>
      )}
    </>
  )
}

function ExplorerPanel({
  activeFilePath,
  activeSection,
  clipboard,
  expandedPaths,
  nodes,
  rootName,
  rootPath,
  selectedPath,
  selectedPaths,
  onCollapseAll,
  onCopyPath,
  onCreateEntry,
  onDeleteEntries,
  onDropEntry,
  onOpenFile,
  onOpenFolder,
  onPaste,
  onRefresh,
  onRenameEntry,
  onResize,
  onRevealEntry,
  onSelectPath,
  onSelectPaths,
  onSelectSubtree,
  onSetClipboard,
  onTogglePathSelection,
  onToggleFolder,
}: ExplorerPanelProps) {
  const [edit_state, set_edit_state] = useState<ExplorerEditState | null>(null)
  const [menu_state, set_menu_state] = useState<ExplorerMenuState | null>(null)
  const [pending_delete_paths, set_pending_delete_paths] = useState<string[] | null>(null)
  const selection_anchor_ref = useRef<string | null>(null)
  const tree_ref = useRef<HTMLDivElement | null>(null)
  const root_node = rootPath ? nodes.get(rootPath) : null
  const visible_nodes = useMemo(
    () => (rootPath ? get_visible_nodes(rootPath, nodes, expandedPaths) : []),
    [expandedPaths, nodes, rootPath],
  )

  useEffect(() => {
    if (!selectedPath || !tree_ref.current) {
      return
    }

    const selected_row = [...tree_ref.current.querySelectorAll<HTMLElement>('[data-workspace-path]')].find(
      (element) => element.dataset.workspacePath === selectedPath,
    )
    selected_row?.scrollIntoView?.({ block: 'nearest' })
  }, [expandedPaths, nodes, selectedPath])

  const start_create = (kind: WorkspaceNodeKind, target_path = menu_state ? menu_state.target_path : selectedPath) => {
    if (!rootPath) {
      return
    }

    const target_node = target_path ? nodes.get(target_path) : root_node
    const parent_path = target_node?.kind === 'directory' ? target_node.path : (target_node?.parent_path ?? rootPath)
    set_menu_state(null)
    set_edit_state({
      mode: 'create',
      kind,
      parent_path,
      target_path: null,
      initial_value: '',
    })

    if (!expandedPaths.has(parent_path)) {
      onToggleFolder(parent_path)
    }
  }

  const start_rename = (target_path = menu_state ? menu_state.target_path : selectedPath) => {
    const target_node = target_path ? nodes.get(target_path) : null

    if (!target_node || target_node.path === rootPath) {
      return
    }

    set_menu_state(null)
    set_edit_state({
      mode: 'rename',
      kind: target_node.kind,
      parent_path: target_node.parent_path ?? rootPath!,
      target_path: target_node.path,
      initial_value: target_node.name,
    })
  }

  const confirm_edit = async (value: string) => {
    if (!edit_state) {
      return false
    }

    const succeeded =
      edit_state.mode === 'create'
        ? await onCreateEntry(edit_state.parent_path, value, edit_state.kind)
        : await onRenameEntry(edit_state.target_path!, value)

    if (succeeded) {
      set_edit_state(null)
    }

    return succeeded
  }

  const handle_select_node = (event: MouseEvent<HTMLDivElement>, node: WorkspaceNode) => {
    const command_key = event.ctrlKey || event.metaKey
    const selectable_nodes = visible_nodes.filter((visible_node) => visible_node.path !== rootPath)

    if (event.shiftKey && selection_anchor_ref.current) {
      const anchor_index = selectable_nodes.findIndex(
        (visible_node) => visible_node.path === selection_anchor_ref.current,
      )
      const target_index = selectable_nodes.findIndex((visible_node) => visible_node.path === node.path)

      if (anchor_index >= 0 && target_index >= 0) {
        const start_index = Math.min(anchor_index, target_index)
        const end_index = Math.max(anchor_index, target_index)
        onSelectPaths(
          selectable_nodes.slice(start_index, end_index + 1).map((visible_node) => visible_node.path),
          node.path,
        )
      } else {
        onSelectPath(node.path)
      }
    } else if (command_key) {
      onTogglePathSelection(node.path)
      selection_anchor_ref.current = node.path
    } else {
      onSelectPath(node.path)
      selection_anchor_ref.current = node.path
    }

    if (node.kind === 'file') {
      onOpenFile(node.path)
    }
  }

  const request_delete = (target_path = menu_state ? menu_state.target_path : selectedPath) => {
    set_menu_state(null)

    if (!target_path || target_path === rootPath || (target_path === selectedPath && selectedPaths.size === 0)) {
      return
    }

    const use_current_selection =
      selectedPaths.size > 0 && (selectedPaths.has(target_path) || target_path === selectedPath)
    const target_paths = use_current_selection ? [...selectedPaths] : [target_path]
    const deletable_paths = target_paths.filter((path) => path !== rootPath)

    if (deletable_paths.length > 0) {
      set_pending_delete_paths(deletable_paths)
    }
  }

  const handle_tree_key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rootPath || edit_state || visible_nodes.length === 0) {
      return
    }

    const current_index = Math.max(
      0,
      visible_nodes.findIndex((node) => node.path === selectedPath),
    )
    const current_node = visible_nodes[current_index]
    const command_key = event.ctrlKey || event.metaKey

    if (command_key && event.key.toLowerCase() === 'c' && current_node.path !== rootPath) {
      event.preventDefault()
      onSetClipboard('copy', current_node.path)
    } else if (command_key && event.key.toLowerCase() === 'x' && current_node.path !== rootPath) {
      event.preventDefault()
      onSetClipboard('cut', current_node.path)
    } else if (command_key && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      onPaste(current_node.path)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const next_index = Math.min(visible_nodes.length - 1, Math.max(0, current_index + offset))
      onSelectPath(visible_nodes[next_index].path)
      selection_anchor_ref.current = visible_nodes[next_index].path
    } else if (event.key === 'ArrowRight' && current_node.kind === 'directory') {
      event.preventDefault()

      if (!expandedPaths.has(current_node.path)) {
        onToggleFolder(current_node.path)
      } else if (current_node.children?.[0]) {
        onSelectPath(current_node.children[0])
        selection_anchor_ref.current = current_node.children[0]
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()

      if (current_node.kind === 'directory' && expandedPaths.has(current_node.path)) {
        onToggleFolder(current_node.path)
      } else if (current_node.parent_path) {
        onSelectPath(current_node.parent_path)
        selection_anchor_ref.current = current_node.parent_path
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()

      if (current_node.kind === 'directory') {
        onToggleFolder(current_node.path)
      } else {
        onOpenFile(current_node.path)
      }
    } else if (event.key === 'F2') {
      event.preventDefault()
      start_rename(current_node.path)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      request_delete(current_node.path)
    }
  }

  const context_target = menu_state?.target_path ? (nodes.get(menu_state.target_path) ?? null) : null

  return (
    <aside
      aria-label={`${panel_titles[activeSection]} panel`}
      className="relative z-10 flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface-2)]"
    >
      <div className="flex h-10 items-center px-4 text-[11px] font-medium tracking-wide text-[var(--muted)]">
        {panel_titles[activeSection]}
      </div>

      {activeSection === 'search' && <SearchPanel rootPath={rootPath} onOpenFile={onOpenFile} />}

      {activeSection === 'source-control' && <SourceControlPanel rootPath={rootPath} onOpenFile={onOpenFile} />}

      {activeSection === 'explorer' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {!rootPath || !root_node ? (
            <div className="px-4 py-3">
              <p className="text-xs leading-5 text-[var(--muted)]">Open a folder to browse and edit a project.</p>
              <button
                className="mt-3 w-full rounded-md bg-sky-600 px-3 py-2 text-xs text-white hover:bg-sky-500"
                onClick={onOpenFolder}
                type="button"
              >
                Open Folder
              </button>
            </div>
          ) : (
            <>
              <div className="flex h-7 shrink-0 items-center border-y border-[var(--border)] bg-[var(--surface-3)] px-2">
                <button
                  className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold uppercase text-[var(--text)]"
                  onClick={() => onToggleFolder(rootPath)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onSelectPath(rootPath)
                    set_menu_state({ target_path: rootPath, x: event.clientX, y: event.clientY })
                  }}
                  title={rootPath}
                  type="button"
                >
                  <span className="mr-1 text-[var(--muted)]">{expandedPaths.has(rootPath) ? '⌄' : '›'}</span>
                  {rootName}
                </button>
                <button
                  className="explorer-action-button"
                  onClick={() => start_create('file', rootPath)}
                  title="New File"
                  type="button"
                >
                  +F
                </button>
                <button
                  className="explorer-action-button"
                  onClick={() => start_create('directory', rootPath)}
                  title="New Folder"
                  type="button"
                >
                  +D
                </button>
                <button className="explorer-action-button" onClick={onRefresh} title="Refresh Explorer" type="button">
                  ↻
                </button>
                <button className="explorer-action-button" onClick={onCollapseAll} title="Collapse All" type="button">
                  ⇤
                </button>
              </div>
              <div
                className="min-h-0 flex-1 overflow-auto py-1 outline-none"
                onContextMenu={(event) => {
                  event.preventDefault()
                  set_menu_state({
                    target_path: null,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source_path = event.dataTransfer.getData('application/x-code-editor-workspace-path')

                  if (source_path) {
                    onDropEntry(source_path, rootPath, event.ctrlKey ? 'copy' : 'cut')
                  }
                }}
                onKeyDown={handle_tree_key}
                ref={tree_ref}
                role="tree"
                tabIndex={0}
              >
                {expandedPaths.has(rootPath) && (
                  <>
                    {edit_state?.mode === 'create' && edit_state.parent_path === rootPath && (
                      <div className="flex h-7 items-center gap-1 bg-[var(--selected)] px-5">
                        <ExplorerInlineInput
                          initialValue=""
                          onCancel={() => set_edit_state(null)}
                          onConfirm={confirm_edit}
                        />
                      </div>
                    )}
                    {root_node.children?.map((child_path) => {
                      const child_node = nodes.get(child_path)

                      if (!child_node) {
                        return null
                      }

                      return (
                        <ExplorerBranch
                          activeFilePath={activeFilePath}
                          depth={0}
                          editState={edit_state}
                          expandedPaths={expandedPaths}
                          key={child_path}
                          node={child_node}
                          nodes={nodes}
                          onCancelEdit={() => set_edit_state(null)}
                          onConfirmEdit={confirm_edit}
                          onContextMenu={(event, node) => {
                            event.preventDefault()
                            event.stopPropagation()

                            if (!selectedPaths.has(node.path)) {
                              onSelectPath(node.path)
                              selection_anchor_ref.current = node.path
                            }

                            set_menu_state({
                              target_path: node.path,
                              x: event.clientX,
                              y: event.clientY,
                            })
                          }}
                          onDropEntry={onDropEntry}
                          onOpenFile={onOpenFile}
                          onRename={start_rename}
                          onSelectNode={handle_select_node}
                          onSelectSubtree={(target_path) => void onSelectSubtree(target_path)}
                          onToggleFolder={onToggleFolder}
                          selectedPaths={selectedPaths}
                        />
                      )
                    })}
                    {root_node.loading && <div className="px-5 py-2 text-xs text-[var(--muted)]">Loading…</div>}
                    {root_node.error && <div className="px-5 py-2 text-xs text-red-400">{root_node.error}</div>}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {menu_state && rootPath && (
        <ExplorerContextMenu
          clipboard={clipboard}
          onClose={() => set_menu_state(null)}
          onCopyPath={(target_path, relative) => {
            onCopyPath(target_path, relative)
            set_menu_state(null)
          }}
          onCreate={start_create}
          onCutCopy={(operation) => {
            if (context_target) {
              onSetClipboard(operation, context_target.path)
            }
            set_menu_state(null)
          }}
          onDelete={() => request_delete()}
          onPaste={() => {
            onPaste(menu_state.target_path)
            set_menu_state(null)
          }}
          onRename={start_rename}
          onReveal={() => {
            onRevealEntry(context_target?.path ?? rootPath)
            set_menu_state(null)
          }}
          rootPath={rootPath}
          target={context_target}
          x={Math.max(4, Math.min(menu_state.x, window.innerWidth - 240))}
          y={Math.max(4, Math.min(menu_state.y, window.innerHeight - 330))}
        />
      )}

      {pending_delete_paths && rootPath && (
        <WorkspaceDeleteModal
          hasDirectories={pending_delete_paths.some((target_path) => nodes.get(target_path)?.kind === 'directory')}
          onCancel={() => set_pending_delete_paths(null)}
          onConfirm={() => {
            const target_paths = pending_delete_paths
            set_pending_delete_paths(null)
            void onDeleteEntries(target_paths)
          }}
          paths={pending_delete_paths}
          rootPath={rootPath}
        />
      )}

      <div
        aria-label="Resize side panel"
        aria-orientation="vertical"
        className="absolute inset-y-0 right-0 z-30 w-1 translate-x-1/2 cursor-col-resize hover:bg-sky-500/70"
        onPointerDown={onResize}
        role="separator"
      />
    </aside>
  )
}

export default ExplorerPanel
