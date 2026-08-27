import { useEffect, useRef, useState } from 'react'
import type {
  WorkspaceClipboardOperation,
  WorkspaceClipboardState,
  WorkspaceConflictMode,
  WorkspaceConflictState,
  WorkspaceNode,
  WorkspaceNodeKind,
} from '../types/workspace'
import {
  get_workspace_relative_path,
  get_workspace_top_level_paths,
  remap_workspace_path,
  remap_workspace_path_set,
  remove_workspace_node,
  replace_workspace_children,
  update_workspace_node,
  workspace_path_is_same_or_child,
} from '../workspace/workspaceTree'

interface UseWorkspaceOptions {
  active_file_path: string | null
  onOpenFile: (file_path: string) => void
  onPathMoved: (old_path: string, new_path: string, is_directory: boolean) => void
  onPathDeleted: (target_path: string, is_directory: boolean) => void
  onNotice: (message: string) => void
}

function get_path_name(file_path: string) {
  return file_path.split(/[\\/]/).filter(Boolean).pop() ?? file_path
}

function get_parent_path(file_path: string) {
  const separator_index = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'))

  if (separator_index <= 0) {
    return file_path.slice(0, separator_index + 1)
  }

  return file_path.slice(0, separator_index)
}

function join_path(parent_path: string, name: string) {
  const separator = parent_path.includes('\\') && !parent_path.includes('/') ? '\\' : '/'
  return `${parent_path.replace(/[\\/]$/, '')}${separator}${name}`
}

function create_root_node(root_path: string): WorkspaceNode {
  return {
    path: root_path,
    parent_path: null,
    name: get_path_name(root_path),
    kind: 'directory',
    is_symlink: false,
    children: null,
    loading: false,
    error: null,
  }
}

function useWorkspace({ active_file_path, onOpenFile, onPathMoved, onPathDeleted, onNotice }: UseWorkspaceOptions) {
  const [root_path, set_root_path] = useState<string | null>(null)
  const [nodes, set_nodes] = useState(new Map<string, WorkspaceNode>())
  const [expanded_paths, set_expanded_paths] = useState(new Set<string>())
  const [selected_path, set_selected_path] = useState<string | null>(null)
  const [selected_paths, set_selected_paths] = useState(new Set<string>())
  const [clipboard, set_clipboard] = useState<WorkspaceClipboardState | null>(null)
  const [pending_conflict, set_pending_conflict] = useState<WorkspaceConflictState | null>(null)
  const root_path_ref = useRef(root_path)
  const nodes_ref = useRef(nodes)
  const expanded_paths_ref = useRef(expanded_paths)
  const selected_path_ref = useRef(selected_path)
  const selected_paths_ref = useRef(selected_paths)
  const selection_version_ref = useRef(0)
  const workspace_open_version_ref = useRef(0)
  const refresh_timeout_ref = useRef<number | null>(null)
  const directory_versions_ref = useRef(new Map<string, number>())
  const pending_refresh_paths_ref = useRef(new Set<string>())
  const on_notice_ref = useRef(onNotice)
  const load_directory_ref = useRef<((directory_path: string) => Promise<void>) | null>(null)
  const reveal_path_ref = useRef<((target_path: string) => Promise<void>) | null>(null)

  root_path_ref.current = root_path
  nodes_ref.current = nodes
  expanded_paths_ref.current = expanded_paths
  selected_path_ref.current = selected_path
  selected_paths_ref.current = selected_paths
  on_notice_ref.current = onNotice

  const load_directory = async (directory_path: string) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path) {
      return
    }

    const current_node = nodes_ref.current.get(directory_path)

    if (!current_node || current_node.kind !== 'directory' || current_node.is_symlink) {
      return
    }

    const request_version = (directory_versions_ref.current.get(directory_path) ?? 0) + 1
    directory_versions_ref.current.set(directory_path, request_version)
    const loading_nodes = update_workspace_node(nodes_ref.current, directory_path, { loading: true, error: null })
    nodes_ref.current = loading_nodes
    set_nodes(loading_nodes)

    try {
      const entries = await window.editor_api.workspace.read_directory(current_root_path, directory_path)

      if (
        root_path_ref.current !== current_root_path ||
        directory_versions_ref.current.get(directory_path) !== request_version
      ) {
        return
      }

      const next_nodes = replace_workspace_children(nodes_ref.current, directory_path, entries)
      nodes_ref.current = next_nodes
      set_nodes(next_nodes)
    } catch (error) {
      if (
        root_path_ref.current !== current_root_path ||
        directory_versions_ref.current.get(directory_path) !== request_version
      ) {
        return
      }

      const message = error instanceof Error ? error.message : `Unable to read ${current_node.name}.`
      const next_nodes = update_workspace_node(nodes_ref.current, directory_path, {
        loading: false,
        error: message,
      })
      nodes_ref.current = next_nodes
      set_nodes(next_nodes)
      onNotice(message)
    }
  }

  load_directory_ref.current = load_directory

  const refresh_loaded_directories = async () => {
    const loaded_directories = [...nodes_ref.current.values()]
      .filter((node) => node.kind === 'directory' && node.children !== null && !node.is_symlink)
      .map((node) => node.path)

    for (const directory_path of loaded_directories) {
      await load_directory(directory_path)
    }
  }

  useEffect(() => {
    const pending_refresh_paths = pending_refresh_paths_ref.current
    const remove_change_listener = window.editor_api.workspace.on_change((payload) => {
      const current_root_path = root_path_ref.current

      if (!current_root_path || payload.root_path !== current_root_path) {
        return
      }

      let candidate_path =
        payload.file_path === current_root_path ? current_root_path : get_parent_path(payload.file_path)

      while (workspace_path_is_same_or_child(current_root_path, candidate_path)) {
        const candidate_node = nodes_ref.current.get(candidate_path)

        if (candidate_node?.kind === 'directory' && candidate_node.children !== null) {
          pending_refresh_paths.add(candidate_path)
          break
        }

        if (candidate_path === current_root_path) {
          break
        }

        candidate_path = get_parent_path(candidate_path)
      }

      if (refresh_timeout_ref.current !== null) {
        window.clearTimeout(refresh_timeout_ref.current)
      }

      refresh_timeout_ref.current = window.setTimeout(() => {
        refresh_timeout_ref.current = null
        const refresh_paths = [...pending_refresh_paths]
        pending_refresh_paths.clear()

        void (async () => {
          for (const refresh_path of refresh_paths) {
            await load_directory_ref.current?.(refresh_path)
          }
        })()
      }, 180)
    })
    const remove_error_listener = window.editor_api.workspace.on_watch_error((payload) => {
      if (payload.root_path === root_path_ref.current) {
        on_notice_ref.current(`Workspace watching stopped: ${payload.message}`)
      }
    })

    return () => {
      remove_change_listener()
      remove_error_listener()

      if (refresh_timeout_ref.current !== null) {
        window.clearTimeout(refresh_timeout_ref.current)
        refresh_timeout_ref.current = null
      }

      pending_refresh_paths.clear()
    }
  }, [])

  const open_workspace = async (folder_path: string) => {
    const open_version = workspace_open_version_ref.current + 1
    workspace_open_version_ref.current = open_version
    window.editor_api.workspace.unwatch()

    if (refresh_timeout_ref.current !== null) {
      window.clearTimeout(refresh_timeout_ref.current)
      refresh_timeout_ref.current = null
    }
    const root_node = create_root_node(folder_path)
    const next_nodes = new Map([[folder_path, root_node]])

    root_path_ref.current = folder_path
    nodes_ref.current = next_nodes
    expanded_paths_ref.current = new Set([folder_path])
    set_root_path(folder_path)
    set_nodes(next_nodes)
    set_expanded_paths(new Set([folder_path]))
    selected_path_ref.current = folder_path
    set_selected_path(folder_path)
    selected_paths_ref.current = new Set([folder_path])
    set_selected_paths(new Set([folder_path]))
    set_clipboard(null)
    set_pending_conflict(null)
    directory_versions_ref.current.clear()
    pending_refresh_paths_ref.current.clear()

    try {
      const git_state = await window.editor_api.git.ensure_repository(folder_path)
      if (workspace_open_version_ref.current !== open_version || root_path_ref.current !== folder_path) return
      if (git_state.nested_repositories.length > 0) {
        onNotice('Nested Git metadata detected. Open Source Control to reconcile it before running the agent.')
      }
    } catch (error) {
      if (workspace_open_version_ref.current !== open_version || root_path_ref.current !== folder_path) return
      const message = error instanceof Error ? error.message : 'Unable to initialize source control for this workspace.'
      onNotice(`Source control unavailable: ${message}`)
    }

    if (workspace_open_version_ref.current !== open_version || root_path_ref.current !== folder_path) return

    try {
      await window.editor_api.workspace.watch(folder_path)
      await load_directory(folder_path)
    } catch (error) {
      if (workspace_open_version_ref.current !== open_version || root_path_ref.current !== folder_path) return
      const message = error instanceof Error ? error.message : 'Unable to open the selected folder.'
      onNotice(message)
    }
  }

  const open_folder_dialog = async () => {
    const folder_path = await window.editor_api.dialog.open_folder()

    if (folder_path) {
      await open_workspace(folder_path)
    }
  }

  const toggle_folder = async (folder_path: string) => {
    const node = nodes_ref.current.get(folder_path)

    if (!node || node.kind !== 'directory' || node.is_symlink) {
      return
    }

    const is_expanded = expanded_paths_ref.current.has(folder_path)
    const next_expanded_paths = new Set(expanded_paths_ref.current)

    if (is_expanded) {
      next_expanded_paths.delete(folder_path)
      expanded_paths_ref.current = next_expanded_paths
      set_expanded_paths(next_expanded_paths)
      return
    }

    next_expanded_paths.add(folder_path)
    expanded_paths_ref.current = next_expanded_paths
    set_expanded_paths(next_expanded_paths)

    if (node.children === null) {
      await load_directory(folder_path)
    }
  }

  const collapse_all = () => {
    if (!root_path_ref.current) {
      return
    }

    const next_expanded_paths = new Set([root_path_ref.current])
    expanded_paths_ref.current = next_expanded_paths
    set_expanded_paths(next_expanded_paths)
  }

  const set_selection = (paths: Iterable<string>, focused_path: string | null) => {
    selection_version_ref.current += 1
    const next_selected_paths = new Set(paths)
    selected_path_ref.current = focused_path
    selected_paths_ref.current = next_selected_paths
    set_selected_paths(next_selected_paths)
    set_selected_path(focused_path)
  }

  const select_path = (target_path: string) => {
    set_selection([target_path], target_path)
  }

  const select_paths = (target_paths: Iterable<string>, focused_path: string) => {
    set_selection(target_paths, focused_path)
  }

  const toggle_path_selection = (target_path: string) => {
    const next_selected_paths = new Set(selected_paths_ref.current)

    if (next_selected_paths.has(target_path)) {
      next_selected_paths.delete(target_path)
    } else {
      next_selected_paths.add(target_path)
    }

    set_selection(next_selected_paths, target_path)
  }

  const select_subtree = async (target_path: string) => {
    const current_root_path = root_path_ref.current
    const target_node = nodes_ref.current.get(target_path)

    if (!current_root_path || !target_node || target_node.kind !== 'directory') {
      return
    }

    set_selection([target_path], target_path)
    const selection_version = selection_version_ref.current
    const next_selected_paths = new Set([target_path])
    const pending_directories = [target_path]

    try {
      while (pending_directories.length > 0) {
        const directory_batch = pending_directories.splice(0, 8)
        const entry_batches = await Promise.all(
          directory_batch.map((directory_path) =>
            window.editor_api.workspace.read_directory(current_root_path, directory_path),
          ),
        )

        for (const entries of entry_batches) {
          for (const entry of entries) {
            next_selected_paths.add(entry.path)

            if (entry.kind === 'directory' && !entry.is_symlink) {
              pending_directories.push(entry.path)
            }
          }
        }
      }

      if (selection_version === selection_version_ref.current) {
        set_selection(next_selected_paths, target_path)
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Unable to select everything inside ${target_node.name}.`)
    }
  }

  const get_target_directory = (target_path: string | null) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path || !target_path) {
      return current_root_path
    }

    const node = nodes_ref.current.get(target_path)
    return node?.kind === 'directory' ? node.path : (node?.parent_path ?? current_root_path)
  }

  const create_entry = async (parent_path: string, name: string, kind: WorkspaceNodeKind) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path) {
      return false
    }

    try {
      const created_entry = await window.editor_api.workspace.create_entry(current_root_path, parent_path, name, kind)
      const next_expanded_paths = new Set(expanded_paths_ref.current).add(parent_path)
      expanded_paths_ref.current = next_expanded_paths
      set_expanded_paths(next_expanded_paths)
      await load_directory(parent_path)
      set_selection([created_entry.path], created_entry.path)

      if (kind === 'file') {
        onOpenFile(created_entry.path)
      }

      return true
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Unable to create ${name}.`)
      return false
    }
  }

  const rename_entry = async (source_path: string, name: string) => {
    const current_root_path = root_path_ref.current
    const source_node = nodes_ref.current.get(source_path)

    if (!current_root_path || !source_node || source_path === current_root_path) {
      return false
    }

    try {
      const renamed_entry = await window.editor_api.workspace.rename_entry(current_root_path, source_path, name)
      const next_nodes = remap_workspace_path(nodes_ref.current, source_path, renamed_entry.path)
      const next_expanded_paths = remap_workspace_path_set(expanded_paths_ref.current, source_path, renamed_entry.path)

      const next_selected_paths = remap_workspace_path_set(selected_paths_ref.current, source_path, renamed_entry.path)
      nodes_ref.current = next_nodes
      expanded_paths_ref.current = next_expanded_paths
      selected_paths_ref.current = next_selected_paths
      set_nodes(next_nodes)
      set_expanded_paths(next_expanded_paths)
      set_selected_paths(next_selected_paths)
      selected_path_ref.current = renamed_entry.path
      set_selected_path(renamed_entry.path)
      onPathMoved(source_path, renamed_entry.path, source_node.kind === 'directory')
      await load_directory(renamed_entry.parent_path ?? current_root_path)
      return true
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Unable to rename ${source_node.name}.`)
      return false
    }
  }

  const delete_entries = async (target_paths: Iterable<string>) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path) {
      return false
    }

    const delete_paths = get_workspace_top_level_paths(target_paths).filter(
      (target_path) => target_path !== current_root_path,
    )

    if (delete_paths.length === 0) {
      return false
    }

    const parent_paths = new Set<string>()

    try {
      for (const target_path of delete_paths) {
        const deleted_entry = await window.editor_api.workspace.trash_entry(current_root_path, target_path)
        const next_nodes = remove_workspace_node(nodes_ref.current, target_path)
        const next_expanded_paths = new Set(
          [...expanded_paths_ref.current].filter(
            (expanded_path) => !workspace_path_is_same_or_child(target_path, expanded_path),
          ),
        )
        const next_selected_paths = new Set(
          [...selected_paths_ref.current].filter(
            (selected_path) => !workspace_path_is_same_or_child(target_path, selected_path),
          ),
        )

        nodes_ref.current = next_nodes
        expanded_paths_ref.current = next_expanded_paths
        selected_paths_ref.current = next_selected_paths
        set_nodes(next_nodes)
        set_expanded_paths(next_expanded_paths)
        set_selected_paths(next_selected_paths)
        onPathDeleted(deleted_entry.path, deleted_entry.kind === 'directory')

        const parent_path = get_parent_path(target_path)

        if (parent_path) {
          parent_paths.add(parent_path)
        }

        if (clipboard && workspace_path_is_same_or_child(target_path, clipboard.source_path)) {
          set_clipboard(null)
        }
      }

      const next_focus = [...parent_paths][0] ?? current_root_path
      set_selection([next_focus], next_focus)

      for (const parent_path of parent_paths) {
        if (nodes_ref.current.has(parent_path)) {
          await load_directory(parent_path)
        }
      }

      return true
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Unable to delete the selected items.')
      return false
    }
  }

  const set_file_clipboard = (operation: WorkspaceClipboardOperation, source_path: string) => {
    set_clipboard({ operation, source_path })
  }

  const perform_paste = async (
    source_path: string,
    target_directory: string,
    operation: WorkspaceClipboardOperation,
    conflict_mode: WorkspaceConflictMode,
  ) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path) {
      return false
    }

    try {
      const destination_path = join_path(target_directory, get_path_name(source_path))
      const replaced_node = conflict_mode === 'replace' ? nodes_ref.current.get(destination_path) : null
      const result = await window.editor_api.workspace.paste_entry(
        current_root_path,
        source_path,
        target_directory,
        operation,
        conflict_mode,
      )

      if (result.status === 'conflict') {
        set_pending_conflict({
          source_path,
          destination_path: result.destination_path,
          target_directory,
          operation,
        })
        return false
      }

      set_pending_conflict(null)

      if (replaced_node) {
        const next_nodes = remove_workspace_node(nodes_ref.current, replaced_node.path)
        nodes_ref.current = next_nodes
        set_nodes(next_nodes)
        onPathDeleted(replaced_node.path, replaced_node.kind === 'directory')
      }

      if (operation === 'cut' && result.old_path) {
        if (result.old_path !== result.path) {
          const old_parent_path = get_parent_path(result.old_path)
          const next_nodes = remap_workspace_path(nodes_ref.current, result.old_path, result.path)
          const next_expanded_paths = remap_workspace_path_set(expanded_paths_ref.current, result.old_path, result.path)
          const next_selected_paths = remap_workspace_path_set(selected_paths_ref.current, result.old_path, result.path)

          nodes_ref.current = next_nodes
          expanded_paths_ref.current = next_expanded_paths
          selected_paths_ref.current = next_selected_paths
          set_nodes(next_nodes)
          set_expanded_paths(next_expanded_paths)
          set_selected_paths(next_selected_paths)
          onPathMoved(result.old_path, result.path, result.kind === 'directory')

          if (nodes_ref.current.has(old_parent_path)) {
            await load_directory(old_parent_path)
          }
        }

        set_clipboard(null)
      }

      await load_directory(target_directory)
      set_selection([result.path], result.path)
      return true
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Unable to complete the file operation.')
      return false
    }
  }

  const paste_into = async (target_path: string | null) => {
    const target_directory = get_target_directory(target_path)

    if (!clipboard || !target_directory) {
      return false
    }

    return perform_paste(clipboard.source_path, target_directory, clipboard.operation, 'ask')
  }

  const drop_entry = async (
    source_path: string,
    target_path: string | null,
    operation: WorkspaceClipboardOperation,
  ) => {
    const target_directory = get_target_directory(target_path)

    if (!target_directory) {
      return false
    }

    return perform_paste(source_path, target_directory, operation, 'ask')
  }

  const resolve_conflict = async (conflict_mode: Exclude<WorkspaceConflictMode, 'ask'> | 'cancel') => {
    const conflict = pending_conflict

    if (!conflict || conflict_mode === 'cancel') {
      set_pending_conflict(null)
      return
    }

    await perform_paste(conflict.source_path, conflict.target_directory, conflict.operation, conflict_mode)
  }

  const copy_path = (target_path: string, relative_path: boolean) => {
    const current_root_path = root_path_ref.current
    const value =
      relative_path && current_root_path ? get_workspace_relative_path(current_root_path, target_path) : target_path
    window.editor_api.workspace.copy_text(value)
  }

  const reveal_entry = (target_path: string) => {
    const current_root_path = root_path_ref.current

    if (current_root_path) {
      window.editor_api.workspace.reveal_entry(current_root_path, target_path)
    }
  }

  const reveal_path = async (target_path: string, replace_selection = false) => {
    const current_root_path = root_path_ref.current

    if (!current_root_path || !workspace_path_is_same_or_child(current_root_path, target_path)) {
      return
    }

    const relative_path = get_workspace_relative_path(current_root_path, target_path)
    const parts = relative_path === '.' ? [] : relative_path.split('/')
    const directory_parts = parts.slice(0, -1)
    const paths_to_expand = [current_root_path]
    let current_path = current_root_path

    for (const part of directory_parts) {
      if (nodes_ref.current.get(current_path)?.children === null) {
        await load_directory(current_path)
      }

      current_path = join_path(current_path, part)
      paths_to_expand.push(current_path)
    }

    if (nodes_ref.current.get(current_path)?.children === null) {
      await load_directory(current_path)
    }

    const next_expanded_paths = new Set(expanded_paths_ref.current)

    for (const path_to_expand of paths_to_expand) {
      next_expanded_paths.add(path_to_expand)
    }

    expanded_paths_ref.current = next_expanded_paths
    set_expanded_paths(next_expanded_paths)

    if (replace_selection) {
      set_selection([target_path], target_path)
    } else if (selected_path_ref.current === target_path) {
      return
    } else if (selected_paths_ref.current.size <= 1) {
      set_selection([target_path], target_path)
    } else {
      selected_path_ref.current = target_path
      set_selected_path(target_path)
    }
  }

  reveal_path_ref.current = (target_path) => reveal_path(target_path)

  useEffect(() => {
    if (active_file_path) {
      void reveal_path_ref.current?.(active_file_path)
    }
  }, [active_file_path, root_path])

  useEffect(() => {
    return () => window.editor_api.workspace.unwatch()
  }, [])

  return {
    clipboard,
    collapse_all,
    copy_path,
    create_entry,
    delete_entries,
    drop_entry,
    expanded_paths,
    get_target_directory,
    load_directory,
    nodes,
    open_folder_dialog,
    open_workspace,
    paste_into,
    pending_conflict,
    refresh: refresh_loaded_directories,
    rename_entry,
    resolve_conflict,
    reveal_entry,
    reveal_path: (target_path: string) => reveal_path(target_path, true),
    root_name: root_path ? get_path_name(root_path) : null,
    root_path,
    select_path,
    select_paths,
    select_subtree,
    selected_path,
    selected_paths,
    toggle_path_selection,
    set_file_clipboard,
    toggle_folder,
  }
}

export default useWorkspace
