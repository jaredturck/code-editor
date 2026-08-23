/** Verifies that bridge DuckDuckGo discovery prefers the injected Electron browser transport. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureDuckDuckGoBrowserProvider,
  getDuckDuckGoBrowserProviderState,
  normalizeDuckDuckGoSearchMode,
} from '../../server/desktopBridge/services/duckDuckGoBrowserProvider'
import { searchWithDuckDuckGoProvider } from '../../server/desktopBridge/services/bridgeServiceRuntime'

const releases: Array<() => void> = []
const context = {
  maxResults: 6,
  safeSearch: 0,
  safeSearchLabel: 'moderate',
  time: 0,
  timeRangeLabel: 'all',
  locale: 'en-gb',
  region: 'uk-en',
}

afterEach(() => {
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release())
})

describe('DuckDuckGo browser provider', () => {
  it('normalizes the explicit rollback modes', () => {
    expect(normalizeDuckDuckGoSearchMode('browser')).toBe('browser')
    expect(normalizeDuckDuckGoSearchMode('AUTO')).toBe('auto')
    expect(normalizeDuckDuckGoSearchMode('legacy')).toBe('legacy')
    expect(normalizeDuckDuckGoSearchMode('unknown', 'browser')).toBe('browser')
  })

  it('uses the Electron browser callback and preserves the existing provider result shape', async () => {
    const search = vi.fn(async () => ({
      results: [
        {
          title: 'Cat - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Cat',
          hostname: 'en.wikipedia.org',
          snippet: 'The cat is a small domesticated carnivorous mammal.',
        },
      ],
      relatedQueries: ['domestic cat'],
      pageUrl: 'https://duckduckgo.com/?q=what+is+a+cat',
    }))
    releases.push(configureDuckDuckGoBrowserProvider({ search, mode: 'browser' }))

    const result = await searchWithDuckDuckGoProvider('what is a cat', context)

    expect(search).toHaveBeenCalledWith({
      query: 'what is a cat',
      maxResults: 6,
      safeSearch: 'moderate',
      timeRange: 'all',
      locale: 'en-gb',
      region: 'uk-en',
    })
    expect(result).toMatchObject({
      providerId: 'duckduckgo',
      transport: 'electron-browser',
      relatedQueries: ['domestic cat'],
      results: [
        {
          rank: 1,
          title: 'Cat - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Cat',
          hostname: 'en.wikipedia.org',
          snippet: 'The cat is a small domesticated carnivorous mammal.',
        },
      ],
    })
  })

  it('fails clearly in browser-only mode when Electron did not register a search window', async () => {
    releases.push(configureDuckDuckGoBrowserProvider({ search: null, mode: 'browser' }))
    expect(getDuckDuckGoBrowserProviderState()).toEqual({
      available: false,
      mode: 'browser',
    })

    await expect(searchWithDuckDuckGoProvider('what is a cat', context)).rejects.toMatchObject({
      code: 'DDG_BROWSER_UNAVAILABLE',
      statusCode: 503,
    })
  })
})
