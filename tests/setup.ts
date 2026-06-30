import '@testing-library/jest-dom/vitest'

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
    value: {
      platform: 'linux',
      file: {
        resolve_relative: async () => null,
        open_external: () => undefined,
      },
    },
  })
}

if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}
