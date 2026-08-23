import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type useAIChat from '../hooks/useAIChat'
import { project_run_progress } from '../chat/projectRunController'
import type { ProjectRunState } from '../chat/projectRunController'
import type { ApprovalRequest } from '../platform-features/chat-ui/types'
import MarkdownView from './MarkdownView'
import AgentChatVoiceControls from './AgentChatVoiceControls'
import AgentRuntimePanel from './AgentRuntimePanel'

interface AIChatPanelProps {
  chat: ReturnType<typeof useAIChat>
  width: number
  onClose: () => void
  onResize: (event: ReactPointerEvent<HTMLElement>) => void
}

interface ApprovalCardProps {
  request: ApprovalRequest
  onDecision: (request_id: string, decision: string) => void
  onAnswer: (request_id: string, answer: string) => void
}

function format_seconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

interface ProjectRunCardProps {
  state: ProjectRunState
  elapsed_seconds: number
  budget_minutes: number
  generating: boolean
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}

function format_run_status(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function ProjectRunCard({
  state,
  elapsed_seconds,
  budget_minutes,
  generating,
  onPause,
  onResume,
  onCancel,
}: ProjectRunCardProps) {
  const progress = project_run_progress(state.todos)
  const resumable = state.status === 'paused' || state.status === 'interrupted'
  const active = ['starting', 'planning', 'running', 'waiting_for_approval', 'waiting_for_user', 'finalizing'].includes(
    state.status,
  )

  return (
    <div className="border-b border-[var(--border)] bg-black/[0.04] px-3 py-2 text-[9px] text-[var(--muted)]">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--text)]">Project Run</span>
            <span>{format_run_status(state.status)}</span>
            <span>·</span>
            <span>{format_seconds(elapsed_seconds)}</span>
            <span>·</span>
            <span>{budget_minutes}m budget</span>
          </div>
          {state.last_activity && <div className="mt-0.5 truncate">{state.last_activity}</div>}
        </div>

        {active && generating && (
          <button
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onPause}
            type="button"
          >
            Pause
          </button>
        )}
        {resumable && (
          <>
            <button
              className="rounded bg-sky-600 px-2 py-1 font-medium text-white hover:bg-sky-500"
              onClick={onResume}
              type="button"
            >
              Resume
            </button>
            <button
              className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={onCancel}
              type="button"
            >
              Cancel run
            </button>
          </>
        )}
      </div>

      {state.todos.length > 0 && (
        <details className="mt-2 rounded border border-[var(--border)] bg-black/[0.04] px-2 py-1.5">
          <summary className="cursor-pointer select-none font-medium text-[var(--text)]">
            Plan · {progress.done}/{progress.total} done{progress.blocked ? ` · ${progress.blocked} blocked` : ''}
          </summary>
          <div className="mt-2 space-y-1">
            {state.todos.map((todo) => (
              <div className="flex gap-2" key={todo.id}>
                <span aria-hidden="true">
                  {todo.status === 'done'
                    ? '✓'
                    : todo.status === 'in_progress'
                      ? '●'
                      : todo.status === 'blocked'
                        ? '×'
                        : '○'}
                </span>
                <span className={todo.status === 'done' ? 'line-through opacity-60' : ''}>{todo.text}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ApprovalCard({ request, onDecision, onAnswer }: ApprovalCardProps) {
  const [custom_answer, set_custom_answer] = useState('')
  const question = String(request.requestType || '').toLowerCase() === 'question'
  const question_options = Array.isArray(request.questionOptions) ? request.questionOptions : []
  const approval_options = Array.isArray(request.options) ? request.options : []
  const description = question
    ? String(request.question || request.reason || 'The agent needs your input.')
    : String(request.requestedAction || request.reason || 'The agent is requesting permission before continuing.')

  return (
    <div className="mb-2 rounded-lg border border-amber-500/35 bg-amber-500/8 p-2 text-[10px] text-[var(--text)]">
      <div className="font-medium text-amber-300">{question ? 'Agent question' : 'Approval required'}</div>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--muted)]">{description}</p>

      {question ? (
        <>
          {question_options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {question_options.map((option) => (
                <button
                  className="rounded border border-[var(--border)] bg-[var(--surface-3)] px-2 py-1 hover:border-sky-500 hover:text-[var(--text)]"
                  key={option}
                  onClick={() => onAnswer(request.id, option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {request.allowOther !== false && (
            <div className="mt-2 flex gap-1.5">
              <input
                aria-label="Answer agent question"
                className="min-w-0 flex-1 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-[10px] outline-none focus:border-sky-500"
                onChange={(event) => set_custom_answer(event.target.value)}
                placeholder="Type an answer…"
                value={custom_answer}
              />
              <button
                className="rounded bg-sky-600 px-2 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
                disabled={!custom_answer.trim()}
                onClick={() => onAnswer(request.id, custom_answer.trim())}
                type="button"
              >
                Answer
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          {approval_options.map((option) => (
            <button
              className={
                option.recommended
                  ? 'rounded bg-amber-500 px-2 py-1 font-medium text-black hover:bg-amber-400'
                  : 'rounded border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
              }
              key={option.id}
              onClick={() => onDecision(request.id, option.id)}
              title={option.description || undefined}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AIChatPanel({ chat, width, onClose, onResize }: AIChatPanelProps) {
  const message_end_ref = useRef<HTMLDivElement>(null)
  const project_run_needs_resolution =
    chat.project_run?.status === 'paused' || chat.project_run?.status === 'interrupted'

  useEffect(() => {
    message_end_ref.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    })
  }, [chat.messages])

  const status_label = chat.restoring_chat
    ? 'Restoring secure chat'
    : chat.agent_descriptor.ready
      ? chat.generating
        ? chat.run_status || 'Agent working'
        : 'Agent ready'
      : 'Agent setup required'

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
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-[var(--text)]">AI Chat</h2>
          <div className="flex min-w-0 items-center gap-1 text-[9px] text-[var(--muted)]">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                chat.connection_status === 'connected'
                  ? chat.generating
                    ? 'bg-sky-400'
                    : 'bg-emerald-400'
                  : chat.connection_status === 'checking'
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`}
            />
            <span className="truncate">{status_label}</span>
          </div>
        </div>

        <button
          className="ml-auto rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={chat.generating || chat.restoring_chat}
          onClick={() => void chat.clear_chat()}
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
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--muted)]">Orchestrator</div>
          <div
            className={`truncate text-[10px] ${chat.agent_descriptor.ready ? 'text-[var(--text)]' : 'text-amber-300'}`}
            title={chat.agent_descriptor.message}
          >
            {chat.agent_descriptor.ready
              ? `${chat.agent_descriptor.provider_label} · ${chat.agent_descriptor.model}`
              : chat.agent_descriptor.message}
          </div>
        </div>
        <span className="shrink-0 text-[9px] text-[var(--muted)]">Settings → AI</span>
      </div>

      {chat.project_run && (
        <ProjectRunCard
          budget_minutes={chat.project_run_budget_minutes}
          elapsed_seconds={chat.project_run_elapsed_seconds}
          generating={chat.generating}
          onCancel={chat.cancel_project_run}
          onPause={chat.pause_project_run}
          onResume={() => void chat.resume_project_run()}
          state={chat.project_run}
        />
      )}

      <AgentRuntimePanel generating={chat.generating} />

      <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
        {chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-xs text-[var(--muted)]">
            <div className="mb-2 text-2xl opacity-50">✦</div>
            <p>Ask your configured agent about the current project.</p>
            <p className="mt-1 text-[10px]">
              The agent can edit the workspace, run tools and tests, coordinate peers, inspect runtime health, and
              verify visible application state.
            </p>
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

                {message.role === 'assistant' && message.activity && message.activity.length > 0 && (
                  <details className="mb-2 rounded border border-[var(--border)] bg-black/[0.05] px-2 py-1.5">
                    <summary className="cursor-pointer select-none text-[9px] font-medium text-[var(--muted)]">
                      Agent activity · {message.activity.length} action{message.activity.length === 1 ? '' : 's'}
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {message.activity.map((activity) => (
                        <div className="border-l border-[var(--border)] pl-2" key={activity.id}>
                          <div className="text-[9px] font-medium text-[var(--text)]">{activity.label}</div>
                          {activity.detail && (
                            <div className="mt-0.5 whitespace-pre-wrap break-words text-[9px] leading-relaxed text-[var(--muted)]">
                              {activity.detail}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {message.role === 'assistant' ? (
                  message.content ? (
                    <MarkdownView baseFilePath={null} content={message.content} />
                  ) : (
                    <span className="text-[var(--muted)]">{chat.run_status || 'Agent working…'}</span>
                  )
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
                {message.streaming && <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-sky-400" />}
                {message.role === 'assistant' && (message.provider || message.model) && !message.streaming && (
                  <div className="mt-2 border-t border-[var(--border)] pt-1.5 text-[8px] text-[var(--muted)]">
                    {[message.provider, message.model].filter(Boolean).join(' · ')}
                  </div>
                )}
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

        {chat.approval_requests.map((request) => (
          <ApprovalCard
            key={request.id}
            onAnswer={chat.answer_question}
            onDecision={(request_id, decision) => void chat.resolve_approval(request_id, decision)}
            request={request}
          />
        ))}

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
          <div className="mb-2 flex items-center justify-between gap-2 text-[9px] text-[var(--muted)]">
            <span>Run mode</span>
            <select
              aria-label="Agent run mode"
              className="rounded border border-[var(--input-border)] bg-[var(--surface-3)] px-2 py-1 text-[9px] text-[var(--text)] outline-none focus:border-sky-500"
              disabled={chat.generating || chat.restoring_chat || project_run_needs_resolution}
              onChange={(event) => chat.set_run_mode(event.target.value === 'plan_first' ? 'plan_first' : 'automatic')}
              value={chat.run_mode}
            >
              <option value="automatic">Automatic</option>
              <option value="plan_first">Plan first</option>
            </select>
          </div>
          <textarea
            aria-label="AI chat prompt"
            className="h-20 w-full resize-none border-0 bg-transparent p-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            disabled={chat.generating || chat.restoring_chat || project_run_needs_resolution}
            onChange={(event) => chat.set_prompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void chat.submit_prompt()
              }
            }}
            placeholder="Ask the agent about your project…"
            value={chat.prompt}
          />

          <div className="mt-1 flex items-center gap-1">
            <button
              className="rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              disabled={chat.generating || project_run_needs_resolution}
              onClick={chat.attach_active_file}
              title="Attach active file"
              type="button"
            >
              Active file
            </button>
            <button
              className="rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              disabled={chat.generating || project_run_needs_resolution}
              onClick={() => void chat.choose_attachment()}
              title="Choose attachment"
              type="button"
            >
              Attach…
            </button>
            <AgentChatVoiceControls
              disabled={chat.generating || project_run_needs_resolution}
              setPrompt={chat.set_prompt}
            />

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
                disabled={
                  chat.restoring_chat ||
                  project_run_needs_resolution ||
                  !chat.agent_descriptor.ready ||
                  (!chat.prompt.trim() && chat.attachments.length === 0)
                }
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
