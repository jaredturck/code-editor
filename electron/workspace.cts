import { clipboard, ipcMain, shell, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

export type WorkspaceEntryKind = 'file' | 'directory'
export type WorkspaceClipboardOperation = 'copy' | 'cut'
export type WorkspaceConflictMode = 'ask' | 'replace' | 'keep_both'

export interface WorkspaceEntry {
  path: string
  parent_path: string | null
  name: string
  kind: WorkspaceEntryKind
  is_symlink: boolean
}

export type WorkspaceMutationResult =
  | {
      status: 'ok'
      path: string
      old_path?: string
      kind: WorkspaceEntryKind
    }
  | {
      status: 'conflict'
      source_path: string
      destination_path: string
      operation: WorkspaceClipboardOperation
    }

interface WorkspaceWatcherEntry {
  owner_id: number
  root_path: string
  watcher: FSWatcher
}

const workspace_watchers = new Map<number, WorkspaceWatcherEntry>()

function normalize_case(file_path: string) {
  return process.platform === 'win32' ? file_path.toLowerCase() : file_path
}

function path_is_inside(root_path: string, target_path: string) {
  const normalized_root = normalize_case(resolve(root_path))
  const normalized_target = normalize_case(resolve(target_path))
  const path_difference = relative(normalized_root, normalized_target)

  return (
    path_difference === '' ||
    (!path_difference.startsWith(`..${sep}`) && path_difference !== '..' && !isAbsolute(path_difference))
  )
}

function ensure_workspace_path(root_path: string, target_path: string) {
  if (!path_is_inside(root_path, target_path)) {
    throw new Error('The requested path is outside the open workspace.')
  }
}


function resolve_workspace_target(root_path: string, target_path: string) {
  return isAbsolute(target_path) ? resolve(target_path) : resolve(root_path, target_path)
}

async function canonical_workspace_root(root_path: string) {
  const resolved_root = resolve(root_path)
  const canonical_root = await realpath(resolved_root)
  const root_stat = await stat(canonical_root)

  if (!root_stat.isDirectory()) {
    throw new Error('The open workspace root is not a directory.')
  }

  return canonical_root
}

async function nearest_existing_parent(target_path: string) {
  let candidate = dirname(target_path)

  while (!(await path_exists(candidate))) {
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }

  return candidate
}

async function resolve_agent_workspace_target(root_path: string, target_path: string, allow_missing = false) {
  const resolved_target = resolve_workspace_target(root_path, target_path)
  ensure_workspace_path(root_path, resolved_target)
  const canonical_root = await canonical_workspace_root(root_path)

  if (await path_exists(resolved_target)) {
    const canonical_target = await realpath(resolved_target)
    if (!path_is_inside(canonical_root, canonical_target)) {
      throw new Error('The requested path resolves outside the open workspace.')
    }
    return { path: resolved_target, canonical_path: canonical_target, exists: true }
  }

  if (!allow_missing) {
    throw new Error(`${basename(resolved_target)} does not exist.`)
  }

  const existing_parent = await nearest_existing_parent(resolved_target)
  const canonical_parent = await realpath(existing_parent)
  if (!path_is_inside(canonical_root, canonical_parent)) {
    throw new Error('The requested path would be created outside the open workspace.')
  }

  return { path: resolved_target, canonical_path: resolved_target, exists: false }
}

function text_revision(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function read_agent_workspace_file(root_path: string, target_path: string) {
  const target = await resolve_agent_workspace_target(root_path, target_path)
  const target_stat = await stat(target.canonical_path)
  if (!target_stat.isFile()) throw new Error(`${basename(target.path)} is not a file.`)
  const content = await readFile(target.canonical_path, 'utf8')
  return {
    path: target.path,
    content,
    revision: text_revision(content),
    size: Buffer.byteLength(content, 'utf8'),
    modified_time: target_stat.mtimeMs,
  }
}

export async function write_agent_workspace_file(
  root_path: string,
  target_path: string,
  content: string,
  expected_revision: string | null,
) {
  const target = await resolve_agent_workspace_target(root_path, target_path, true)

  if (target.exists) {
    const target_stat = await stat(target.canonical_path)
    if (!target_stat.isFile()) throw new Error(`${basename(target.path)} is not a file.`)
    const current_content = await readFile(target.canonical_path, 'utf8')
    const current_revision = text_revision(current_content)
    if (expected_revision && current_revision !== expected_revision) {
      throw new Error(`Refusing to write ${basename(target.path)} because it changed after the agent read it.`)
    }
  } else {
    await mkdir(dirname(target.path), { recursive: true })
    await resolve_agent_workspace_target(root_path, dirname(target.path))
  }

  await writeFile(target.path, content, 'utf8')
  return { path: target.path, revision: text_revision(content), size: Buffer.byteLength(content, 'utf8') }
}

export async function stat_agent_workspace_path(root_path: string, target_path: string) {
  const target = await resolve_agent_workspace_target(root_path, target_path)
  const target_stat = await stat(target.canonical_path)
  return {
    path: target.path,
    name: basename(target.path),
    type: target_stat.isDirectory() ? 'directory' : target_stat.isFile() ? 'file' : 'other',
    size: target_stat.size,
    modifiedTime: target_stat.mtimeMs,
  }
}

export async function list_agent_workspace(root_path: string, target_path: string, depth = 3) {
  const normalized_depth = Math.max(1, Math.min(6, Math.round(depth)))
  const target = await resolve_agent_workspace_target(root_path, target_path)
  const root_stat = await stat(target.canonical_path)
  if (!root_stat.isDirectory()) throw new Error(`${basename(target.path)} is not a directory.`)

  const tree = {
    name: basename(target.path) || target.path,
    path: target.path,
    type: 'directory' as const,
    children: [] as Array<Record<string, unknown>>,
  }
  const queue = [{ path: target.path, node: tree, level: 0 }]
  let visited = 0

  while (queue.length && visited < 500) {
    const current = queue.shift()!
    const current_target = await resolve_agent_workspace_target(root_path, current.path)
    const entries = await readdir(current_target.canonical_path, { withFileTypes: true })

    for (const entry of entries) {
      if (visited >= 500) break
      const entry_path = join(current.path, entry.name)
      let safe_kind: 'file' | 'directory' = entry.isDirectory() ? 'directory' : 'file'

      if (entry.isSymbolicLink()) {
        try {
          const resolved_entry = await resolve_agent_workspace_target(root_path, entry_path)
          const resolved_stat = await stat(resolved_entry.canonical_path)
          safe_kind = resolved_stat.isDirectory() ? 'directory' : 'file'
        } catch {
          visited += 1
          continue
        }
      }

      const child: Record<string, unknown> = {
        name: entry.name,
        path: entry_path,
        type: safe_kind,
        ...(safe_kind === 'directory' ? { children: [] } : {}),
      }
      current.node.children.push(child)
      visited += 1

      if (safe_kind === 'directory' && current.level + 1 < normalized_depth) {
        queue.push({
          path: entry_path,
          node: child as typeof tree,
          level: current.level + 1,
        })
      }
    }
  }

  return { rootPath: target.path, tree, truncated: visited >= 500 }
}

function validate_workspace_name(name: string) {
  const trimmed_name = name.trim()

  if (!trimmed_name) {
    throw new Error('A file or folder name is required.')
  }

  if (
    trimmed_name === '.' ||
    trimmed_name === '..' ||
    /[<>:"/\\|?*]/.test(trimmed_name) ||
    trimmed_name.includes('\0')
  ) {
    throw new Error('The name contains characters that are not allowed.')
  }

  if (/[. ]$/.test(trimmed_name)) {
    throw new Error('A file or folder name cannot end with a period or space.')
  }

  return trimmed_name
}

async function path_exists(file_path: string) {
  return access(file_path)
    .then(() => true)
    .catch(() => false)
}

async function get_entry(file_path: string, parent_path: string | null): Promise<WorkspaceEntry> {
  const entry_stat = await lstat(file_path)
  let kind: WorkspaceEntryKind = entry_stat.isDirectory() ? 'directory' : 'file'

  if (entry_stat.isSymbolicLink()) {
    const followed_stat = await stat(file_path).catch(() => null)

    if (followed_stat?.isDirectory()) {
      kind = 'directory'
    }
  }

  return {
    path: file_path,
    parent_path,
    name: basename(file_path),
    kind,
    is_symlink: entry_stat.isSymbolicLink(),
  }
}

function sort_entries(entries: WorkspaceEntry[]) {
  return entries.sort((first_entry, second_entry) => {
    if (first_entry.kind !== second_entry.kind) {
      return first_entry.kind === 'directory' ? -1 : 1
    }

    return first_entry.name.localeCompare(second_entry.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })
}

export async function read_workspace_directory(root_path: string, directory_path: string) {
  ensure_workspace_path(root_path, directory_path)
  const directory_stat = await stat(directory_path)

  if (!directory_stat.isDirectory()) {
    throw new Error(`${basename(directory_path)} is not a folder.`)
  }

  const entries = await readdir(directory_path, { withFileTypes: true })
  const workspace_entries = await Promise.all(
    entries.map((entry) => get_entry(join(directory_path, entry.name), directory_path)),
  )

  return sort_entries(workspace_entries)
}

export async function create_workspace_entry(
  root_path: string,
  parent_path: string,
  name: string,
  kind: WorkspaceEntryKind,
) {
  ensure_workspace_path(root_path, parent_path)
  const normalized_name = validate_workspace_name(name)
  const new_path = join(parent_path, normalized_name)
  ensure_workspace_path(root_path, new_path)

  if (await path_exists(new_path)) {
    throw new Error(`${normalized_name} already exists.`)
  }

  if (kind === 'directory') {
    await mkdir(new_path)
  } else {
    await writeFile(new_path, '', { encoding: 'utf8', flag: 'wx' })
  }

  return get_entry(new_path, parent_path)
}

export async function rename_workspace_entry(root_path: string, source_path: string, name: string) {
  ensure_workspace_path(root_path, source_path)
  const normalized_name = validate_workspace_name(name)
  const destination_path = join(dirname(source_path), normalized_name)
  ensure_workspace_path(root_path, destination_path)

  if (normalize_case(resolve(source_path)) === normalize_case(resolve(destination_path))) {
    return get_entry(source_path, dirname(source_path))
  }

  if (await path_exists(destination_path)) {
    throw new Error(`${normalized_name} already exists.`)
  }

  await rename(source_path, destination_path)
  return get_entry(destination_path, dirname(destination_path))
}

function get_keep_both_name(source_path: string, attempt: number, is_directory: boolean) {
  const source_name = basename(source_path)
  const extension = is_directory ? '' : extname(source_name)
  const base_name = extension ? source_name.slice(0, -extension.length) : source_name
  const suffix = attempt === 1 ? ' copy' : ` copy ${attempt}`

  return `${base_name}${suffix}${extension}`
}

async function get_keep_both_path(parent_path: string, source_path: string, is_directory: boolean) {
  let attempt = 1

  while (true) {
    const candidate_path = join(parent_path, get_keep_both_name(source_path, attempt, is_directory))

    if (!(await path_exists(candidate_path))) {
      return candidate_path
    }

    attempt += 1
  }
}

async function copy_workspace_path(source_path: string, destination_path: string) {
  await cp(source_path, destination_path, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  })
}

async function move_workspace_path(source_path: string, destination_path: string) {
  try {
    await rename(source_path, destination_path)
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EXDEV') {
      throw error
    }

    await copy_workspace_path(source_path, destination_path)
    await rm(source_path, { recursive: true })
  }
}

export async function paste_workspace_entry(
  root_path: string,
  source_path: string,
  target_directory: string,
  operation: WorkspaceClipboardOperation,
  conflict_mode: WorkspaceConflictMode,
): Promise<WorkspaceMutationResult> {
  ensure_workspace_path(root_path, source_path)
  ensure_workspace_path(root_path, target_directory)
  const source_stat = await stat(source_path)
  const source_is_directory = source_stat.isDirectory()
  let destination_path = join(target_directory, basename(source_path))

  if (normalize_case(resolve(source_path)) === normalize_case(resolve(destination_path))) {
    if (operation === 'cut') {
      return {
        status: 'ok',
        path: source_path,
        old_path: source_path,
        kind: source_is_directory ? 'directory' : 'file',
      }
    }

    destination_path = await get_keep_both_path(target_directory, source_path, source_is_directory)
  }

  if (source_is_directory && path_is_inside(source_path, target_directory)) {
    throw new Error('A folder cannot be moved or copied into itself.')
  }

  if (await path_exists(destination_path)) {
    if (conflict_mode === 'ask') {
      return {
        status: 'conflict',
        source_path,
        destination_path,
        operation,
      }
    }

    if (conflict_mode === 'keep_both') {
      destination_path = await get_keep_both_path(target_directory, source_path, source_is_directory)
    } else {
      await shell.trashItem(destination_path)
    }
  }

  if (operation === 'copy') {
    await copy_workspace_path(source_path, destination_path)
  } else {
    await move_workspace_path(source_path, destination_path)
  }

  return {
    status: 'ok',
    path: destination_path,
    old_path: operation === 'cut' ? source_path : undefined,
    kind: source_is_directory ? 'directory' : 'file',
  }
}

export async function trash_workspace_entry(root_path: string, target_path: string) {
  ensure_workspace_path(root_path, target_path)

  if (normalize_case(resolve(root_path)) === normalize_case(resolve(target_path))) {
    throw new Error('The workspace root cannot be deleted from the Explorer.')
  }

  const target_stat = await stat(target_path)
  await shell.trashItem(target_path)

  return {
    path: target_path,
    kind: target_stat.isDirectory() ? ('directory' as const) : ('file' as const),
  }
}

export function reveal_workspace_entry(root_path: string, target_path: string) {
  ensure_workspace_path(root_path, target_path)
  shell.showItemInFolder(target_path)
}

export function copy_workspace_text(value: string) {
  clipboard.writeText(value)
}

export function watch_workspace(sender: WebContents, root_path: string) {
  stop_workspace_watch(sender.id)
  const resolved_root = resolve(root_path)
  const send_change = (event_type: string, file_name: string | Buffer | null) => {
    if (sender.isDestroyed()) {
      return
    }

    const changed_path = file_name ? resolve(resolved_root, file_name.toString()) : resolved_root
    sender.send('workspace:changed', {
      root_path: resolved_root,
      event_type,
      file_path: changed_path,
    })
  }
  let watcher: FSWatcher

  try {
    watcher = watch(resolved_root, { recursive: true }, send_change)
  } catch {
    watcher = watch(resolved_root, send_change)
  }

  watcher.on('error', (error) => {
    if (!sender.isDestroyed()) {
      sender.send('workspace:watch-error', {
        root_path: resolved_root,
        message: error.message,
      })
    }
  })

  workspace_watchers.set(sender.id, {
    owner_id: sender.id,
    root_path: resolved_root,
    watcher,
  })

  return true
}

export function stop_workspace_watch(owner_id: number) {
  const entry = workspace_watchers.get(owner_id)

  if (!entry) {
    return
  }

  workspace_watchers.delete(owner_id)
  entry.watcher.close()
}


// Agent file authority is exposed through dedicated IPC channels so renderer-side autonomous
// tools retain the same canonical workspace/symlink boundary as direct workspace operations.
ipcMain.handle('workspace:agent-read-file', async (_event, root_path: string, target_path: string) => {
  return read_agent_workspace_file(root_path, target_path)
})

ipcMain.handle(
  'workspace:agent-write-file',
  async (_event, root_path: string, target_path: string, content: string, expected_revision: string | null) => {
    return write_agent_workspace_file(root_path, target_path, content, expected_revision)
  },
)

ipcMain.handle('workspace:agent-stat', async (_event, root_path: string, target_path: string) => {
  return stat_agent_workspace_path(root_path, target_path)
})

ipcMain.handle(
  'workspace:agent-list',
  async (_event, root_path: string, target_path: string, depth: number) => {
    return list_agent_workspace(root_path, target_path, depth)
  },
)
