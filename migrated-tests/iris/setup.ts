/**
 * Provides shared setup or helpers for the setup test surface. It keeps test-only behavior
 * separate from production modules.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

function installCredentialBridge(): void {
  const values = new Map<string, string>()
  window.orbitDesktop = {
    // Most renderer tests exercise non-window-specific behavior. Credential APIs are
    // available without pretending the test is an Electron-controlled window.
    isDesktopShell: false,
    credentials: {
      status: () => ({
        ok: true,
        available: true,
        persistent: true,
        backend: 'test-safe-storage',
        reason: '',
      }),
      list: () => ({
        ok: true,
        providers: Array.from(values.keys()).sort(),
      }),
      get: (provider: string) => ({
        ok: true,
        value: values.get(String(provider || '').toLowerCase()) || '',
      }),
      set: (provider: string, value: string) => {
        values.set(String(provider || '').toLowerCase(), String(value || ''))
        return { ok: true, saved: true }
      },
      delete: (provider: string) => {
        values.delete(String(provider || '').toLowerCase())
        return { ok: true, deleted: true }
      },
    },
  }
}

// Marks side effect blocked and records the reason for the active run.
function blockedSideEffect(name: string, detail = ''): never {
  const suffix = detail ? `: ${detail}` : ''
  throw new Error(`Unexpected ${name} during test${suffix}`)
}

class BlockedXMLHttpRequest {
  open(method: string, url: string | URL): void {
    blockedSideEffect('XMLHttpRequest', `${method} ${url}`)
  }
}

class BlockedWebSocket {
  constructor(url: string | URL) {
    blockedSideEffect('WebSocket connection', String(url))
  }
}

class BlockedEventSource {
  constructor(url: string | URL) {
    blockedSideEffect('EventSource connection', String(url))
  }
}

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

type StorageWithMarker = Storage & { __irisPolyfilled?: boolean }

// jsdom only attaches Web Storage to its `window` on some Node versions; under
// Node ≥ 24 (this machine runs v26) vitest's jsdom environment leaves
// window.localStorage undefined, while the contributor's Node 22 had it natively.
// Install a minimal in-memory Storage only when it is missing — a no-op where
// jsdom already provides it — so the suite runs identically across Node versions.
// The instance is created from Storage.prototype with WeakMap-backed data so that
// tests spying on Storage.prototype.setItem (etc.) intercept the real calls.
function installStoragePrototype(): StorageWithMarker {
  const proto = (typeof Storage !== 'undefined' ? Storage.prototype : {}) as StorageWithMarker
  if (proto.__irisPolyfilled) return proto
  const backing = new WeakMap<object, Map<string, string>>()
  // Stores store for later use by the surrounding test scenario.
  const store = (instance: object): Map<string, string> => {
    if (!backing.has(instance)) backing.set(instance, new Map())
    return backing.get(instance)!
  }
  // Provides the define helper used by the surrounding test scenario.
  const define = (key: PropertyKey, descriptor: PropertyDescriptor): void => {
    try {
      Object.defineProperty(proto, key, { configurable: true, ...descriptor })
    } catch {
      /* non-configurable; skip */
    }
  }
  define('length', {
    get(this: Storage) {
      return store(this).size
    },
  })
  define('key', {
    writable: true,
    value(this: Storage, index: number) {
      return Array.from(store(this).keys())[index] ?? null
    },
  })
  define('getItem', {
    writable: true,
    // Returns the current mocked media-query match value.
    value(this: Storage, key: string) {
      const values = store(this)
      return values.has(String(key)) ? values.get(String(key))! : null
    },
  })
  define('setItem', {
    writable: true,
    value(this: Storage, key: string, value: string) {
      store(this).set(String(key), String(value))
    },
  })
  define('removeItem', {
    writable: true,
    value(this: Storage, key: string) {
      store(this).delete(String(key))
    },
  })
  define('clear', {
    writable: true,
    value(this: Storage) {
      store(this).clear()
    },
  })
  define('__irisPolyfilled', { value: true })
  return proto
}

// Ensures storage exists in the valid state required by the surrounding test scenario.
function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  let existing: Storage | undefined
  try {
    existing = window[name]
  } catch {
    existing = undefined
  }
  if (existing) return
  const proto = installStoragePrototype()
  const instance = Object.create(proto) as Storage
  try {
    Object.defineProperty(window, name, {
      value: instance,
      configurable: true,
    })
  } catch {
    try {
      ;(window as unknown as Record<string, Storage>)[name] = instance
    } catch {
      /* ignore */
    }
  }
  try {
    Object.defineProperty(globalThis, name, {
      value: instance,
      configurable: true,
    })
  } catch {
    /* ignore */
  }
}
ensureStorage('localStorage')
ensureStorage('sessionStorage')

beforeEach(async () => {
  const { initializeStorageForTests } = await import('@/platform/localStorageStore')
  initializeStorageForTests()
  installCredentialBridge()
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (window as Window & { __irisEphemeralCredentialStore?: Map<string, string> }).__irisEphemeralCredentialStore

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      blockedSideEffect('network request', String(input))
    }),
  )
  vi.stubGlobal('XMLHttpRequest', BlockedXMLHttpRequest)
  vi.stubGlobal('WebSocket', BlockedWebSocket)
  vi.stubGlobal('EventSource', BlockedEventSource)
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)

  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
