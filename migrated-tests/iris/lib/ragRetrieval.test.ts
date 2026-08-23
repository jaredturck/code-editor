import { describe, expect, it } from 'vitest'
import { buildTemporaryRagChunks, rankRagPassages } from '@/platform/agent/ragRetrieval'

describe('ragRetrieval', () => {
  const files = [
    {
      path: '/project/src/providers.ts',
      name: 'providers.ts',
      summary: 'Provider settings and model selection',
      semanticScore: 0.92,
      content: [
        'export function selectProviderModel(model) {',
        '  return model;',
        '}',
        '',
        'export function validateCredential(key) {',
        '  return key.length > 10;',
        '}',
      ].join('\n'),
    },
    {
      path: '/project/README.md',
      name: 'README.md',
      summary: 'General project documentation',
      semanticScore: 0.5,
      content: 'Welcome to the project. This file explains installation.',
    },
  ]

  it('creates temporary line-addressable chunks without a persistent store', () => {
    const chunks = buildTemporaryRagChunks(files, 3, 1, 200)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      path: '/project/src/providers.ts',
      startLine: 1,
    })
  })

  it('ranks matching file passages above unrelated content', () => {
    const passages = rankRagPassages('validate provider credential model', files, 4)
    expect(passages[0].path).toBe('/project/src/providers.ts')
    expect(passages[0].content).toContain('validateCredential')
    expect(passages[0].startLine).toBeGreaterThanOrEqual(1)
    expect(passages[0].endLine).toBeGreaterThanOrEqual(passages[0].startLine)
  })
})
