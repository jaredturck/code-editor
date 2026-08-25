import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixMock {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
  }

  Object.defineProperty(globalThis, 'DOMMatrix', {
    configurable: true,
    value: DOMMatrixMock,
  })
}

if (typeof window !== 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, 'ResizeObserver', {
    value: ResizeObserverMock,
  })
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })

  Object.defineProperty(window, 'editor_api', {
    configurable: true,
    writable: true,
    value: {
      platform: 'linux',
      file: {
        resolve_relative: async () => null,
        open_external: () => undefined,
      },
    },
  })
}

if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined
}

if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}
