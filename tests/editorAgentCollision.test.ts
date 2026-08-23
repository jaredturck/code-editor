import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/desktopBridgeBase', () => ({
  listDirectory: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  editTextFile: vi.fn(),
  powerStat: vi.fn(),
  powerDiff: vi.fn(),
  powerPatch: vi.fn(),
  listSkillDefinitions: vi.fn(async () => ({ profile: 'test', skills: [] })),
  searchFileSemanticIndex: vi.fn(async () => []),
}))

vi.mock('@/platform/projectSkillLoader', () => ({
  loadProjectSkillDefinitions: vi.fn(async () => []),
  mergeProjectSkillDefinitions: (_global: unknown[]) => _global,
}))

import {
  editTextFile,
  readTextFile,
  setEditorFileAuthority,
  type EditorFileAuthority,
} from '../src/platform/desktopBridge'
import { clearAgentWriteLeases, releaseTaskWriteLeases } from '../src/platform/agent/writeLease'

interface FakeFile {
  content: string
  revision: number
}

const files = new Map<string, FakeFile>()

function revision(file: FakeFile) {
  return `rev-${file.revision}`
}

function fake_authority(): EditorFileAuthority {
  return {
    async execute(tool_name, args = {}) {
      const path = String(args.path || '')
      if (tool_name === 'files.list') {
        return {
          rootPath: '/workspace',
          tree: { name: 'workspace', path: '/workspace', type: 'directory', children: [] },
        }
      }
      const file = files.get(path)
      if (tool_name === 'files.read') {
        if (!file) throw new Error(`${path} does not exist`)
        return { path, content: file.content, isBinary: false, revision: revision(file) }
      }
      if (tool_name === 'files.edit') {
        if (!file) throw new Error(`${path} does not exist`)
        const old_text = String(args.oldText || '')
        if (!file.content.includes(old_text)) throw new Error('oldText mismatch')
        file.content = file.content.replace(old_text, String(args.newText || ''))
        file.revision += 1
        return { path, saved: true, revision: revision(file) }
      }
      throw new Error(`Unexpected tool ${tool_name}`)
    },
  }
}

beforeEach(() => {
  files.clear()
  files.set('/workspace/a.ts', { content: 'export const value = 1\n', revision: 1 })
  setEditorFileAuthority(fake_authority())
})

afterEach(() => {
  setEditorFileAuthority(null)
  clearAgentWriteLeases()
})

describe('editor-aware autonomous write collisions', () => {
  it('forces a stale agent to re-read after a human edit', async () => {
    await readTextFile('/workspace/a.ts', { actorId: 'executor#1', taskId: 'task-a' })

    const file = files.get('/workspace/a.ts')!
    file.content = 'export const value = 2\n'
    file.revision += 1

    await expect(
      editTextFile('/workspace/a.ts', 'value = 2', 'value = 3', {
        actorId: 'executor#1',
        taskId: 'task-a',
        holdLease: true,
      }),
    ).rejects.toThrow(/changed after executor#1 last read/)

    await readTextFile('/workspace/a.ts', { actorId: 'executor#1', taskId: 'task-a' })
    await expect(
      editTextFile('/workspace/a.ts', 'value = 2', 'value = 3', {
        actorId: 'executor#1',
        taskId: 'task-a',
        holdLease: true,
      }),
    ).resolves.toMatchObject({ saved: true })
  })

  it('blocks a fresh second agent until the owning task releases its file lease', async () => {
    await readTextFile('/workspace/a.ts', { actorId: 'executor#1', taskId: 'task-a' })
    await editTextFile('/workspace/a.ts', 'value = 1', 'value = 2', {
      actorId: 'executor#1',
      taskId: 'task-a',
      holdLease: true,
    })

    await readTextFile('/workspace/a.ts', { actorId: 'executor#2', taskId: 'task-b' })
    await expect(
      editTextFile('/workspace/a.ts', 'value = 2', 'value = 3', {
        actorId: 'executor#2',
        taskId: 'task-b',
        holdLease: true,
      }),
    ).rejects.toThrow(/Write lease conflict/)

    expect(releaseTaskWriteLeases('task-a')).toBe(1)
    await readTextFile('/workspace/a.ts', { actorId: 'executor#2', taskId: 'task-b' })
    await expect(
      editTextFile('/workspace/a.ts', 'value = 2', 'value = 3', {
        actorId: 'executor#2',
        taskId: 'task-b',
        holdLease: true,
      }),
    ).resolves.toMatchObject({ saved: true })
  })
})
