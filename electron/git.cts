import { execFile } from 'node:child_process'
import { access, lstat, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)
const max_git_output = 10 * 1024 * 1024
const max_diff_chars = 240000
const iris_name = 'IRIS Editor'
const iris_email = 'noreply@iris-editor.local'
const nested_scan_skip = new Set([
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'coverage',
  'target',
  '.cache',
  '.next',
  '.turbo',
  'vendor',
  '__pycache__',
])

interface GitCommandResult {
  stdout: string
  stderr: string
  code: number
}

interface GitChange {
  path: string
  old_path: string | null
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

interface GitCommitSummary {
  hash: string
  short_hash: string
  subject: string
  author_name: string
  author_email: string
  date: string
}

interface GitRepositoryStatus {
  root_path: string
  branch: string
  head: string | null
  clean: boolean
  changes: GitChange[]
  nested_repositories: string[]
}

interface AgentGitRunState {
  root_path: string
}

const agent_git_runs = new Map<string, AgentGitRunState>()
const nested_scan_cache = new Map<string, { at: number; paths: string[] }>()
const nested_scan_cache_ms = 2000

function normalize_case(file_path: string) {
  return process.platform === 'win32' ? file_path.toLowerCase() : file_path
}

function path_is_inside(root_path: string, target_path: string) {
  const path_difference = relative(normalize_case(resolve(root_path)), normalize_case(resolve(target_path)))
  return (
    path_difference === '' ||
    (!path_difference.startsWith(`..${sep}`) && path_difference !== '..' && !isAbsolute(path_difference))
  )
}

async function path_exists(file_path: string) {
  return access(file_path)
    .then(() => true)
    .catch(() => false)
}

async function canonical_workspace_root(root_path: string) {
  const canonical_root = await realpath(resolve(root_path))
  const root_stat = await stat(canonical_root)

  if (!root_stat.isDirectory()) {
    throw new Error('The open workspace root is not a directory.')
  }

  return canonical_root
}

async function run_git(
  root_path: string,
  args: string[],
  options: { allow_failure?: boolean; identity_fallback?: boolean } = {},
): Promise<GitCommandResult> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  }

  if (options.identity_fallback) {
    const [configured_name, configured_email] = await Promise.all([
      read_git_config(root_path, 'user.name'),
      read_git_config(root_path, 'user.email'),
    ])
    const name = configured_name || iris_name
    const email = configured_email || iris_email
    Object.assign(env, {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    })
  }

  try {
    const result = await exec_file('git', args, {
      cwd: root_path,
      env,
      maxBuffer: max_git_output,
      windowsHide: true,
    })
    return { stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), code: 0 }
  } catch (error) {
    const command_error = error as Error & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
    }
    const stdout = String(command_error.stdout || '')
    const stderr = String(command_error.stderr || '')
    const code = typeof command_error.code === 'number' ? command_error.code : 1

    if (options.allow_failure) {
      return { stdout, stderr, code }
    }

    throw new Error((stderr || stdout || command_error.message || 'Git command failed.').trim())
  }
}

async function read_git_config(root_path: string, key: string) {
  const result = await run_git(root_path, ['config', '--get', key], { allow_failure: true })
  return result.code === 0 ? result.stdout.trim() : ''
}

async function validate_repository_root(root_path: string) {
  const canonical_root = await canonical_workspace_root(root_path)
  const result = await run_git(canonical_root, ['rev-parse', '--show-toplevel'])
  const repository_root = await realpath(result.stdout.trim())

  if (normalize_case(repository_root) !== normalize_case(canonical_root)) {
    throw new Error('Git repository root does not match the open workspace root.')
  }

  return canonical_root
}

async function scan_nested_repositories(root_path: string, force = false) {
  const canonical_root = await canonical_workspace_root(root_path)
  const cached = nested_scan_cache.get(canonical_root)
  if (!force && cached && Date.now() - cached.at < nested_scan_cache_ms) {
    return [...cached.paths]
  }
  const nested_repositories: string[] = []
  const queue = [canonical_root]
  let visited = 0

  while (queue.length > 0 && visited < 10000) {
    const directory_path = queue.shift()!
    visited += 1
    const entries = await readdir(directory_path, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entry_path = join(directory_path, entry.name)
      if (entry.name === '.git') {
        if (normalize_case(directory_path) !== normalize_case(canonical_root)) {
          nested_repositories.push(entry_path)
        }
        continue
      }
      if (!entry.isDirectory()) continue
      if (nested_scan_skip.has(entry.name)) continue
      queue.push(entry_path)
    }
  }

  const sorted = nested_repositories.sort((first, second) => first.localeCompare(second))
  nested_scan_cache.set(canonical_root, { at: Date.now(), paths: sorted })
  return [...sorted]
}

function git_status_label(index_status: string, worktree_status: string) {
  if (index_status === '?' && worktree_status === '?') return 'untracked'
  if (index_status === 'R' || worktree_status === 'R') return 'renamed'
  if (index_status === 'D' || worktree_status === 'D') return 'deleted'
  if (index_status === 'A' || worktree_status === 'A') return 'added'
  if (index_status === 'C' || worktree_status === 'C') return 'copied'
  if (index_status === 'U' || worktree_status === 'U') return 'conflict'
  return 'modified'
}

function parse_porcelain_status(raw_status: string) {
  const records = raw_status.split('\0')
  const changes: GitChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 3) continue
    const index_status = record[0]
    const worktree_status = record[1]
    const path = record.slice(3)
    const rename_or_copy =
      index_status === 'R' || index_status === 'C' || worktree_status === 'R' || worktree_status === 'C'
    const old_path = rename_or_copy ? records[++index] || null : null
    const untracked = index_status === '?' && worktree_status === '?'

    changes.push({
      path,
      old_path,
      status: git_status_label(index_status, worktree_status),
      staged: !untracked && index_status !== ' ' && index_status !== '!',
      unstaged: untracked || worktree_status !== ' ',
      untracked,
    })
  }

  return changes
}

async function current_branch(root_path: string) {
  const symbolic = await run_git(root_path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allow_failure: true })
  if (symbolic.code === 0 && symbolic.stdout.trim()) return symbolic.stdout.trim()
  const detached = await run_git(root_path, ['rev-parse', '--short', 'HEAD'], { allow_failure: true })
  return detached.code === 0 && detached.stdout.trim() ? `detached@${detached.stdout.trim()}` : 'main'
}

async function current_head(root_path: string) {
  const result = await run_git(root_path, ['rev-parse', '--verify', 'HEAD'], { allow_failure: true })
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null
}

async function has_staged_changes(root_path: string) {
  const result = await run_git(root_path, ['diff', '--cached', '--quiet'], { allow_failure: true })
  return result.code === 1
}

function build_agent_commit_message(goal: string) {
  const clean_goal = String(goal || '')
    .replace(/\s+/g, ' ')
    .trim()
  const subject = clean_goal ? `IRIS: ${clean_goal.slice(0, 68)}` : 'IRIS: update project'
  return `${subject}\n\nCo-authored-by: ${iris_name} <${iris_email}>`
}

async function create_commit(root_path: string, message: string, identity_fallback: boolean) {
  await run_git(root_path, ['commit', '-m', message], { identity_fallback })
  const hash = await current_head(root_path)
  return hash
}

export async function ensure_workspace_repository(root_path: string) {
  const canonical_root = await canonical_workspace_root(root_path)
  const git_path = join(canonical_root, '.git')
  let initialized = false

  if (!(await path_exists(git_path))) {
    const initial = await run_git(canonical_root, ['init', '--initial-branch=main', '.'], { allow_failure: true })
    if (initial.code !== 0) {
      await run_git(canonical_root, ['init', '.'])
    }
    initialized = true
  } else {
    const git_stat = await lstat(git_path)
    if (!git_stat.isDirectory() && !git_stat.isFile()) {
      throw new Error('The workspace .git entry is not a valid Git repository marker.')
    }
  }

  await validate_repository_root(canonical_root)
  return {
    root_path: canonical_root,
    initialized,
    nested_repositories: await scan_nested_repositories(canonical_root, initialized),
  }
}

export async function get_git_status(root_path: string): Promise<GitRepositoryStatus> {
  const ensured = await ensure_workspace_repository(root_path)
  const result = await run_git(ensured.root_path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const changes = parse_porcelain_status(result.stdout)

  return {
    root_path: ensured.root_path,
    branch: await current_branch(ensured.root_path),
    head: await current_head(ensured.root_path),
    clean: changes.length === 0,
    changes,
    nested_repositories: ensured.nested_repositories,
  }
}

export async function get_git_history(root_path: string, limit = 20): Promise<GitCommitSummary[]> {
  const canonical_root = await validate_repository_root(root_path)
  const safe_limit = Math.max(1, Math.min(100, Math.round(limit)))
  const result = await run_git(
    canonical_root,
    ['log', `-n${safe_limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%cI%x00'],
    { allow_failure: true },
  )

  if (result.code !== 0 || !result.stdout) return []

  return result.stdout
    .split('\0')
    .map((record) => record.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', short_hash = '', subject = '', author_name = '', author_email = '', date = ''] =
        record.split('\x1f')
      return { hash, short_hash, subject, author_name, author_email, date }
    })
    .filter((commit) => Boolean(commit.hash))
}

function ensure_git_relative_path(root_path: string, file_path: string) {
  const absolute_path = resolve(root_path, file_path)
  if (!path_is_inside(root_path, absolute_path)) {
    throw new Error('Git path is outside the open workspace.')
  }
  return relative(root_path, absolute_path).split(sep).join('/')
}

export async function get_git_diff(root_path: string, file_path: string) {
  const canonical_root = await validate_repository_root(root_path)
  const relative_path = ensure_git_relative_path(canonical_root, file_path)
  const status = await get_git_status(canonical_root)
  const change = status.changes.find((item) => item.path === relative_path)

  if (change?.untracked) {
    const absolute_path = resolve(canonical_root, relative_path)
    const content = await readFile(absolute_path)
    const binary = content.includes(0)
    const text = binary ? 'Binary file (untracked)' : content.toString('utf8')
    return {
      path: relative_path,
      staged: '',
      working: binary ? text : `--- /dev/null\n+++ b/${relative_path}\n${text.slice(0, max_diff_chars)}`,
    }
  }

  const [staged, working] = await Promise.all([
    run_git(canonical_root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--', relative_path], {
      allow_failure: true,
    }),
    run_git(canonical_root, ['diff', '--no-color', '--no-ext-diff', '--', relative_path], {
      allow_failure: true,
    }),
  ])

  return {
    path: relative_path,
    staged: staged.stdout.slice(0, max_diff_chars),
    working: working.stdout.slice(0, max_diff_chars),
  }
}

export async function stage_git_paths(root_path: string, file_paths: string[]) {
  const canonical_root = await validate_repository_root(root_path)
  const paths = file_paths.map((file_path) => ensure_git_relative_path(canonical_root, file_path))
  await run_git(canonical_root, paths.length > 0 ? ['add', '-A', '--', ...paths] : ['add', '-A'])
  return get_git_status(canonical_root)
}

export async function unstage_git_paths(root_path: string, file_paths: string[]) {
  const canonical_root = await validate_repository_root(root_path)
  const paths = file_paths.map((file_path) => ensure_git_relative_path(canonical_root, file_path))
  const head = await current_head(canonical_root)

  if (head) {
    await run_git(canonical_root, paths.length > 0 ? ['reset', '-q', 'HEAD', '--', ...paths] : ['reset', '-q', 'HEAD'])
  } else {
    await run_git(
      canonical_root,
      paths.length > 0
        ? ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...paths]
        : ['rm', '--cached', '-r', '--ignore-unmatch', '.'],
      { allow_failure: true },
    )
  }

  return get_git_status(canonical_root)
}

export async function commit_staged_changes(root_path: string, message: string) {
  const canonical_root = await validate_repository_root(root_path)
  const clean_message = String(message || '').trim()
  if (!clean_message) throw new Error('A commit message is required.')
  if (!(await has_staged_changes(canonical_root))) throw new Error('There are no staged changes to commit.')

  const [name, email] = await Promise.all([
    read_git_config(canonical_root, 'user.name'),
    read_git_config(canonical_root, 'user.email'),
  ])
  if (!name || !email) {
    throw new Error('Configure git user.name and user.email before creating a manual commit.')
  }

  const hash = await create_commit(canonical_root, clean_message, false)
  return { hash, status: await get_git_status(canonical_root) }
}

export async function remove_nested_repository(root_path: string, git_path: string) {
  const canonical_root = await validate_repository_root(root_path)
  const absolute_git_path = resolve(canonical_root, git_path)
  const root_git_path = resolve(canonical_root, '.git')

  if (!path_is_inside(canonical_root, absolute_git_path) || basename(absolute_git_path) !== '.git') {
    throw new Error('Only nested .git metadata inside the open workspace can be removed.')
  }
  if (normalize_case(absolute_git_path) === normalize_case(root_git_path)) {
    throw new Error('The workspace root Git repository cannot be removed.')
  }

  await rm(absolute_git_path, { recursive: true, force: false })
  nested_scan_cache.delete(canonical_root)
  return get_git_status(canonical_root)
}

export async function prepare_agent_git_run(root_path: string, run_id: string) {
  const ensured = await ensure_workspace_repository(root_path)
  const nested_repositories = await scan_nested_repositories(ensured.root_path, true)
  if (nested_repositories.length > 0) {
    throw new Error(
      `Nested Git repository metadata must be removed before an autonomous run: ${nested_repositories.join(', ')}`,
    )
  }

  const status = await get_git_status(ensured.root_path)
  let baseline_commit: string | null = null

  if (!status.clean) {
    await run_git(ensured.root_path, ['add', '-A'])
    if (await has_staged_changes(ensured.root_path)) {
      baseline_commit = await create_commit(ensured.root_path, 'Workspace baseline before IRIS run', true)
    }
  }

  agent_git_runs.set(run_id, { root_path: ensured.root_path })

  return {
    root_path: ensured.root_path,
    baseline_commit,
    head: await current_head(ensured.root_path),
  }
}

export async function commit_agent_changes(root_path: string, run_id: string, goal: string) {
  const canonical_root = await validate_repository_root(root_path)
  const run_state = agent_git_runs.get(run_id)
  if (run_state && run_state.root_path !== canonical_root) {
    throw new Error('Agent Git run does not belong to the current workspace root.')
  }
  const nested_after = await scan_nested_repositories(canonical_root, true)
  const removed_nested_repositories: string[] = []

  for (const nested_git_path of nested_after) {
    await rm(nested_git_path, { recursive: true, force: false })
    removed_nested_repositories.push(nested_git_path)
  }
  if (removed_nested_repositories.length > 0) nested_scan_cache.delete(canonical_root)

  await run_git(canonical_root, ['add', '-A'])
  let commit: string | null = null
  if (await has_staged_changes(canonical_root)) {
    commit = await create_commit(canonical_root, build_agent_commit_message(goal), true)
  }

  agent_git_runs.delete(run_id)
  return {
    root_path: canonical_root,
    commit,
    removed_nested_repositories,
    status: await get_git_status(canonical_root),
  }
}

export function abandon_agent_git_run(run_id: string) {
  agent_git_runs.delete(run_id)
}
