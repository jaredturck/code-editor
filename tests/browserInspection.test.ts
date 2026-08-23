import { describe, expect, it, vi } from 'vitest'

const runtime_error_state = vi.hoisted(() => ({ enabled: true }))

vi.mock('electron', () => {
  class FakeWebContents {
    id = 41
    private current_url = ''
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    on(event: string, listener: (...args: unknown[]) => void) {
      const event_listeners = this.listeners.get(event) ?? []
      event_listeners.push(listener)
      this.listeners.set(event, event_listeners)
      return this
    }

    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args)
      }
    }

    setWindowOpenHandler() {}

    async loadURL(url: string) {
      this.current_url = url
      if (runtime_error_state.enabled) {
        this.emit(
          'console-message',
          {},
          3,
          'Uncaught TypeError: ReactDOM.render is not a function',
          7,
          'http://localhost:3000/static/js/main.js',
        )
      }
    }

    async executeJavaScript() {
      return {
        readyState: 'complete',
        title: 'React App',
        bodyText: '',
        bodyChildCount: 2,
        bodyHtmlLength: 120,
        visibleElementCount: 0,
        root: { id: 'root', text: '', childCount: 0, htmlLength: 0 },
      }
    }

    getURL() {
      return this.current_url
    }

    getTitle() {
      return 'React App'
    }

    isDestroyed() {
      return false
    }

    close() {}
  }

  class FakeWebContentsView {
    webContents = new FakeWebContents()
  }

  return {
    WebContentsView: FakeWebContentsView,
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: {
          onBeforeRequest: vi.fn(),
          onErrorOccurred: vi.fn(),
        },
      }),
    },
  }
})

import { inspect_local_browser_runtime, is_loopback_browser_url } from '../electron/browserInspection.cts'

describe('browser runtime inspection', () => {
  it('accepts local loopback URLs but rejects external browsing', () => {
    expect(is_loopback_browser_url('http://localhost:3000')).toBe(true)
    expect(is_loopback_browser_url('http://127.0.0.1:5173/app')).toBe(true)
    expect(is_loopback_browser_url('http://[::1]:8080')).toBe(true)
    expect(is_loopback_browser_url('https://example.com')).toBe(false)
  })

  it('surfaces client runtime errors and a blank rendered root', async () => {
    runtime_error_state.enabled = true
    const result = await inspect_local_browser_runtime('http://localhost:3000', { settle_ms: 100 })

    expect(result.ok).toBe(false)
    expect(result.blankPage).toBe(true)
    expect(result.consoleErrors).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ReactDOM.render is not a function') }),
    ])
    expect(result.dom).toEqual(expect.objectContaining({ readyState: 'complete' }))
  })

  it('treats an unexpectedly blank rendered page as failed verification without a console error', async () => {
    runtime_error_state.enabled = false
    const result = await inspect_local_browser_runtime('http://localhost:3000', { settle_ms: 100 })
    runtime_error_state.enabled = true

    expect(result.ok).toBe(false)
    expect(result.blankPage).toBe(true)
    expect(result.consoleErrors).toHaveLength(0)
  })
})
