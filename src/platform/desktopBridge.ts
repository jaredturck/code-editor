export * from './desktopBridgeBase'
export * from './documentBridge'

import * as base from './desktopBridgeBase'
import type {
  BridgeFileNode,
  BridgeFileSemanticResult,
  BridgeFileSemanticSearchKind,
  BridgeOptions,
  BridgeRecord,
} from './desktopBridgeBase'

export interface EditorFileAuthority {
  execute: (tool_name: string, args?: BridgeRecord) => Promise<unknown>
}

let editor_file_authority: EditorFileAuthority | null = null
let editor_workspace_root: Promise<string> | null = null

function normalize_workspace_path(file_path: string) {
  const normalized = String(file_path || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const windows = typeof window !== 'undefined' && window.editor_api?.platform === 'win32'
  return windows ? normalized.toLowerCase() : normalized
}

function path_is_in_workspace(root_path: string, file_path: string) {
  const root = normalize_workspace_path(root_path)
  const target = normalize_workspace_path(file_path)
  return Boolean(root) && (target === root || target.startsWith(`${root}/`))
}

export function setEditorFileAuthority(authority: EditorFileAuthority | null) {
  editor_file_authority = authority
  editor_workspace_root = authority
    ? authority.execute('files.list', { path: '', depth: 1 })
        .then((result) => {
          const record = result && typeof result === 'object' ? result as BridgeRecord : {}
          return String(record.rootPath || '')
        })
        .catch(() => '')
    : null
}

export async function searchFileSemanticIndex(
  query: string,
  limit = 30,
  kind: BridgeFileSemanticSearchKind = 'all',
): Promise<BridgeFileSemanticResult[]> {
  const requested_limit = Math.max(1, Math.min(100, Math.round(Number(limit) || 30)))
  const workspace_root = editor_workspace_root ? await editor_workspace_root : ''
  const search_limit = workspace_root ? Math.min(100, requested_limit * 3) : requested_limit
  const results = await base.searchFileSemanticIndex(query, search_limit, kind)

  if (!workspace_root) return results.slice(0, requested_limit)
  return results
    .filter((result) => path_is_in_workspace(workspace_root, result.path))
    .slice(0, requested_limit)
}

export async function listDirectory(
  path: string,
  depth = 3,
): Promise<{ rootPath: string; tree: BridgeFileNode }> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.list', { path, depth })) as {
      rootPath: string
      tree: BridgeFileNode
    }
  }
  return base.listDirectory(path, depth)
}

export async function readTextFile(
  path: string,
  options: BridgeOptions = {},
): Promise<{ path: string; content: string; isBinary: boolean }> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.read', { path, ...options })) as {
      path: string
      content: string
      isBinary: boolean
    }
  }
  return base.readTextFile(path, options)
}

export async function writeTextFile(
  path: string,
  content: string,
  options: { append?: boolean; fileManager?: boolean } = {},
): Promise<BridgeRecord> {
  if (editor_file_authority && options.fileManager !== true) {
    return (await editor_file_authority.execute('files.write', {
      path,
      content,
      mode: options.append === true ? 'append' : 'create',
    })) as BridgeRecord
  }
  return base.writeTextFile(path, content, options)
}

export async function editTextFile(
  path: string,
  oldText: string,
  newText: string,
  options: { replaceAll?: boolean; fileManager?: boolean } = {},
): Promise<BridgeRecord> {
  if (editor_file_authority && options.fileManager !== true) {
    return (await editor_file_authority.execute('files.edit', {
      path,
      oldText,
      newText,
      replaceAll: options.replaceAll === true,
    })) as BridgeRecord
  }
  return base.editTextFile(path, oldText, newText, options)
}

export async function powerStat(path_or_paths: string | string[]): Promise<BridgeRecord> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.stat', {
      path: Array.isArray(path_or_paths) ? path_or_paths : [path_or_paths],
    })) as BridgeRecord
  }
  return base.powerStat(path_or_paths)
}

export async function powerDiff(
  path: string,
  new_content: string,
  context_lines = 3,
): Promise<BridgeRecord> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.diff', {
      path,
      newContent: new_content,
      contextLines: context_lines,
    })) as BridgeRecord
  }
  return base.powerDiff(path, new_content, context_lines)
}

export async function powerPatch(
  path: string,
  patch: string,
  dry_run = false,
): Promise<BridgeRecord> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.patch', {
      path,
      patch,
      dryRun: dry_run,
    })) as BridgeRecord
  }
  return base.powerPatch(path, patch, dry_run)
}
