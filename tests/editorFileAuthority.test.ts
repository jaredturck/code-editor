import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create_editor_file_authority } from '../src/chat/editorFileAuthority'

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
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
})
