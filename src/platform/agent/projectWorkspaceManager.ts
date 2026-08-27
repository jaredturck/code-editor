import { executeTerminalCommand } from '@/platform/desktopBridge'
import { mutateProjectLedger, type ProjectCheckpoint } from '@/platform/agent/projectLedger'

export interface ProjectWorkerWorkspace {
  id: string
  root: string
  branch: string
  baseRef: string
  createdAt: number
}

let integrationQueue: Promise<unknown> = Promise.resolve()

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

function terminalText(result: any) {
  return String(result?.stdout || result?.output || result?.text || '').trim()
}

function serializeIntegration<T>(operation: () => Promise<T>): Promise<T> {
  const next = integrationQueue.then(operation, operation)
  integrationQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
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
  const statusText = terminalText(status)
  const created = await git(workspaceRoot, 'stash create')
  const ref = terminalText(created)
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

/** Rehydrate an existing harness-owned worktree recorded in the durable work item. */
export async function recoverWorkerWorkspace(root: string): Promise<ProjectWorkerWorkspace | null> {
  const workspaceRoot = String(root || '').trim()
  if (!workspaceRoot) return null
  try {
    const inside = terminalText(await git(workspaceRoot, 'rev-parse --is-inside-work-tree'))
    if (!/true/i.test(inside)) return null
    const branch = terminalText(await git(workspaceRoot, 'rev-parse --abbrev-ref HEAD'))
    const baseRef = terminalText(await git(workspaceRoot, 'merge-base HEAD HEAD~1')) || 'HEAD'
    return {
      id: sanitizeId(workspaceRoot.split(/[\\/]/).pop() || 'worker'),
      root: workspaceRoot,
      branch,
      baseRef,
      createdAt: Date.now(),
    }
  } catch {
    return null
  }
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
  return terminalText(result)
}

export async function workerWorkspaceStatus(worker: ProjectWorkerWorkspace) {
  const result = await executeTerminalCommand('git status --porcelain=v1', worker.root)
  return terminalText(result)
}

/** Commit any current worker mutations so a fresh context can resume from them later. */
export async function checkpointWorkerWorkspace(worker: ProjectWorkerWorkspace, message: string) {
  await executeTerminalCommand('git add -A', worker.root)
  const status = await workerWorkspaceStatus(worker)
  if (!status.trim()) {
    try {
      return terminalText(await executeTerminalCommand('git rev-parse HEAD', worker.root))
    } catch {
      return ''
    }
  }
  await executeTerminalCommand(`git commit -m ${quote(String(message || 'IRIS worker checkpoint').slice(0, 200))}`, worker.root)
  return terminalText(await executeTerminalCommand('git rev-parse HEAD', worker.root))
}

export async function abortWorkerIntegration(workspaceRoot: string) {
  try {
    return await git(workspaceRoot, 'cherry-pick --abort')
  } catch {
    return null
  }
}

/**
 * Integrate one worker at a time into the shared project workspace. Executors may run in parallel,
 * but integration is intentionally serialized so concurrent cherry-picks cannot corrupt the index
 * or race on overlapping files.
 */
export async function integrateWorkerCommit(workspaceRoot: string, commit: string) {
  const ref = String(commit || '').trim()
  if (!ref) throw new Error('Worker commit is required for integration.')
  return serializeIntegration(async () => {
    try {
      return await git(workspaceRoot, `cherry-pick --no-commit ${quote(ref)}`)
    } catch (error) {
      await abortWorkerIntegration(workspaceRoot)
      throw error
    }
  })
}

export async function restoreProjectCheckpoint(workspaceRoot: string, checkpoint: ProjectCheckpoint) {
  if (!checkpoint.ref) throw new Error('Checkpoint has no restorable Git ref.')
  return serializeIntegration(() => git(workspaceRoot, `restore --source=${quote(checkpoint.ref)} --staged --worktree .`))
}
