/**
 * Provides DuckDuckGo discovery through Electron's real Chromium renderer. One hidden,
 * sandboxed BrowserWindow is created lazily, reused between searches, and destroyed during
 * application shutdown. The page itself is never exposed to the renderer; only bounded result
 * card data crosses into the local bridge.
 */

import { BrowserWindow, type Session } from 'electron'
import {
  buildDuckDuckGoSearchUrl,
  extractDuckDuckGoPage,
  type DuckDuckGoBrowserProgressEvent,
  type DuckDuckGoBrowserSearchRequest,
  type DuckDuckGoBrowserSearchResult,
  type ExtractedDuckDuckGoPage,
} from './duckDuckGoPageParser.cjs'

export {
  buildDuckDuckGoSearchUrl,
  resolveDuckDuckGoSearchMode,
  type DuckDuckGoBrowserProgressEvent,
  type DuckDuckGoBrowserSearchRequest,
  type DuckDuckGoBrowserSearchResult,
  type DuckDuckGoSearchMode,
} from './duckDuckGoPageParser.cjs'

export interface DuckDuckGoBrowserSearchResponse {
  results: DuckDuckGoBrowserSearchResult[]
  relatedQueries: string[]
  pageUrl: string
  elapsedMs: number
  cacheHit: boolean
}

export interface DuckDuckGoSearchWindowService {
  search: (request: DuckDuckGoBrowserSearchRequest) => Promise<DuckDuckGoBrowserSearchResponse>
  close: () => void
}

interface CachedSearch {
  createdAt: number
  response: DuckDuckGoBrowserSearchResponse
}

const SEARCH_WINDOW_PARTITION = 'orbit-duckduckgo-search'
const SEARCH_NAVIGATION_TIMEOUT_MS = 20_000
const SEARCH_RESULTS_TIMEOUT_MS = 14_000
const SEARCH_CACHE_TTL_MS = 90_000
const SEARCH_CACHE_MAX_ENTRIES = 12
const configuredSessions = new WeakSet<Session>()

function timeoutAfter<T>(milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref?.()
  })
}

function abortError(): Error {
  const error = new Error('Search cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

async function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  if (!signal) return operation
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      onAbort?.()
      reject(abortError())
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort)
        reject(error)
      },
    )
  })
}

function cloneResponse(response: DuckDuckGoBrowserSearchResponse): DuckDuckGoBrowserSearchResponse {
  return {
    ...response,
    results: response.results.map((result) => ({ ...result })),
    relatedQueries: [...response.relatedQueries],
  }
}

/** Creates the retained hidden-window search service owned by Electron main. */
export function createDuckDuckGoSearchWindow(): DuckDuckGoSearchWindowService {
  let searchWindow: BrowserWindow | null = null
  let closing = false
  let queue: Promise<void> = Promise.resolve()
  const cache = new Map<string, CachedSearch>()

  const emit = (request: DuckDuckGoBrowserSearchRequest, event: DuckDuckGoBrowserProgressEvent): void => {
    request.onProgress?.(event)
  }

  const pruneCache = (): void => {
    const now = Date.now()
    for (const [key, entry] of cache.entries()) {
      if (now - entry.createdAt > SEARCH_CACHE_TTL_MS) cache.delete(key)
    }
    while (cache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined
      if (!oldest) break
      cache.delete(oldest)
    }
  }

  const destroyWindow = (): void => {
    const current = searchWindow
    searchWindow = null
    if (!current || current.isDestroyed()) return
    current.destroy()
  }

  const ensureWindow = (request: DuckDuckGoBrowserSearchRequest): BrowserWindow => {
    if (closing) throw new Error('DuckDuckGo browser search is shutting down.')
    if (searchWindow && !searchWindow.isDestroyed()) {
      emit(request, {
        type: 'browser.reusing',
        message: 'Reusing the private search browser…',
      })
      return searchWindow
    }

    emit(request, {
      type: 'browser.creating',
      message: 'Opening a private search browser…',
    })
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: SEARCH_WINDOW_PARTITION,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    })

    win.setMenuBarVisibility(false)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, targetUrl) => {
      try {
        const target = new URL(targetUrl)
        if (
          target.protocol === 'https:' &&
          (target.hostname === 'duckduckgo.com' || target.hostname.endsWith('.duckduckgo.com'))
        )
          return
      } catch {
        // Invalid remote navigation is blocked below.
      }
      event.preventDefault()
    })
    win.webContents.on('render-process-gone', () => {
      if (searchWindow === win) searchWindow = null
    })
    win.on('closed', () => {
      if (searchWindow === win) searchWindow = null
    })

    const browserSession = win.webContents.session
    if (!configuredSessions.has(browserSession)) {
      configuredSessions.add(browserSession)
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      browserSession.on('will-download', (event) => event.preventDefault())
    }

    searchWindow = win
    emit(request, {
      type: 'browser.ready',
      message: 'Private search browser ready…',
    })
    return win
  }

  const performSearch = async (request: DuckDuckGoBrowserSearchRequest): Promise<DuckDuckGoBrowserSearchResponse> => {
    throwIfAborted(request.signal)
    const targetUrl = buildDuckDuckGoSearchUrl(request)
    emit(request, {
      type: 'browser.cache_check',
      message: 'Checking for recent DuckDuckGo results…',
    })
    pruneCache()
    const cached = cache.get(targetUrl)
    if (cached && Date.now() - cached.createdAt <= SEARCH_CACHE_TTL_MS) {
      emit(request, {
        type: 'browser.cache_hit',
        message: 'Using recent DuckDuckGo results…',
      })
      return { ...cloneResponse(cached.response), cacheHit: true }
    }

    const startedAt = Date.now()
    const win = ensureWindow(request)
    const cancelBrowser = (): void => {
      if (!win.isDestroyed()) win.webContents.stop()
      destroyWindow()
    }

    try {
      emit(request, {
        type: 'browser.navigation_started',
        message: 'Loading DuckDuckGo…',
      })
      await raceWithAbort(
        Promise.race([
          win.loadURL(targetUrl),
          timeoutAfter<void>(SEARCH_NAVIGATION_TIMEOUT_MS, 'DuckDuckGo browser navigation timed out.'),
        ]),
        request.signal,
        cancelBrowser,
      )

      emit(request, {
        type: 'browser.dom_ready',
        message: 'DuckDuckGo page loaded…',
      })
      emit(request, {
        type: 'results.waiting',
        message: 'Waiting for DuckDuckGo result cards…',
      })

      const script = `(${extractDuckDuckGoPage.toString()})(${Math.max(
        1,
        Math.min(20, Math.round(Number(request.maxResults) || 8)),
      )}, ${SEARCH_RESULTS_TIMEOUT_MS})`
      const extracted = (await raceWithAbort(
        Promise.race([
          win.webContents.executeJavaScript(script, true),
          timeoutAfter<ExtractedDuckDuckGoPage>(
            SEARCH_RESULTS_TIMEOUT_MS + 2_000,
            'DuckDuckGo results did not render before the timeout.',
          ),
        ]),
        request.signal,
        cancelBrowser,
      )) as ExtractedDuckDuckGoPage

      if (extracted.challenge) {
        emit(request, {
          type: 'browser.challenge',
          message: 'DuckDuckGo requested browser verification…',
        })
        const error = new Error(
          'DuckDuckGo displayed a browser verification challenge instead of search results.',
        ) as Error & { code?: string; statusCode?: number }
        error.code = 'DDG_BROWSER_CHALLENGE'
        error.statusCode = 503
        throw error
      }

      const results = Array.isArray(extracted.results) ? extracted.results : []
      if (!results.length) {
        const detail = String(extracted.bodyText || '').slice(0, 220)
        const error = new Error(
          detail
            ? `DuckDuckGo rendered no organic results. Page text: ${detail}`
            : 'DuckDuckGo rendered no organic results.',
        ) as Error & { code?: string; statusCode?: number }
        error.code = 'DDG_BROWSER_NO_RESULTS'
        error.statusCode = 502
        throw error
      }

      emit(request, {
        type: 'results.parsed',
        message: `Parsed ${results.length} organic DuckDuckGo result${results.length === 1 ? '' : 's'}…`,
        current: results.length,
        total: results.length,
      })
      const response: DuckDuckGoBrowserSearchResponse = {
        results,
        relatedQueries: Array.isArray(extracted.relatedQueries) ? extracted.relatedQueries.slice(0, 8) : [],
        pageUrl: String(extracted.pageUrl || targetUrl),
        elapsedMs: Math.max(0, Date.now() - startedAt),
        cacheHit: false,
      }
      cache.set(targetUrl, {
        createdAt: Date.now(),
        response: cloneResponse(response),
      })
      pruneCache()
      return response
    } catch (error) {
      if (win.isDestroyed()) searchWindow = null
      throw error
    }
  }

  return {
    search: (request) => {
      const job = queue.then(() => performSearch(request))
      queue = job.then(
        () => undefined,
        () => undefined,
      )
      return job
    },
    close: () => {
      closing = true
      cache.clear()
      destroyWindow()
    },
  }
}
