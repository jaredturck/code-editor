import type { WorkspaceNode } from '../types/workspace'

function normalize_path(file_path: string) {
  const normalized = file_path.replace(/\\/g, '/').replace(/\/$/, '')
  return window.editor_api.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function workspace_path_is_same_or_child(parent_path: string, target_path: string) {
  const normalized_parent = normalize_path(parent_path)
  const normalized_target = normalize_path(target_path)

  return normalized_target === normalized_parent || normalized_target.startsWith(`${normalized_parent}/`)
}

export function get_workspace_relative_path(root_path: string, target_path: string) {
  const normalized_root = root_path.replace(/\\/g, '/').replace(/\/$/, '')
  const normalized_target = target_path.replace(/\\/g, '/')

  if (!workspace_path_is_same_or_child(root_path, target_path)) {
    return target_path
  }

  return normalized_target.slice(normalized_root.length).replace(/^\//, '') || '.'
}

function remove_node_tree(nodes: Map<string, WorkspaceNode>, target_path: string) {
  for (const node_path of nodes.keys()) {
    if (workspace_path_is_same_or_child(target_path, node_path)) {
      nodes.delete(node_path)
    }
  }
}

export function replace_workspace_children(
  current_nodes: Map<string, WorkspaceNode>,
  parent_path: string,
  entries: Array<Pick<WorkspaceNode, 'path' | 'parent_path' | 'name' | 'kind' | 'is_symlink'>>,
) {
  const next_nodes = new Map(current_nodes)
  const parent_node = next_nodes.get(parent_path)
  const next_child_paths = new Set(entries.map((entry) => entry.path))

  for (const old_child_path of parent_node?.children ?? []) {
    if (!next_child_paths.has(old_child_path)) {
      remove_node_tree(next_nodes, old_child_path)
    }
  }

  for (const entry of entries) {
    const existing_node = next_nodes.get(entry.path)
    next_nodes.set(entry.path, {
      ...entry,
      children: entry.kind === 'directory' ? (existing_node?.children ?? null) : null,
      loading: false,
      error: null,
    })
  }

  if (parent_node) {
    next_nodes.set(parent_path, {
      ...parent_node,
      children: entries.map((entry) => entry.path),
      loading: false,
      error: null,
    })
  }

  return next_nodes
}

export function update_workspace_node(
  current_nodes: Map<string, WorkspaceNode>,
  target_path: string,
  update: Partial<WorkspaceNode>,
) {
  const current_node = current_nodes.get(target_path)

  if (!current_node) {
    return current_nodes
  }

  const next_nodes = new Map(current_nodes)
  next_nodes.set(target_path, { ...current_node, ...update })
  return next_nodes
}

export function remove_workspace_node(current_nodes: Map<string, WorkspaceNode>, target_path: string) {
  const next_nodes = new Map(current_nodes)
  const target_node = next_nodes.get(target_path)

  remove_node_tree(next_nodes, target_path)

  if (target_node?.parent_path) {
    const parent_node = next_nodes.get(target_node.parent_path)

    if (parent_node?.children) {
      next_nodes.set(parent_node.path, {
        ...parent_node,
        children: parent_node.children.filter((child_path) => child_path !== target_path),
      })
    }
  }

  return next_nodes
}

export function remap_workspace_path(current_nodes: Map<string, WorkspaceNode>, old_path: string, new_path: string) {
  const next_nodes = new Map<string, WorkspaceNode>()

  for (const node of current_nodes.values()) {
    if (!workspace_path_is_same_or_child(old_path, node.path)) {
      next_nodes.set(node.path, node)
      continue
    }

    const suffix = node.path.slice(old_path.length)
    const next_path = `${new_path}${suffix}`
    const next_parent_path = node.parent_path
      ? workspace_path_is_same_or_child(old_path, node.parent_path)
        ? `${new_path}${node.parent_path.slice(old_path.length)}`
        : node.parent_path
      : null

    next_nodes.set(next_path, {
      ...node,
      path: next_path,
      parent_path: next_parent_path,
      name: node.path === old_path ? new_path.split(/[\\/]/).pop() || node.name : node.name,
      children: node.children?.map((child_path) => `${new_path}${child_path.slice(old_path.length)}`) ?? null,
    })
  }

  for (const [node_path, node] of next_nodes) {
    if (!node.children?.includes(old_path)) {
      continue
    }

    next_nodes.set(node_path, {
      ...node,
      children: node.children.map((child_path) => (child_path === old_path ? new_path : child_path)),
    })
  }

  return next_nodes
}

export function remap_workspace_path_set(current_paths: Set<string>, old_path: string, new_path: string) {
  const next_paths = new Set<string>()

  for (const current_path of current_paths) {
    next_paths.add(
      workspace_path_is_same_or_child(old_path, current_path)
        ? `${new_path}${current_path.slice(old_path.length)}`
        : current_path,
    )
  }

  return next_paths
}
