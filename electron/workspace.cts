import { clipboard, ipcMain, shell, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import {
  abandon_agent_git_run,
  commit_agent_changes,
  commit_staged_changes,
  ensure_workspace_repository,
  get_git_diff,
  get_git_history,
  get_git_status,
  prepare_agent_git_run,
  remove_nested_repository,
  stage_git_paths,
  unstage_git_paths,
} from './git.cjs'

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

function path_targets_git_metadata(root_path: string, target_path: string) {
  const path_difference = relative(resolve(root_path), resolve(target_path))
  return path_difference
    .split(sep)
    .filter(Boolean)
    .some((segment) => normalize_case(segment) === normalize_case('.git'))
}

async function resolve_agent_workspace_target(root_path: string, target_path: string, allow_missing = false) {
  const resolved_target = resolve_workspace_target(root_path, target_path)
  ensure_workspace_path(root_path, resolved_target)
  if (path_targets_git_metadata(root_path, resolved_target)) {
    throw new Error('Git metadata is managed by Source Control and is not available through agent file tools.')
  }
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
    const current_target = await resolve_agent_workspace_target(r²È="25½¥¸¡Á…É•¹Ñ}Á…Ñ °•Ñ}­••Á}‰½Ñ¡}¹…µ”¡Í½ÕÉ•}Á…Ñ °…ÑÑ•µÁÐ°¥Í}‘¥É•Ñ½Éä¤¤((€€€¥˜€ „¡…Ý…¥ÐÁ…Ñ¡}•á¥ÍÑÌ¡…¹‘¥‘…Ñ•}Á…Ñ ¤¤¤ì(€€€€€É•ÑÕÉ¸…¹‘¥‘…Ñ•}Á…Ñ (€€€ô((€€€…ÑÑ•µÁÐ€¬ô€Ä(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸½Áå}Ý½É­ÍÁ…•}Á…Ñ ¡Í½ÕÉ•}Á…Ñ èÍÑÉ¥¹œ°‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ èÍÑÉ¥¹œ¤ì(€…Ý…¥ÐÀ¡Í½ÕÉ•}Á…Ñ °‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ °ì(€€€É•ÕÉÍ¥Ù”èÑÉÕ”°(€€€•ÉÉ½É=¹á¥ÍÐèÑÉÕ”°(€€€™½É”è™…±Í”°(€€€ÁÉ•Í•ÉÙ•Q¥µ•ÍÑ…µÁÌèÑÉÕ”°(€ô¤)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ½Ù•}Ý½É­ÍÁ…•}Á…Ñ ¡Í½ÕÉ•}Á…Ñ èÍÑÉ¥¹œ°‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ èÍÑÉ¥¹œ¤ì(€ÑÉäì(€€€…Ý…¥ÐÉ•¹…µ”¡Í½ÕÉ•}Á…Ñ °‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡ÑåÁ•½˜•ÉÉ½È€„ôô€½‰©•Ðœñð•ÉÉ½È€ôôô¹Õ±°ñð€„ ½‘”œ¥¸•ÉÉ½È¤ñð•ÉÉ½È¹½‘”€„ôô€aXœ¤ì(€€€€€Ñ¡É½Ü•ÉÉ½È(€€€ô((€€€…Ý…¥Ð½Áå}Ý½É­ÍÁ…•}Á…Ñ ¡Í½ÕÉ•}Á…Ñ °‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤(€€€…Ý…¥ÐÉ´¡Í½ÕÉ•}Á…Ñ °ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤(€ô)ô()•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸Á…ÍÑ•}Ý½É­ÍÁ…•}•¹ÑÉä (€É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°(€Í½ÕÉ•}Á…Ñ èÍÑÉ¥¹œ°(€Ñ…É•Ñ}‘¥É•Ñ½ÉäèÍÑÉ¥¹œ°(€½Á•É…Ñ¥½¸è]½É­ÍÁ…•±¥Á‰½…É‘=Á•É…Ñ¥½¸°(€½¹™±¥Ñ}µ½‘”è]½É­ÍÁ…•½¹™±¥Ñ5½‘”°(¤èAÉ½µ¥Í”ñ]½É­ÍÁ…•5ÕÑ…Ñ¥½¹I•ÍÕ±Ðøì(€•¹ÍÕÉ•}Ý½É­ÍÁ…•}Á…Ñ ¡É½½Ñ}Á…Ñ °Í½ÕÉ•}Á…Ñ ¤(€•¹ÍÕÉ•}Ý½É­ÍÁ…•}Á…Ñ ¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}‘¥É•Ñ½Éä¤(€½¹ÍÐÍ½ÕÉ•}ÍÑ…Ð€ô…Ý…¥ÐÍÑ…Ð¡Í½ÕÉ•}Á…Ñ ¤(€½¹ÍÐÍ½ÕÉ•}¥Í}‘¥É•Ñ½Éä€ôÍ½ÕÉ•}ÍÑ…Ð¹¥Í¥É•Ñ½Éä ¤(€±•Ð‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ €ô©½¥¸¡Ñ…É•Ñ}‘¥É•Ñ½Éä°‰…Í•¹…µ”¡Í½ÕÉ•}Á…Ñ ¤¤((€¥˜€¡¹½Éµ…±¥é•}…Í”¡É•Í½±Ù”¡Í½ÕÉ•}Á…Ñ ¤¤€ôôô¹½Éµ…±¥é•}…Í”¡É•Í½±Ù”¡‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤¤¤ì(€€€¥˜€¡½Á•É…Ñ¥½¸€ôôô€ÕÐœ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€ÍÑ…ÑÕÌè€½¬œ°(€€€€€€€Á…Ñ èÍ½ÕÉ•}Á…Ñ °(€€€€€€€½±‘}Á…Ñ èÍ½ÕÉ•}Á…Ñ °(€€€€€€€­¥¹èÍ½ÕÉ•}¥Í}‘¥É•Ñ½Éä€ü€‘¥É•Ñ½Éäœ€è€™¥±”œ°(€€€€€ô(€€€ô((€€€‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ €ô…Ý…¥Ð•Ñ}­••Á}‰½Ñ¡}Á…Ñ ¡Ñ…É•Ñ}‘¥É•Ñ½Éä°Í½ÕÉ•}Á…Ñ °Í½ÕÉ•}¥Í}‘¥É•Ñ½Éä¤(€ô((€¥˜€¡Í½ÕÉ•}¥Í}‘¥É•Ñ½Éä€˜˜Á…Ñ¡}¥Í}¥¹Í¥‘”¡Í½ÕÉ•}Á…Ñ °Ñ…É•Ñ}‘¥É•Ñ½Éä¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ™½±‘•È…¹¹½Ð‰”µ½Ù•½È½Á¥•¥¹Ñ¼¥ÑÍ•±˜¸œ¤(€ô((€¥˜€¡…Ý…¥ÐÁ…Ñ¡}•á¥ÍÑÌ¡‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤¤ì(€€€¥˜€¡½¹™±¥Ñ}µ½‘”€ôôô€…Í¬œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€ÍÑ…ÑÕÌè€½¹™±¥Ðœ°(€€€€€€€Í½ÕÉ•}Á…Ñ °(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ °(€€€€€€€½Á•É…Ñ¥½¸°(€€€€€ô(€€€ô((€€€¥˜€¡½¹™±¥Ñ}µ½‘”€ôôô€­••Á}‰½Ñ œ¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ €ô…Ý…¥Ð•Ñ}­••Á}‰½Ñ¡}Á…Ñ ¡Ñ…É•Ñ}‘¥É•Ñ½Éä°Í½ÕÉ•}Á…Ñ °Í½ÕÉ•}¥Í}‘¥É•Ñ½Éä¤(€€€ô•±Í”ì(€€€€€…Ý…¥ÐÍ¡•±°¹ÑÉ…Í¡%Ñ•´¡‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤(€€€ô(€ô((€¥˜€¡½Á•É…Ñ¥½¸€ôôô€½Áäœ¤ì(€€€…Ý…¥Ð½Áå}Ý½É­ÍÁ…•}Á…Ñ ¡Í½ÕÉ•}Á…Ñ °‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤(€ô•±Í”ì(€€€…Ý…¥Ðµ½Ù•}Ý½É­ÍÁ…•}Á…Ñ ¡Í½ÕÉ•}Á…Ñ °‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ ¤(€ô((€É•ÑÕÉ¸ì(€€€ÍÑ…ÑÕÌè€½¬œ°(€€€Á…Ñ è‘•ÍÑ¥¹…Ñ¥½¹}Á…Ñ °(€€€½±‘}Á…Ñ è½Á•É…Ñ¥½¸€ôôô€ÕÐœ€üÍ½ÕÉ•}Á…Ñ €èÕ¹‘•™¥¹•°(€€€­¥¹èÍ½ÕÉ•}¥Í}‘¥É•Ñ½Éä€ü€‘¥É•Ñ½Éäœ€è€™¥±”œ°(€ô)ô()•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸ÑÉ…Í¡}Ý½É­ÍÁ…•}•¹ÑÉä¡É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ¤ì(€•¹ÍÕÉ•}Ý½É­ÍÁ…•}Á…Ñ ¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ ¤((€¥˜€¡¹½Éµ…±¥é•}…Í”¡É•Í½±Ù”¡É½½Ñ}Á…Ñ ¤¤€ôôô¹½Éµ…±¥é•}…Í”¡É•Í½±Ù”¡Ñ…É•Ñ}Á…Ñ ¤¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È Q¡”Ý½É­ÍÁ…”É½½Ð…¹¹½Ð‰”‘•±•Ñ•™É½´Ñ¡”áÁ±½É•È¸œ¤(€ô((€½¹ÍÐÑ…É•Ñ}ÍÑ…Ð€ô…Ý…¥ÐÍÑ…Ð¡Ñ…É•Ñ}Á…Ñ ¤(€…Ý…¥ÐÍ¡•±°¹ÑÉ…Í¡%Ñ•´¡Ñ…É•Ñ}Á…Ñ ¤((€É•ÑÕÉ¸ì(€€€Á…Ñ èÑ…É•Ñ}Á…Ñ °(€€€­¥¹èÑ…É•Ñ}ÍÑ…Ð¹¥Í¥É•Ñ½Éä ¤€ü€ ‘¥É•Ñ½Éäœ…Ì½¹ÍÐ¤€è€ ™¥±”œ…Ì½¹ÍÐ¤°(€ô)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸É•Ù•…±}Ý½É­ÍÁ…•}•¹ÑÉä¡É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ¤ì(€•¹ÍÕÉ•}Ý½É­ÍÁ…•}Á…Ñ ¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ ¤(€Í¡•±°¹Í¡½Ý%Ñ•µ%¹½±‘•È¡Ñ…É•Ñ}Á…Ñ ¤)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸½Áå}Ý½É­ÍÁ…•}Ñ•áÐ¡Ù…±Õ”èÍÑÉ¥¹œ¤ì(€±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡Ù…±Õ”¤)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸Ý…Ñ¡}Ý½É­ÍÁ…”¡Í•¹‘•Èè]•‰½¹Ñ•¹ÑÌ°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ¤ì(€ÍÑ½Á}Ý½É­ÍÁ…•}Ý…Ñ ¡Í•¹‘•È¹¥¤(€½¹ÍÐÉ•Í½±Ù•‘}É½½Ð€ôÉ•Í½±Ù”¡É½½Ñ}Á…Ñ ¤(€½¹ÍÐÍ•¹‘}¡…¹”€ô€¡•Ù•¹Ñ}ÑåÁ”èÍÑÉ¥¹œ°™¥±•}¹…µ”èÍÑÉ¥¹œð	Õ™™•Èð¹Õ±°¤€ôøì(€€€¥˜€¡Í•¹‘•È¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€É•ÑÕÉ¸(€€€ô((€€€½¹ÍÐ¡…¹•‘}Á…Ñ €ô™¥±•}¹…µ”€üÉ•Í½±Ù”¡É•Í½±Ù•‘}É½½Ð°™¥±•}¹…µ”¹Ñ½MÑÉ¥¹œ ¤¤€èÉ•Í½±Ù•‘}É½½Ð(€€€Í•¹‘•È¹Í•¹ Ý½É­ÍÁ…”é¡…¹•œ°ì(€€€€€É½½Ñ}Á…Ñ èÉ•Í½±Ù•‘}É½½Ð°(€€€€€•Ù•¹Ñ}ÑåÁ”°(€€€€€™¥±•}Á…Ñ è¡…¹•‘}Á…Ñ °(€€€ô¤(€ô(€±•ÐÝ…Ñ¡•ÈèM]…Ñ¡•È((€ÑÉäì(€€€Ý…Ñ¡•È€ôÝ…Ñ ¡É•Í½±Ù•‘}É½½Ð°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô°Í•¹‘}¡…¹”¤(€ô…Ñ ì(€€€Ý…Ñ¡•È€ôÝ…Ñ ¡É•Í½±Ù•‘}É½½Ð°Í•¹‘}¡…¹”¤(€ô((€Ý…Ñ¡•È¹½¸ •ÉÉ½Èœ°€¡•ÉÉ½È¤€ôøì(€€€¥˜€ …Í•¹‘•È¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€Í•¹‘•È¹Í•¹ Ý½É­ÍÁ…”éÝ…Ñ µ•ÉÉ½Èœ°ì(€€€€€€€É½½Ñ}Á…Ñ èÉ•Í½±Ù•‘}É½½Ð°(€€€€€€€µ•ÍÍ…”è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€ô¤(€€€ô(€ô¤((€Ý½É­ÍÁ…•}Ý…Ñ¡•ÉÌ¹Í•Ð¡Í•¹‘•È¹¥°ì(€€€½Ý¹•É}¥èÍ•¹‘•È¹¥°(€€€É½½Ñ}Á…Ñ èÉ•Í½±Ù•‘}É½½Ð°(€€€Ý…Ñ¡•È°(€ô¤((€É•ÑÕÉ¸ÑÉÕ”)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸ÍÑ½Á}Ý½É­ÍÁ…•}Ý…Ñ ¡½Ý¹•É}¥è¹Õµ‰•È¤ì(€½¹ÍÐ•¹ÑÉä€ôÝ½É­ÍÁ…•}Ý…Ñ¡•ÉÌ¹•Ð¡½Ý¹•É}¥¤((€¥˜€ …•¹ÑÉä¤ì(€€€É•ÑÕÉ¸(€ô((€Ý½É­ÍÁ…•}Ý…Ñ¡•ÉÌ¹‘•±•Ñ”¡½Ý¹•É}¥¤(€•¹ÑÉä¹Ý…Ñ¡•È¹±½Í” ¤)ô(((¼¼•¹Ð™¥±”…ÕÑ¡½É¥Ñä¥Ì•áÁ½Í•Ñ¡É½Õ ‘•‘¥…Ñ•%A¡…¹¹•±ÌÍ¼É•¹‘•É•ÈµÍ¥‘”…ÕÑ½¹½µ½ÕÌ(¼¼Ñ½½±ÌÉ•Ñ…¥¸Ñ¡”Í…µ”…¹½¹¥…°Ý½É­ÍÁ…”½Íåµ±¥¹¬‰½Õ¹‘…Éä…Ì‘¥É•ÐÝ½É­ÍÁ…”½Á•É…Ñ¥½¹Ì¸)¥˜€¡¥Á5…¥¸ü¹¡…¹‘±”¤ì(€¥Á5…¥¸¹¡…¹‘±” Ý½É­ÍÁ…”é…•¹ÐµÉ•…µ™¥±”œ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ¤€ôøì(€€€É•ÑÕÉ¸É•…‘}…•¹Ñ}Ý½É­ÍÁ…•}™¥±”¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ ¤(€ô¤((€¥Á5…¥¸¹¡…¹‘±” (€€€€Ý½É­ÍÁ…”é…•¹ÐµÝÉ¥Ñ”µ™¥±”œ°(€€€…Íå¹Œ€¡•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ°½¹Ñ•¹ÐèÍÑÉ¥¹œ°•áÁ•Ñ•‘}É•Ù¥Í¥½¸èÍÑÉ¥¹œð¹Õ±°¤€ôøì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÝÉ¥Ñ•}…•¹Ñ}Ý½É­ÍÁ…•}™¥±”¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ °½¹Ñ•¹Ð°•áÁ•Ñ•‘}É•Ù¥Í¥½¸¤(€€€€€¥˜€ …•Ù•¹Ð¹Í•¹‘•È¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€€€•Ù•¹Ð¹Í•¹‘•È¹Í•¹ Ý½É­ÍÁ…”é¡…¹•œ°ì(€€€€€€€€€É½½Ñ}Á…Ñ èÉ•Í½±Ù”¡É½½Ñ}Á…Ñ ¤°(€€€€€€€€€•Ù•¹Ñ}ÑåÁ”è€¡…¹”œ°(€€€€€€€€€™¥±•}Á…Ñ èÉ•ÍÕ±Ð¹Á…Ñ °(€€€€€€€ô¤(€€€€€ô(€€€€€É•ÑÕÉ¸É•ÍÕ±Ð(€€€ô°(€€¤((€¥Á5…¥¸¹¡…¹‘±” Ý½É­ÍÁ…”é…•¹ÐµÍÑ…Ðœ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ¤€ôøì(€€€É•ÑÕÉ¸ÍÑ…Ñ}…•¹Ñ}Ý½É­ÍÁ…•}Á…Ñ ¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ ¤(€ô¤((€¥Á5…¥¸¹¡…¹‘±” (€€€€Ý½É­ÍÁ…”é…•¹Ðµ±¥ÍÐœ°(€€€…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°Ñ…É•Ñ}Á…Ñ èÍÑÉ¥¹œ°‘•ÁÑ è¹Õµ‰•È¤€ôøì(€€€€€É•ÑÕÉ¸±¥ÍÑ}…•¹Ñ}Ý½É­ÍÁ…”¡É½½Ñ}Á…Ñ °Ñ…É•Ñ}Á…Ñ °‘•ÁÑ ¤(€€€ô°(€€¤)ô(((¼¼¥Ð¥ÌÉ½½Ñ•Ñ¼Ñ¡”½Á•¸Ý½É­ÍÁ…”…¹•áÁ½Í•…ÌÍÑÉÕÑÕÉ•%AÍ¼¹•¥Ñ¡•ÈÑ¡”É•¹‘•É•È(¼¼¹½È…¸…•¹Ð¹••‘ÌÑ¼½¹ÍÑÉÕÐ…É‰¥ÑÉ…Éä¥ÐÍ¡•±°½µµ…¹‘Ì™½ÈÍ½ÕÉ”µ½¹ÑÉ½°½Á•É…Ñ¥½¹Ì¸)¥˜€¡¥Á5…¥¸ü¹¡…¹‘±”¤ì(€¥Á5…¥¸¹¡…¹‘±” ¥Ðé•¹ÍÕÉ”µÉ•Á½Í¥Ñ½Éäœ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ¤€ôø•¹ÍÕÉ•}Ý½É­ÍÁ…•}É•Á½Í¥Ñ½Éä¡É½½Ñ}Á…Ñ ¤¤(€¥Á5…¥¸¹¡…¹‘±” ¥ÐéÍÑ…ÑÕÌœ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ¤€ôø•Ñ}¥Ñ}ÍÑ…ÑÕÌ¡É½½Ñ}Á…Ñ ¤¤(€¥Á5…¥¸¹¡…¹‘±” ¥Ðé¡¥ÍÑ½Éäœ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°±¥µ¥Ðè¹Õµ‰•È¤€ôø•Ñ}¥Ñ}¡¥ÍÑ½Éä¡É½½Ñ}Á…Ñ °±¥µ¥Ð¤¤(€¥Á5…¥¸¹¡…¹‘±” ¥Ðé‘¥™˜œ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°™¥±•}Á…Ñ èÍÑÉ¥¹œ¤€ôø•Ñ}¥Ñ}‘¥™˜¡É½½Ñ}Á…Ñ °™¥±•}Á…Ñ ¤¤(€¥Á5…¥¸¹¡…¹‘±” ¥ÐéÍÑ…”œ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°™¥±•}Á…Ñ¡ÌèÍÑÉ¥¹mt¤€ôøÍÑ…•}¥Ñ}Á…Ñ¡Ì¡É½½Ñ}Á…Ñ °™¥±•}Á…Ñ¡Ì¤¤(€¥Á5…¥¸¹¡…¹‘±” ¥ÐéÕ¹ÍÑ…”œ°…Íå¹Œ€¡}•Ù•¹Ð°É½½Ñ}Á…Ñ èÍÑÉ¥¹œ°‚â•êZ¶ˆÝš[™Ö×JHOˆ[œÝYÙWÙÚ]Ü]Ê›ÛÝÜ]š[WÜ]ÊJBˆ\ÓXZ[‹š[™J	ÙÚ]˜ÛÛ[Z]	Ë\Þ[˜È
Ù]™[›ÛÝÜ]ˆÝš[™ËY\ÜØYÙNˆÝš[™ÊHOˆÛÛ[Z]ÜÝYÙYØÚ[™Ù\Ê›ÛÝÜ]Y\ÜØYÙJJBˆ\ÓXZ[‹š[™J	ÙÚ]œ™[[Ý™K[™\ÝY\™\ÜÚ]ÜžIË\Þ[˜È
Ù]™[›ÛÝÜ]ˆÝš[™ËÚ]Ü]ˆÝš[™ÊHOˆ™[[Ý™WÛ™\ÝYÜ™\ÜÚ]ÜžJ›ÛÝÜ]Ú]Ü]
JBˆ\ÓXZ[‹š[™J	ÙÚ]œ™\\™KXYÙ[\[‰Ë\Þ[˜È
Ù]™[›ÛÝÜ]ˆÝš[™Ë[—ÚYˆÝš[™ÊHOˆ™\\™WØYÙ[ÙÚ]Ü[Š›ÛÝÜ][—ÚY
JBˆ\ÓXZ[‹š[™J	ÙÚ]˜ÛÛ[Z]XYÙ[XÚ[™Ù\ÉË\Þ[˜È
Ù]™[›ÛÝÜ]ˆÝš[™Ë'Våö–C¢7G&–ærÂvöÃ¢7G&–ær’Óâ6öÖÖ—EövVçEö6†ævW2‡&ö÷E÷F‚Â'Våö–BÂvöÂ’¢—4Ö–âæöâ‚vv—C¦&æFöâÖvVçB×'VârÂ…öWfVçBÂ'Våö–C¢7G&–ær’Óâ&æFöåövVçEöv—E÷'Vâ‡'Våö–B’§Ð