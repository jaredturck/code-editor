import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Agent Chat restore lifecycle', () => {
  it('allows React Strict Mode to restart the secure-chat restore effect', () => {
    const hook = source('src/hooks/useAIChat.ts')

    expect(hook).not.toContain('restoring_started_ref')
    expect(hook).toContain('let cancelled = false')
    expect(hook).toContain('if (!cancelled) set_restoring_chat(false)')
  })

  it('keeps Strict Mode enabled after the restore lifecycle fix', () => {
    const renderer = source('src/main.tsx')

    expect(renderer).toContain("import { StrictMode } from 'react'")
    expect(renderer).toContain('<StrictMode>')
    expect(renderer).toContain('</StrictMode>')
  })
})
