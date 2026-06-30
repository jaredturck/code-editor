import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface AIChatPanelProps {
  width: number
  onClose: () => void
  onResize: (event: ReactPointerEvent<HTMLElement>) => void
}

function AIChatPanel({ width, onClose, onResize }: AIChatPanelProps) {
  const [prompt, set_prompt] = useState('')
  const [messages, set_messages] = useState<string[]>([])

  const submit_prompt = () => {
    const next_prompt = prompt.trim()

    if (!next_prompt) {
      return
    }

    set_messages((current_messages) => [...current_messages, next_prompt])
    set_prompt('')
  }

  return (
    <aside
      aria-label="AI chat panel"
      className="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-2)]"
      style={{ width }}
    >
      <div
        aria-label="Resize AI chat panel"
        aria-orientation="vertical"
        className="absolute inset-y-0 left-0 z-10 w-1 -translate-x-1/2 cursor-col-resize hover:bg-sky-500/70"
        onPointerDown={onResize}
        role="separator"
      />

      <div className="flex h-10 shrink-0 items-center border-b border-[var(--border)] px-3">
        <h2 className="text-xs font-medium text-[var(--text)]">AI Chat</h2>

        <button
          aria-label="Close AI chat"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={onClose}
          title="Close AI chat"
          type="button"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-[var(--muted)]">
            Ask questions about your code.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div
                className="ml-auto max-w-[88%] rounded-lg bg-[var(--selected)] px-3 py-2 text-xs text-[var(--text)]"
                key={`${message}-${index}`}
              >
                {message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-2 focus-within:border-sky-500">
          <textarea
            aria-label="AI chat prompt"
            className="h-20 w-full resize-none border-0 bg-transparent p-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            onChange={(event) => set_prompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit_prompt()
              }
            }}
            placeholder="Ask about your code..."
            value={prompt}
          />

          <div className="mt-1 flex justify-end">
            <button
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!prompt.trim()}
              onClick={submit_prompt}
              type="button"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default AIChatPanel
