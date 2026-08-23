import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitCommitSummary, GitDiffResult, GitRepositoryStatus } from '../types/git'

interface SourceControlPanelProps {
  rootPath: string | null
  onOpenFile: (file_path: string) => void
}

function workspace_file_path(root_path: string, relative_path: string) {
  const separator = root_path.includes('\\') && !root_path.includes('/') ? '\\' : '/'
  return `${root_path.replace(/[\\/]$/, '')}${separator}${relative_path.replace(/[\\/]/g, separator)}`
}

function compact_date(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function change_badge(status: string) {
  if (status === 'added' || status === 'untracked') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  if (status === 'conflict') return '!'
  return 'M'
}

function SourceControlPanel({ rootPath, onOpenFile }: SourceControlPanelProps) {
  const [status, set_status] = useState<GitRepositoryStatus | null>(null)
  const [history, set_history] = useState<GitCommitSummary[]>([])
  const [selected_path, set_selected_path] = useState<string | null>(null)
  const [diff, set_diff] = useState<GitDiffResult | null>(null)
  const [commit_message, set_commit_message] = useState('')
  const [error, set_error] = useState('')
  const [busy, set_busy] = useState(false)

  const refresh = useCallback(async () => {
    if (!rootPath) {
      set_status(null)
      set_history([])
      return
    }

    try {
      const [next_status, next_history] = await Promise.all([
        window.editor_api.git.status(rootPath),
        window.editor_api.git.history(rootPath, 20),
      ])
      set_status(next_status)
      set_history(next_history)
      set_error('')
    } catch (refresh_error) {
      set_error(refresh_error instanceof Error ? refresh_error.message : 'Unable to read source control state.')
    }
  }, [rootPath])

  useEffect(() => {
    set_selected_path(null)
    set_diff(null)
    set_commit_message('')
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!rootPath) return
    const remove_change_listener = window.editor_api.workspace.on_change((payload) => {
      if (payload.root_path === rootPath) {
        window.setTimeout(() => void refresh(), 120)
      }
    })
    const interval = window.setInterval(() => void refresh(), 2500)
    return () => {
      remove_change_listener()
      window.clearInterval(interval)
    }
  }, [refresh, rootPath])

  useEffect(() => {
    if (!rootPath || !selected_path) {
      set_diff(null)
      return
    }

    let cancelled = false
    void window.editor_api.git
      .diff(rootPath, selected_path)
      .then((next_diff) => {
        if (!cancelled) set_diff(next_diff)
      })
      .catch((diff_error) => {
        if (!cancelled) set_error(diff_error instanceof Error ? diff_error.message : 'Unable to read Git diff.')
      })
    return () => {
      cancelled = true
    }
  }, [rootPath, selected_path, status?.changes])

  const staged_count = useMemo(() => status?.changes.filter((change) => change.staged).length ?? 0, [status])
  const unstaged_count = useMemo(
    () => status?.changes.filter((change) => change.unstaged || change.untracked).length ?? 0,
    [status],
  )

  const run_action = async (action: () => Promise<unknown>) => {
    if (busy) return
    set_busy(true)
    set_error('')
    try {
      await action()
      await refresh()
    } catch (action_error) {
      set_error(action_error instanceof Error ? action_error.message : 'Source control action failed.')
    } finally {
      set_busy(false)
    }
  }

  const commit = async () => {
    if (!rootPath || !commit_message.trim()) return
    await run_action(async () => {
      await window.editor_api.git.commit(rootPath, commit_message.trim())
      set_commit_message('')
    })
  }

  const select_change = (file_path: string) => {
    if (!rootPath) return
    set_selected_path(file_path)
    onOpenFile(workspace_file_path(rootPath, file_path))
  }

  if (!rootPath) {
    return <div className="px-4 py-3 text-xs leading-5 text-[var(--muted)]">Open a folder to use source control.</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-xs">
      <div className="flex shrink-0 items-center gap-2 border-y border-[var(--border)] bg-[var(--surface-3)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[var(--text)]">{status?.branch || 'Git'}</div>
          <div className="truncate text-[10px] text-[var(--muted)]">
            {status?.clean ? 'Working tree clean' : `${status?.changes.length ?? 0} change(s)`}
          </div>
        </div>
        <button
          className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          disabled={busy}
          onClick={() => void refresh()}
          title="Refresh Source Control"
          type="button"
        >
          ↻
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-[var(--border)] px-3 py-2 text-[11px] leading-4 text-red-400">
          {error}
        </div>
      )}

      {(status?.nested_repositories.length ?? 0) > 0 && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="font-medium text-amber-300">Nested Git metadata detected</div>
          <div className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            This editor keeps one repository at the workspace root. Remove nested metadata before running the agent.
          </div>
          {status?.nested_repositories.map((git_path) => (
            <div className="mt-2 flex items-center gap-2" key={git_path}>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={git_path}>
                {git_path}
              </span>
              <button
                className="rounded border border-amber-500/40 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-500/15"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Remove nested Git metadata at ${git_path}? The project files will be kept.`))
                    return
                  void run_action(() => window.editor_api.git.remove_nested_repository(rootPath, git_path))
                }}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-b border-[var(--border)] p-2">
        <textarea
          aria-label="Commit message"
          className="min-h-16 w-full resize-none rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-sky-500"
          onChange={(event) => set_commit_message(event.target.value)}
          placeholder="Commit message"
          value={commit_message}
        />
        <button
          className="mt-2 w-full rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || staged_count === 0 || !commit_message.trim()}
          onClick={() => void commit()}
          type="button"
        >
          Commit Staged ({staged_count})
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex items-center border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          <span className="flex-1">Changes ({status?.changes.length ?? 0})</span>
          {unstaged_count > 0 && (
            <button
              className="rounded px-1.5 py-0.5 normal-case hover:bg-[var(--hover)] hover:text-[var(--text)]"
              disabled={busy}
              onClick={() => void run_action(() => window.editor_api.git.stage(rootPath, []))}
              title="Stage all changes"
              type="button"
            >
              Stage all
            </button>
          )}
          {staged_count > 0 && (
            <button
              className="ml-1 rounded px-1.5 py-0.5 normal-case hover:bg-[var(--hover)] hover:text-[var(--text)]"
              disabled={busy}
              onClick={() => void run_action(() => window.editor_api.git.unstage(rootPath, []))}
              title="Unstage all changes"
              type="button"
            >
              Unstage
            </button>
          )}
        </div>

        {status?.changes.map((change) => (
          <div
            className={`group flex h-7 items-center gap-1 border-b border-[var(--border)]/40 px-2 ${selected_path === change.path ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'}`}
            key={`${change.path}:${change.old_path || ''}`}
          >
            <button
              className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[var(--text)]"
              onClick={() => select_change(change.path)}
              title={change.old_path ? `${change.old_path} → ${change.path}` : change.path}
              type="button"
            >
              {change.path}
            </button>
            <span className="w-4 text-center text-[10px] font-semibold text-[var(--muted)]">
              {change_badge(change.status)}
            </span>
            {change.staged && <span className="text-[9px] text-emerald-400">S</span>}
            {(change.unstaged || change.untracked) && <span className="text-[9px] text-amber-400">U</span>}
            {(change.unstaged || change.untracked) && (
              <button
                className="hidden rounded px-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] group-hover:block"
                disabled={busy}
                onClick={() => void run_action(() => window.editor_api.git.stage(rootPath, [change.path]))}
                title="Stage"
                type="button"
              >
                +
              </button>
            )}
            {change.staged && (
              <button
                className="hidden rounded px-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] group-hover:block"
                disabled={busy}
                onClick={() => void run_action(() => window.editor_api.git.unstage(rootPath, [change.path]))}
                title="Unstage"
                type="button"
              >
                −
              </button>
            )}
          </div>
        ))}
        {status?.changes.length === 0 && <div className="px-3 py-4 text-[11px] text-[var(--muted)]">No changes.</div>}

        {diff && (diff.staged || diff.working) && (
          <div className="border-t border-[var(--border)]">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Diff
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-[var(--border)] bg-[var(--editor-bg)] p-2 font-mono text-[10px] leading-4 text-[var(--text)]">
              {[diff.staged && `STAGED\n${diff.staged}`, diff.working && `WORKING TREE\n${diff.working}`]
                .filter(Boolean)
                .join('\n\n')}
            </pre>
          </div>
        )}

        <div className="border-t border-[var(--border)]">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            History
          </div>
          {history.map((commit_item, index) => (
            <div className="relative flex gap-2 border-t border-[var(--border)]/40 px-3 py-2" key={commit_item.hash}>
              <div className="relative flex w-3 shrink-0 justify-center">
                {index < history.length - 1 && (
                  <span className="absolute bottom-[-9px] top-2 w-px bg-[var(--border)]" />
                )}
                <span className="relative mt-1 h-2 w-2 rounded-full border border-sky-400 bg-[var(--surface-2)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-[var(--text)]" title={commit_item.subject}>
                  {commit_item.subject}
                </div>
                <div className="mt-0.5 flex gap-2 text-[9px] text-[var(--muted)]">
                  <span className="font-mono">{commit_item.short_hash}</span>
                  <span className="truncate">{commit_item.author_name}</span>
                  <span className="ml-auto shrink-0">{compact_date(commit_item.date)}</span>
                </div>
              </div>
            </div>
          ))}
          {history.length === 0 && <div className="px-3 py-3 text-[11px] text-[var(--muted)]">No commits yet.</div>}
        </div>
      </div>
    </div>
  )
}

export default SourceControlPanel
