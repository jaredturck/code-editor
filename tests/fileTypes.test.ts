// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { get_file_kind } = require('../dist-electron/files.cjs') as {
  get_file_kind: (name: string) => string
}

describe('file type routing', () => {
  it.each([
    ['photo.png', 'image'],
    ['movie.mp4', 'video'],
    ['track.flac', 'audio'],
    ['manual.pdf', 'pdf'],
    ['main.py', 'text'],
  ])('routes %s to %s', (name, kind) => {
    expect(get_file_kind(name)).toBe(kind)
  })
})
