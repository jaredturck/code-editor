import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_text_file = vi.hoisted(() => vi.fn())

vi.mock('../src/platform/desktopBridge', () => ({
  readTextFile: read_text_file,
}))

vi.mock('../src/data/languages', () => ({
  get_language_for_file: () => 'Plain Text',
}))

import {
  formatWorkspaceDiagnostics,
  getWorkspaceDiagnosticsSnapshot,
  markWorkspaceDiagnosticsDirty,
  resetWorkspaceDiagnosticsForTests,
} from '../src/platform/agent/workspaceDiagnosticsState'

describe('workspace diagnostics state', () => {
  const root = '/project'
  const read_directory = vi.fn()
  const agent_read_file = vi.fn()
  const analyze = vi.fn()
  let change_listener: ((payload: { root_path: string; event_type: string; file_path: string }) => void) | null = null

  beforeEach(() => {
    resetWorkspaceDiagnosticsForTests()
    read_directory.mockReset()
    agent_read_file.mockReset()
    analyze.mockReset()
    change_listener = null

    read_directory.mockImplementation(async (_root_path: string, directory_path: string) => {
      if (directory_path === root) {
        return [
          { path: '/project/src', name: 'src', kind: 'directory', is_symlink: false },
          { path: '/project/node_modules', name: 'node_modules', kind: 'directory', is_symlink: false },
          { path: '/project/dist', name: 'dist', kind: 'directory', is_symlink: false },
          { path: '/project/package.json', name: 'package.json', kind: 'file', is_symlink: false },
        ]
      }
      if (directory_path === '/project/src') {
        return [
          { path: '/project/src/App.jsx', name: 'App.jsx', kind: 'file', is_symlink: false },
          { path: '/project/src/index.css', name: 'index.css', kind: 'file', is_symlink: false },
        ]
      }
      throw new Error(`Excluded directory should not be scanned: ${directory_path}`)
    })

    agent_read_file.mockImplementation(async (_root_path: string, file_path: string) => ({
      path: file_path,
      content: file_path.endsWith('.css') ? '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' : 'export default {}\n',
      revision: `revision:${file_path}`,
    }))

    analyze.mockImplementation(async (input: { file_path: string }) => {
      if (input.file_path.endsWith('App.jsx')) {
        return [
          {
            source: 'ESLint',
            code: null,
            severity: 'warning',
            message: 'No matching configuration found.',
            line: 1,
            column: 1,
            end_line: 1,
            end_column: 1,
          },
        ]
      }
      if (input.file_path.endsWith('index.css')) {
        return [1, 2, 3].map((line) => ({
          source: 'Stylelint',
          code: 'at-rule-no-unknown',
          severity: 'error',
          message: 'Unknown at-rule "@tailwind"',
          line,
          column: 1,
          end_line: line,
          end_column: 10,
        }))
      }
      return []
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        editor_api: {
          workspace: {
            read_directory,
            agent_read_file,
            on_change: (callback: typeof change_listener) => {
              change_listener = callback
              return () => {
                change_listener = null
              }
            },
          },
          diagnostics: { analyze },
        },
      },
    })
  })

  it('refreshes only the changed supported file after an ordinary source change', async () => {
    const first = await getWorkspaceDiagnosticsSnapshot(root)

    expect(first?.counts).toEqual({ errors: 3, warnings: 1, info: 0, total: 4 })
    expect(first?.analyzed_files).toBe(3)
    expect(read_directory).not.toHaveBeenCalledWith(root, '/project/node_modules')
    expect(read_directory).not.toHaveBeenCalledWith(root, '/project/dist')
    expect(formatWorkspaceDiagnostics(first)).toContain('3 errors · 1 warning')
    expect(formatWorkspaceDiagnostics(first)).toContain('src/index.css')

    const calls_after_first_scan = analyze.mock.calls.length
    await getWorkspaceDiagnosticsSnapshot(root)
    expect(analyze).toHaveBeenCalledTimes(calls_after_first_scan)

    analyze.mockClear()
    read_directory.mockClear()
    change_listener?.({
      root_path: root,
      event_type: 'change',
      file_path: '/project/src/App.jsx',
    })
    const refreshed = await getWorkspaceDiagnosticsSnapshot(root)

    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0][0].file_path).toBe('/project/src/App.jsx')
    expect(read_directory).not.toHaveBeenCalled()
    expect(refreshed?.counts).toEqual({ errors: 3, warnings: 1, info: 0, total: 4 })
  })

  it('accepts a known mutation path for a targeted diagnostics refresh', async () => {
    await getWorkspaceDiagnosticsSnapshot(root)
    analyze.mockClear()
    read_directory.mockClear()

    markWorkspaceDiagnosticsDirty(root, '/project/src/index.css')
    await getWorkspaceDiagnosticsSnapshot(root)

    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0][0].file_path).toBe('/project/src/index.css')
    expect(read_directory).not.toHaveBeenCalled()
  })

  it('falls back to a full scan after a structural workspace event', async () => {
    await getWorkspaceDiagnosticsSnapshot(root)
    analyze.mockClear()
    read_directory.mockClear()

    change_listener?.({
      root_path: root,
      event_type: 'rename',
      file_path: '/project/src/NewFile.jsx',
    })
    await getWorkspaceDiagnosticsSnapshot(root)

    const analyzed_paths = analyze.mock.calls.map(([input]) => input.file_path)
    expect(analyzed_paths).toContain('/project/src/App.jsx')
    expect(analyzed_paths).toContain('/project/src/index.css')
    expect(analyzed_paths).toContain('/project/package.json')
    expect(read_directory).toHaveBeenCalledWith(root, root)
  })
})
