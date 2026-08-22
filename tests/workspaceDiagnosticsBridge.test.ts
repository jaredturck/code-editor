import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_text_file = vi.hoisted(() => vi.fn())
const analyze = vi.hoisted(() => vi.fn())

vi.mock('../src/platform/desktopBridge', () => ({
  readTextFile: read_text_file,
}))

vi.mock('../src/data/languages', () => ({
  get_language_for_file: () => 'Plain Text',
}))

import { analyzeWorkspaceFile, diagnostic_language_for_file } from '../src/platform/workspaceDiagnosticsBridge'

describe('workspace diagnostics bridge', () => {
  beforeEach(() => {
    read_text_file.mockReset()
    analyze.mockReset()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { editor_api: { diagnostics: { analyze } } },
    })
  })

  it('preserves concrete JSX/TSX and config-language extensions', () => {
    expect(diagnostic_language_for_file('/project/src/App.tsx')).toBe('tsx')
    expect(diagnostic_language_for_file('/project/src/App.jsx')).toBe('jsx')
    expect(diagnostic_language_for_file('/project/.eslintrc.jsonc')).toBe('jsonc')
    expect(diagnostic_language_for_file('/project/styles/site.scss')).toBe('scss')
  })

  it('analyzes the authoritative live file content and reports structured findings', async () => {
    read_text_file.mockResolvedValue({
      path: '/project/src/App.tsx',
      content: 'const value: string = 42',
      isBinary: false,
      revision: 'live-revision-7',
    })
    analyze.mockResolvedValue([
      {
        source: 'TypeScript',
        code: 'TS2322',
        severity: 'error',
        message: "Type 'number' is not assignable to type 'string'.",
        line: 1,
        column: 7,
        end_line: 1,
        end_column: 12,
      },
    ])

    const result = await analyzeWorkspaceFile('/project/src/App.tsx')

    expect(read_text_file).toHaveBeenCalledWith('/project/src/App.tsx', {
      actorId: 'orchestrator',
      lineNumbers: false,
    })
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      language: 'tsx',
      content: 'const value: string = 42',
      file_path: '/project/src/App.tsx',
    }))
    expect(result).toEqual(expect.objectContaining({
      supported: true,
      ok: false,
      clean: false,
      revision: 'live-revision-7',
      counts: { errors: 1, warnings: 0, info: 0, total: 1 },
    }))
  })

  it('reports unsupported languages instead of claiming they are clean', async () => {
    read_text_file.mockResolvedValue({
      path: '/project/main.rs',
      content: 'fn main() {}',
      isBinary: false,
      revision: 'r1',
    })

    const result = await analyzeWorkspaceFile('/project/main.rs')

    expect(result.supported).toBe(false)
    expect(result.ok).toBeNull()
    expect(result.clean).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })
})
