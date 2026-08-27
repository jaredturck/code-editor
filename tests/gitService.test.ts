import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  commit_agent_changes,
  ensure_workspace_repository,
  get_git_diff,
  get_git_history,
  get_git_status,
  prepare_agent_git_run,
  remove_nested_repository,
} from '../electron/git.cts'

const exec_file = promisify(execFile)

async function exists(file_path: string) {
  return access(file_path)
    .then(() => true)
    .catch(() => false)
}

describe('workspace Git service', () => {
  it('owns Git at the workspace root and creates IRIS-attributed agent commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'code-editor-git-'))
    await writeFile(join(root, 'existing.txt'), 'before\n', 'utf8')

    const ensured = await ensure_workspace_repository(root)
    expect(ensured.root_path).toBe(root)
    expect(await exists(join(root, '.git'))).toBe(true)

    const prepared = await prepare_agent_git_run(root, 'run-1')
    expect(prepared.baseline_commit).toBeTruthy()
    expect((await get_git_status(root)).clean).toBe(true)

    await mkdir(join(root, 'app', '.git'), { recursive: true })
    await writeFile(join(root, 'app', 'index.js'), 'console.log("hello")\n', 'utf8')
    await writeFile(join(root, 'existing.txt'), 'after\n', 'utf8')

    const committed = await commit_agent_changes(root, 'run-1', 'Build the example application')
    expect(committed.commit).toBeTruthy()
    expect(committed.removed_nested_repositories).toEqual([join(root, 'app', '.git')])
    expect(await exists(join(root, 'app', '.git'))).toBe(false)
    expect((await get_git_status(root)).clean).toBe(true)

    const history = await get_git_history(root, 2)
    expect(history[0]?.subject).toBe('IRIS: Build the example application')
    const { stdout } = await exec_file('git', ['log', '-1', '--pretty=%B'], { cwd: root })
    expect(stdout).toContain('Co-authored-by: IRIS Editor <noreply@iris-editor.local>')
    expect(await readFile(join(root, 'app', 'index.js'), 'utf8')).toContain('hello')
  })

  it('never allows the root Git repository to be removed as nested metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'code-editor-git-root-'))
    await ensure_workspace_repository(root)

    await expect(remove_nested_repository(root, join(root, '.git'))).rejects.toThrow(
      /workspace root Git repository cannot be removed/i,
    )
  })

  it('does not follow an untracked symlink target while rendering its diff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'code-editor-git-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'code-editor-git-outside-'))
    const secret_path = join(outside, 'secret.txt')
    const link_path = join(root, 'linked.txt')
    await writeFile(secret_path, 'outside-secret-content\n', 'utf8')
    await ensure_workspace_repository(root)
    await symlink(secret_path, link_path)

    const diff = await get_git_diff(root, link_path)

    expect(diff.working).toContain('Symbolic link ->')
    expect(diff.working).not.toContain('outside-secret-content')
  })
})
