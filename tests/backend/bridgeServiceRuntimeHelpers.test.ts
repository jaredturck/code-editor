/** Verifies the extracted bridge research and file-search stages retain their public data shapes. */

import { describe, expect, it } from 'vitest'
import {
  buildRipgrepFindResponse,
  extractStructuredWebContent,
  getRemoteModelInputCapabilities,
  webResearchQueryAnswered,
} from '../../backend/desktopBridge/services/bridgeServiceRuntime'

describe('web research modular helpers', () => {
  it('recognizes sufficiently complete accumulated query coverage', () => {
    const content = `${'IRIS indexing benchmark performance '.repeat(30)}complete.`
    expect(webResearchQueryAnswered('IRIS indexing benchmark performance', content)).toBe(true)
    expect(webResearchQueryAnswered('unrelated missing phrase', content)).toBe(false)
  })

  it('extracts bounded facts, code, and summary text', () => {
    const rawText = [
      'IRIS indexing measures each stage and reports detailed performance results.',
      'The benchmark framework compares indexing latency across repeated runs.',
      '```ts\nconst elapsed = end - start;\n```',
      'Additional unrelated material remains available after the relevant sentences.',
    ].join('\n')
    const result = extractStructuredWebContent(rawText, 'indexing benchmark')

    expect(result.keyFacts.length).toBeGreaterThan(0)
    expect(result.relevantCode).toContain('elapsed')
    expect(result.summary.length).toBeLessThanOrEqual(600)
  })
})

describe('file search modular helpers', () => {
  it('converts ripgrep matches into one bounded result per file', () => {
    const response = buildRipgrepFindResponse({
      rootPath: '/workspace',
      rawQuery: 'needle',
      normalizedMode: 'content',
      ignoreCase: true,
      maxDepth: 5,
      maxItems: 2,
      matches: [
        { file: '/workspace/a.txt', content: ' first   needle ', line: 1 },
        { file: '/workspace/a.txt', content: 'duplicate', line: 2 },
        { file: '/workspace/nested/b.txt', content: 'second needle', line: 3 },
      ],
    })

    expect(response.engine).toBe('ripgrep')
    expect(response.results).toEqual([
      {
        path: '/workspace/a.txt',
        relativePath: 'a.txt',
        type: 'file',
        match: 'content',
        excerpt: 'first needle',
      },
      {
        path: '/workspace/nested/b.txt',
        relativePath: 'nested/b.txt',
        type: 'file',
        match: 'content',
        excerpt: 'second needle',
      },
    ])
    expect(response.filesScanned).toBe(2)
    expect(response.truncated).toBe(true)
  })
})

describe('remote model capability discovery', () => {
  it('uses OpenRouter input modalities rather than model-name guessing', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'example/visual-model',
              architecture: { input_modalities: ['text', 'image'] },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    try {
      await expect(
        getRemoteModelInputCapabilities('openrouter', 'example/visual-model', 'test-key'),
      ).resolves.toMatchObject({
        image: true,
        audio: false,
        capabilities: ['text', 'image'],
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
