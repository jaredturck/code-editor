// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { analyze_document } = require('../dist-electron/diagnostics.cjs') as {
  analyze_document: (request: {
    language: string
    content: string
    file_path: string
  }) => Promise<Array<{ source: string; code?: string; severity: string }>>
}

describe('diagnostic providers', () => {
  it('finds Python syntax problems with Ruff WASM', async () => {
    const diagnostics = await analyze_document({
      language: 'Python',
      content: 'def broken(:\n    pass\n',
      file_path: 'broken.py',
    })

    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0].source).toBe('Ruff')
  })

  it('finds JavaScript errors with ESLint', async () => {
    const diagnostics = await analyze_document({
      language: 'JavaScript',
      content: 'const value = missingName\n',
      file_path: 'main.js',
    })

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'no-undef')).toBe(true)
  })

  it('finds malformed JSON', async () => {
    const diagnostics = await analyze_document({
      language: 'JSON',
      content: '{"name": }',
      file_path: 'data.json',
    })

    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
  })
})
