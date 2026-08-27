import { executeTerminalCommand } from '@/platform/desktopBridge'
import { mutateProjectLedger, type ProjectCheckpoint } from '@/platform/agent/projectLedger'

export interface ProjectWorkerWorkspace {
  id: string
  root: string
  branch: string
  baseRef: string
  createdAt: number
}

function quote(value: string) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`
}

function sanitizeId(value: string) {
  return String(value || 'worker')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'worker'
}

function siblingRoot(workspaceRoot: string) {
  const root = String(workspaceRoot || '').replace(/[\\/]+$/, '')
  return `${root}.iris-worktrees`
}

async function git(workspaceRoot: string, args: string) {
  return executeTerminalCommand(`git ${args}`, workspaceRoot)
}

export async function projectGitAvailable(workspaceRoot: string) {
  try {
    await git(workspaceRoot, 'rev-parse --is-inside-work-tree')
    return true
  } catch {
    return false
  }
}

export async function createProjectCheckpoint(
  chatId: string,
  goal: string,
  workspaceRoot: string,
  label = 'checkpoint',
): Promise<ProjectCheckpoint> {
  const status = await git(workspaceRoot, 'status --porcelain')
  const statusText = String((status as any)?.stdout || (status as any)?.output || '')
  // Stash-like snapshots are represented as tree commits without moving the user's branch.
  // `git stash create` returns a commit object while leaving index/worktree untouched.
  const created = await git(workspaceRoot, 'stash create')
  const ref = String((created as any)?.stdout || (created as any)?.output || '').trim()
  const checkpoint: ProjectCheckpoint = {
    id: `checkpoint-${Date.now().toString(36)}`,
    generation: 0,
    label: String(label || 'checkpoint').slice(0, 200),
    ref,
    summary: statusText.slice(0, 5000),
    createdAt: Date.now(),
  }
  mutateProjectLedger(chatId, goal, (ledger) => {
    checkpoint.generation = ledger.generation
    ledger.checkpoints.push(checkpoint)
    ledger.checkpoints = ledger.checkpoints.slice(-300)
  })
  return checkpoint
}

export async function createWorkerWorkspace(
  workspaceRoot: string,
  workerId: string,
  baseRef = 'HEAD',
): Promise<ProjectWorkerWorkspace> {
  const id = sanitizeId(workerId)
  const root = `${siblingRoot(workspaceRoot)}/${id}`
  const branch = `iris/${id}-${Date.now().toString(36)}`
  await executeTerminalCommand(`mkdir -p ${quote(siblingRoot(workspaceRoot))}`)
  await git(workspaceRoot, `worktree add -b ${quote(branch)} ${quote(root)} ${quote(baseRef)}`)
  return { id, root, branch, baseRef, createdAt: Date.now() }
}

export async function removeWorkerWorkspace(workspaceRoot: string, worker: ProjectWorkerWorkspace, force = true) {
  const flag = force ? '--force ' : ''
  await git(workspaceRoot, `worktree remove ${flag}${quote(worker.root)}`)
  try {
    await git(workspaceRoot, `branch -D ${quote(worker.branch)}`)
  } catch {
    // Branch cleanup is best-effort; the worktree removal is the important boundary.
  }
}

export async function workerWorkspaceDiff(worker: ProjectWorkerWorkspace) {
  const result = await executeTerminalCommand('git diff --binary HEAD', worker.root)
  return String((result as any)?.stdout || (result as any)?.output || '')
}

export async function workerWorkspaceStatus(worker: ProjectWorkerWorkspace) {
  const result = await executeTerminalCommand('git status --porcelain=v1', worker.root)
  return String((result as any)?.stdout || (result as any)?.output || '')
}

export async function checkpointWorkerWorkspace(worker: ProjectWorkerWorkspace, message: string) {
  // Worker branches are harness-owned and safe to commit. The user's active branch is never moved.
  await executeTerminalCommand('git add -A', worker.root)
  const status = await workerWorkspaceStatus(worker)
  if (!status.trim()) return ''
  await executeTerminalCommand(`git commit -m ${quote(String(message || 'IRIS worker checkpoint').slice(0, 200))}`, worker.root)
  const result = await executeTerminalCommand('git rev-parse HEAD', worker.root)
  return String((result as any)?.stdout || (result as any)?.output || '').trim()
}

export async function integrateWorkerCommit(workspaceRoot: string, commit: string) {
  const ref = String(commit || '').trim()
  if (!ref) throw new Error('Worker commit is required for integration.')
  // Apply without committing to the user's branch. The editor/harness can inspect and verify
  // before deciding how the final repository history should be represented.
  return git(workspaceRoot, `cherry-pick --no-commit ${quote(ref)}`)
}

export async function abortWorkerIntegration(workspaceRoot: string) {
  try {
    return await git(workspaceRoot, 'cherry-pick --abort')
  } catch {
    return null
  }
}

export async function restoreProjectCheckpoint(workspaceRoot: string, checkpoint: ProjectCheckpoint) {
  if (!checkpoint.ref) throw new Error('Checkpoint has no restorable Git ref.')
  // Restore files only; do not rewrite branch history.
  return git(workspaceRoot, `restore --source=${quote(checkpoint.ref)} --staged --worktree .`)
}
