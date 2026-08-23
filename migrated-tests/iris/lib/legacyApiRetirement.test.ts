/**
 * Prevents the retired hosted-platform compatibility surface from being reintroduced into
 * authored application source. Feature code must enter IRIS's local-first task/runtime paths.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RETIRED_FILES = ['src/api/base44Client.ts', 'src/api/base44Client.d.ts', 'src/api/platformClient.ts']
const RETIRED_TOKENS = ['InvokeLLM', 'add_context_from_internet', 'platformClient', 'base44Client']

function authoredSourceFiles(root: string): string[] {
  const output: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) output.push(...authoredSourceFiles(absolute))
    else if (/\.(?:ts|tsx|cts)$/.test(entry.name)) output.push(absolute)
  }
  return output
}

describe('retired hosted-platform compatibility API', () => {
  it('keeps the deleted compatibility modules absent', () => {
    for (const relativePath of RETIRED_FILES) {
      expect(fs.existsSync(path.resolve(relativePath)), relativePath).toBe(false)
    }
  })

  it('keeps retired API tokens out of authored application source', () => {
    const matches: string[] = []
    for (const file of authoredSourceFiles(path.resolve('src'))) {
      const text = fs.readFileSync(file, 'utf8')
      for (const token of RETIRED_TOKENS) {
        if (text.includes(token)) matches.push(`${path.relative(process.cwd(), file)}: ${token}`)
      }
    }
    expect(matches).toEqual([])
  })
})
