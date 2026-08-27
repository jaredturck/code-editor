import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create_editor_file_authority } from '../src/chat/editorFileAuthority'

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
}))

const original_editor_api = window.editor_api

afterEach(() => {
  window.editor_api = original_editor_api
})

describe('editor-aware agent filesystem', () => {
  it('edits the live dirty buffer and rejects a later human collision', async () => {
    let editor_content = 'const value = 2\n'
    const apply_content = vi.fn((_path: string, content: string) => {
      editor_content = content
    })
    const agent_write_file = vi.fn()

    window.editor_api = {
      platform: 'linux',
      workspace: {
        agent_read_file: vi.fn(async () => ({
          path: '/workspace/src/value.ts',
          content: 'const value = 1\n',
          revision: 'disk-1',
          size: 16,
          modified_time: 1,
        })),
        agent_write_file,
      },
    } as unknown as typeof window.editor_api

    const authority = create_editor_file_authority('/workspace', {
      get_snapshot: () => ({ file_path: '/workspace/src/value.ts', content: editor_content, dirty: true }),
      apply_content,
    })!

    await authority.execute('files.read', { path: 'src/value.ts', lineNumbers: false })
    await authority.execute('files.edit', {
      path: 'src/value.ts',
      oldText: 'value = 2',
      newText: 'value = 3',
    })

    expect(editor_content).toContain('value = 3')
    expect(agent_write_file).not.toHaveBeenCalled()

    editor_content = 'const value = 4\n'
    await expect(
      authority.execute('files.edit', {
        path: 'src/value.ts',
        oldText: 'value = 3',
        newText: 'value = 5',
      }),
    ).rejects.toThrow(/changed after the agent last read/i)
  })

  it('uses optional workspace reads when probing a new file', async () => {
    const agent_read_file = vi.fn(async (_root: string, target: string, optional = false) => {
      if (!optional) throw new Error('Missing files must use the optional read path in this test.')
      return {
        path: `/workspace/${target}`,
        content: '',
        revision: '',
        size: 0,
        modified_time: 0,
        missing: true,
      }
    })
    const agent_write_file = vi.fn(async (_root: string, target: string, content: string) => ({
      path: `/workspace/${target}`,
      revision: 'disk-new',
      size: content.length,
    }))

    window.editor_api = {
      platform: 'linux',
      workspace: {
        agent_read_file,
        agent_write_file,
      },
    } as unknown as typeof window.editor_api

    const authority = create_editor_file_authority('/workspace', {
      get_snapshot: () => null,
      apply_content: vi.fn(),
    })!

    await authority.execute('files.write', { path: 'new.ts', content: 'export const value = 1\n' })

    expect(agent_read_file).toHaveBeenCalledWith('/workspace', 'new.ts', true)
    expect(agent_read_file.mock.calls.every((call) => call[2] === true)).toBe(true)
    expect(agent_write_file).toHaveBeenCalled()
  })

  it('creates missing parent directories for a new nested agent file', async () => {
    const { read_agent_workspace_file, write_agent_workspace_file } = await import('../electron/workspace.cts')
    const root = await mkdtemp(join(tmpdir(), 'code-editor-workspace-'))
    const target = join(root, 'templates', 'index.html')
    const content = '<h1>Home</h1>\n'

    await write_agent_workspace_file(root, target, content, null)
    const saved = await read_agent_workspace_file(root, target)

    expect(saved.path).toBe(target)
    expect(saved.content).toBe(content)
  })

  it('treats missing optional project-skill paths as an expected state', async () => {
    const { list_agent_workspace, read_agent_workspace_file } = await import('../electron/workspace.cts')
    const root = await mkdtemp(join(tmpdir(), 'code-editor-workspace-'))
    const settings_path = join(root, '.iris', 'skills.json')
    const skills_path = join(root, '.iris', 'skills')

    await expect(read_agent_workspace_file(root, settings_path, true)).resolves.toMatchObject({
      path: settings_path,
      missing: true,
    })
    await expect(list_agent_workspace(root, skills_path, 3, true)).resolves.toMatchObject({
      rootPath: skills_path,
      missing: true,
      tree: { path: skills_path, type: 'directory', children: [] },
    })
    await expect(read_agent_workspace_file(root, settings_path)).rejects.toThrow(/does not exist/i)
  })

  it('blocks a workspace symlink that resolves outside the workspace', async () => {
    const { read_agent_workspace_file } = await import('../electron/workspace.cts')
    const root = await mkdtemp(join(tmpdir(), 'code-editor-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'code-editor-outside-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, join(root, 'src', 'escape'))

    await expect(read_agent_workspace_file(root, join(root, 'src', 'escape', 'secret.txt'))).rejects.toThrow(
      /outside the open workspace/i,
    )
  })

  it('blocks Explorer directory reads through an outside workspace symlink', async () => {
    const { read_workspace_directory } = await import('../electron/workspace.cts')
    const root = await mkdtemp(join(tmpdir(), 'code-editor-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'code-editor-outside-'))
    const escape = join(root, 'escape')
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, escape)

    await expect(read_workspace_directory(root, escape)).rejects.toThrow(/outside the open workspace/i)
  })

  it('blocks Explorer creates through an outside workspace symlink', async () => {
    const { create_workspace_entry } = await import('../electron/workspace.cts')
    const root = await mkdtemp(join(tmpdir(), 'code-editor-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'code-editor-outside-'))
    const escape = join(root, 'escape')
    await symlink(outside, escape)

    await expect(create_workspace_entry(root, escape, 'created-outside.txt', 'file')).rejects.toThrow(
      /outside the open workspace/i,
    )
  })
})
