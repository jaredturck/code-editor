import { clipboard, shell, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { access, cp, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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
