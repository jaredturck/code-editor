// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { normalize_ollama_url } = require('../dist-electron/ollama.cjs') as {
  normalize_ollama_url: (value: string) => string
}

describe('Ollama URL normalization', () => {
  it('uses the default local address and normalizes localhost', () => {
    expect(normalize_ollama_url('')).toBe('http://127.0.0.1:11434')
    expect(normalize_ollama_url('http://localhost:11434/')).toBe('http://127.0.0.1:11434')
  })
})
