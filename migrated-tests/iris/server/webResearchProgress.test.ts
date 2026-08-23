/** Protects the bridge's snippet-only fast path and real DuckDuckGo progress forwarding. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDuckDuckGoBrowserProvider } from '../../server/desktopBridge/services/duckDuckGoBrowserProvider'
import { runWebResearch } from '../../server/desktopBridge/services/bridgeServiceRuntime'

let cleanup: () => void = () => undefined

afterEach(() => {
  cleanup()
  cleanup = () => undefined
  vi.restoreAllMocks()
})

describe('bridge web research progress', () => {
  it('builds the quick answer evidence from snippets without fetching result pages', async () => {
    const browserProgress: string[] = []
    cleanup = configureDuckDuckGoBrowserProvider({
      mode: 'browser',
      search: async ({ onProgress }) => {
        onProgress?.({
          type: 'browser.navigation_started',
          message: 'Loading DuckDuckGo…',
        })
        onProgress?.({
          type: 'results.parse_completed',
          message: 'Parsed results…',
        })
        browserProgress.push('called')
        return {
          results: [
            {
              title: 'Cats',
              url: 'https://example.test/cats',
              snippet: 'Cats are domesticated mammals.',
            },
          ],
        }
      },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const events: string[] = []

    const result = await runWebResearch(`snippet-only-${Date.now()}`, {
      includeContent: false,
      maxResults: 5,
      maxSources: 3,
      providerPolicy: { primaryProvider: 'duckduckgo', fallbackProviders: [] },
      onProgress: (event: Record<string, unknown>) => events.push(String(event.type || '')),
    })

    expect(browserProgress).toEqual(['called'])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.sources[0]).toMatchObject({
      status: 'snippet',
      excerpt: 'Cats are domesticated mammals.',
      linesRead: 0,
      charsRead: 0,
    })
    expect(events).toContain('browser.navigation_started')
    expect(events).toContain('results.parse_completed')
    expect(events).toContain('results.snippets_preparing')
    expect(events).not.toContain('pages.started')
  })
})
