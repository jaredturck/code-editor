import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type useAIChat from '../hooks/useAIChat'
import MarkdownView from './MarkdownView'

interface AIChatPanelProps {
  chat: ReturnType<typeof useAIChat>
  width: number
  onClose: () => void
  onResize: (event: ReactPointerEvent<HTMLElement>) => void
}

function format_seconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function AIChatPanel({ chat, width, onClose, onResize }: AIChatPanelProps) {
  const message_end_ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    message_end_ref.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    })
  }, [chat.messages])

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

      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <div>
          <h2 className="text-xs font-medium text-[var(--text)]">AI Chat</h2>
          <div className="flex items-center gap-1 text-[9px] text-[var(--muted)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                chat.connection_status === 'connected'
                  ? 'bg-emerald-400'
                  : chat.connection_status === 'checking'
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`}
            />
            {chat.connection_status === 'connected'
              ? 'Ollama connected'
              : chat.connection_status === 'checking'
                ? 'Checking Ollama'
                : 'Ollama offline'}
          </div>
        </div>

        <button
          className="ml-auto rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={chat.clear_chat}
          title="Clear chat"
          type="button"
        >
          Clear
        </button>
        <button
          aria-label="Close AI chat"
          className="flex h-7 w-7 items-center justify-center rounded text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={onClose}
          title="Close AI chat"
          type="button"
        >
          ×
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <select
          aria-label="Ollama model"
          className="min-w-0 flex-1 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[10px] text-[var(--text)] outline-none focus:border-sky-500"
          disabled={chat.loading_models || chat.models.length === 0}
          onChange={(event) => chat.set_selected_model(event.target.value)}
          value={chat.selected_model}
        >
          {chat.models.length === 0 ? (
            <option value="">No installed models</option>
          ) : (
            chat.models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))
          )}
        </select>
        <button
          aria-label="Refresh Ollama models"
          className="h-7 w-7 rounded text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          disabled={chat.loading_models}
          onClick={() => void chat.refresh_models()}
          title="Refresh models"
          type="button"
        >
          ↻
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
        {chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-xs text-[var(--muted)]">
            <div className="mb-2 text-2xl opacity-50">✦</div>
            <p>Ask a local Ollama model about your code.</p>
            <p className="mt-1 text-[10px]">Attach the active file to include unsaved changes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {chat.messages.map((message) => (
              <article
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[90%] rounded-xl bg-sky-500/12 px-3 py-2 text-xs text-[var(--text)]'
                    : `mr-auto max-w-full rounded-xl border px-3 py-2 text-xs ${
                        message.error ? 'border-red-500/40 bg-red-500/8' : 'border-[var(--border)] bg-black/[0.05]'
                      }`
                }
                key={message.id}
              >
                {message.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {message.attachments.map((attachment) => (
                      <span
                        className="rounded bg-black/15 px-1.5 py-0.5 text-[9px] text-[var(--muted)]"
                        key={attachment.id}
                      >
                        {attachment.name}
                      </span>
                    ))}
                  </div>
                )}
                {message.role === 'assistant' ? (
                  message.content ? (
                    <MarkdownView baseFilePath={null} content={message.content} />
                  ) : (
                    <span className="text-[var(--muted)]">Thinking…</span>
                  )
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
                {message.streaming && <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-sky-400" />}
              </article>
            ))}
            <div ref={message_end_ref} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        {chat.error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/8 px-2 py-1.5 text-[10px] text-red-300">
            <span className="min-w-0 flex-1">{chat.error}</span>
            <button onClick={() => chat.set_error('')} type="button">
              ×
            </button>
          </div>
        )}

        {chat.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chat.attachments.map((attachment) => (
              <span
                className="flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-2 py-1 text-[9px] text-[var(--text)]"
                key={attachment.id}
              >
                {attachment.preview && <img alt="" className="h-5 w-5 rounded object-cover" src={attachment.preview} />}
                <span className="truncate">{attachment.name}</span>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  className="text-[var(--muted)] hover:text-[var(--text)]"
                  onClick={() => chat.remove_attachment(attachment.id)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {chat.speech_model_prompt && (
          <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-2 text-[10px] text-[var(--text)]">
            <p>The configured Granite speech model is not installed. Install it through Ollama?</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]"
                onClick={() => chat.set_speech_model_prompt(false)}
                type="button"
              >
                Not now
              </button>
              <button
                className="rounded bg-amber-500 px-2 py-1 font-medium text-black hover:bg-amber-400"
                onClick={() => void chat.install_speech_model()}
                type="button"
              >
                Install model
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-2 focus-within:border-sky-500">
          <textarea
            aria-label="AI chat prompt"
            className="h-20 w-full resize-none border-0 bg-transparent p-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            disabled={chat.generating}
            onChange={(event) => chat.set_prompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void chat.submit_prompt()
              }
            }}
            placeholder="Ask about your code…"
            value={chat.prompt}
          />

          <div className="mt-1 flex items-center gap-1">
            <button
              className="rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={chat.attach_active_file}
              title="Attach active file"
              type="button"
            >
              Active file
            </button>
            <button
              className="rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={() => void chat.choose_attachment()}
              title="Choose attachment"
              type="button"
            >
              Attach…
            </button>
            <button
              aria-label={chat.recording ? 'Stop recording' : 'Record voice prompt'}
              className={`rounded px-2 py-1 text-[10px] ${
                chat.recording ? 'bg-red-500/15 text-red-300' : 'text-[var(--muted)] hover:bg-[var(--hover)]'
              }`}
              disabled={chat.transcribing}
              onClick={() => (chat.recording ? chat.stop_recording() : void chat.begin_recording())}
              type="button"
            >
              {chat.recording
                ? `Stop ${format_seconds(chat.recording_seconds)}`
                : chat.transcribing
                  ? 'Transcribing…'
                  : 'Mic'}
            </button>

            {chat.generating ? (
              <button
                className="ml-auto rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-400"
                onClick={chat.stop_generation}
                type="button"
              >
                Stop
              </button>
            ) : (
              <button
                className="ml-auto rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!chat.prompt.trim() && chat.attachments.length === 0}
                onClick={() => void chat.submit_prompt()}
                type="button"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

export default AIChatPanel
