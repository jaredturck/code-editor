import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { BrowserEditorDocument } from '../types/editor'

interface BrowserPanelProps {
  document: BrowserEditorDocument
  visible: boolean
}

function BrowserPanel({ document, visible }: BrowserPanelProps) {
  const browser_host_ref = useRef<HTMLDivElement>(null)
  const [address, set_address] = useState(document.url)

  useEffect(() => {
    set_address(document.url)
  }, [document.url])

  useEffect(() => {
    void window.editor_api.browser.create(document.id, document.url)

    return () => {
      window.editor_api.browser.set_visible(document.id, false)
    }
  }, [document.id])

  useEffect(() => {
    window.editor_api.browser.set_visible(document.id, visible)
  }, [document.id, visible])

  useEffect(() => {
    const browser_host = browser_host_ref.current

    if (!browser_host) {
      return
    }

    const update_browser_bounds = () => {
      const bounds = browser_host.getBoundingClientRect()

      window.editor_api.browser.set_bounds(document.id, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
    }

    const resize_observer = new ResizeObserver(update_browser_bounds)

    resize_observer.observe(browser_host)
    window.addEventListener('resize', update_browser_bounds)
    update_browser_bounds()

    return () => {
      resize_observer.disconnect()
      window.removeEventListener('resize', update_browser_bounds)
    }
  }, [document.id])

  const navigate = (event: FormEvent) => {
    event.preventDefault()
    window.editor_api.browser.navigate(document.id, address)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--editor-bg)]">
      <form
        className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-2)] px-2"
        onSubmit={navigate}
      >
        <button
          aria-label="Go back"
          className="flex h-7 w-7 items-center justify-center rounded text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-30"
          disabled={!document.can_go_back}
          onClick={() => window.editor_api.browser.go_back(document.id)}
          title="Back"
          type="button"
        >
          ←
        </button>
        <button
          aria-label="Go forward"
          className="flex h-7 w-7 items-center justify-center rounded text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-30"
          disabled={!document.can_go_forward}
          onClick={() => window.editor_api.browser.go_forward(document.id)}
          title="Forward"
          type="button"
        >
          →
        </button>
        <button
          aria-label="Reload page"
          className="flex h-7 w-7 items-center justify-center rounded text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={() => window.editor_api.browser.reload(document.id)}
          title="Reload"
          type="button"
        >
          ↻
        </button>

        <input
          aria-label="Browser address"
          className="h-7 min-w-0 flex-1 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-xs text-[var(--text)] outline-none focus:border-sky-500"
          onChange={(event) => set_address(event.target.value)}
          spellCheck={false}
          value={address}
        />

        {document.loading && <span className="px-2 text-[11px] text-[var(--muted)]">Loading…</span>}
      </form>

      <div className="relative min-h-0 flex-1 bg-white" ref={browser_host_ref} />
    </div>
  )
}

export default BrowserPanel
