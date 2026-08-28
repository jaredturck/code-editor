import { useState } from 'react'
import type { AgentActivityItem } from '../types/editor'
import AgentReasoningPanel from './AgentReasoningPanel'

interface AgentActivityTimelineProps {
  activity: AgentActivityItem[]
}

interface ActivityRow {
  call: AgentActivityItem | null
  result: AgentActivityItem | null
  item: AgentActivityItem
}

function pair_activity(activity: AgentActivityItem[]) {
  const rows: ActivityRow[] = []
  const pending_by_tool = new Map<string, number[]>()

  activity.forEach((item) => {
    if (item.type === 'tool_call') {
      const row_index = rows.length
      rows.push({ call: item, result: null, item })
      const pending = pending_by_tool.get(item.tool) ?? []
      pending.push(row_index)
      pending_by_tool.set(item.tool, pending)
      return
    }

    if (item.type === 'tool_result') {
      const pending = pending_by_tool.get(item.tool)
      const row_index = pending?.shift()
      if (row_index !== undefined) {
        rows[row_index].result = item
        return
      }
    }

    rows.push({ call: null, result: item.type === 'tool_result' ? item : null, item })
  })

  return rows
}

function activity_state(row: ActivityRow) {
  const status = `${row.result?.status || row.item.status} ${row.result?.label || ''} ${row.item.label}`.toLowerCase()
  if (/fail|error|denied|reject|cancel|invalid/.test(status)) return 'failed'
  if (/warn|timeout|pending|approval|required|waiting|paused|interrupt/.test(status)) return 'warning'
  if (row.result || /complete|success|done|\bok\b/.test(status)) return 'complete'
  return 'normal'
}

function state_label(state: ReturnType<typeof activity_state>) {
  if (state === 'failed') return 'failed'
  if (state === 'warning') return 'warning'
  return ''
}

function state_dot_class(state: ReturnType<typeof activity_state>) {
  if (state === 'failed') return 'bg-red-400'
  if (state === 'warning') return 'bg-amber-400'
  return 'bg-[var(--text)]/65'
}

function parse_detail(detail: string) {
  const clean = detail.trim()
  if (!clean) return null

  let parsed: unknown = clean
  for (let pass = 0; pass < 2 && typeof parsed === 'string'; pass += 1) {
    const value = parsed.trim()
    if (!value || (!value.startsWith('{') && !value.startsWith('[') && !value.startsWith('"'))) break
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      break
    }
  }
  return parsed
}

function string_value(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function path_value(fields: Record<string, unknown>) {
  return string_value(fields.path || fields.file_path || fields.filePath)
}

function file_name(path: string) {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const name = clean.split('/').pop() || clean
  return name === '.' || name === '..' || name === '/' ? '' : name
}

function shorten_paths(value: string) {
  return value.replace(/(^|[\s"'(])\/(?:[^/\s"']+\/)+([^/\s"']+)/g, '$1$2')
}

function compact_text(value: string, max_lines = 12, max_chars = 1600) {
  const clean = shorten_paths(value).trim()
  if (!clean) return ''

  const lines = clean.split('\n')
  const visible = lines.slice(0, max_lines).map((line) => (line.length > 220 ? `${line.slice(0, 217)}...` : line))
  if (lines.length > max_lines) visible.push(`… ${lines.length - max_lines} more lines`)

  const joined = visible.join('\n')
  return joined.length > max_chars ? `${joined.slice(0, max_chars - 1)}…` : joined
}

function detail_file_name(detail: string) {
  const parsed = parse_detail(detail)
  if (typeof parsed === 'string') {
    return parsed.startsWith('/') && !parsed.includes('\n') ? file_name(parsed) : ''
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  return file_name(path_value(parsed as Record<string, unknown>))
}

function CodeBlock({ label, value }: { label?: string; value: string }) {
  if (!value) return null

  return (
    <div className="mt-1.5 min-w-0">
      {label && <div className="mb-1 text-[8px] uppercase tracking-wide text-[var(--muted)]">{label}</div>}
      <pre className="max-h-44 overflow-auto rounded-md border border-[var(--border)] bg-[var(--editor-bg)] px-2 py-1.5 text-[9px] leading-relaxed text-[var(--text)] select-text">
        <code>{value}</code>
      </pre>
    </div>
  )
}

function DiffPreview({ value }: { value: string }) {
  const lines = value.split('\n').filter((line) => !/^(diff --git|index |--- |\+\+\+ )/.test(line))
  const visible = lines.slice(0, 28)
  const hidden = Math.max(0, lines.length - visible.length)
  if (!visible.length) return null

  return (
    <div className="mt-1.5 min-w-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--editor-bg)]">
      <div className="border-b border-[var(--border)] px-2 py-1 text-[8px] uppercase tracking-wide text-[var(--muted)]">
        Changes
      </div>
      <pre className="max-h-52 overflow-auto px-2 py-1.5 text-[9px] leading-relaxed select-text">
        {visible.map((line, index) => (
          <span
            className={
              line.startsWith('+')
                ? 'block text-emerald-300'
                : line.startsWith('-')
                  ? 'block text-red-300'
                  : line.startsWith('@@')
                    ? 'block text-sky-300/80'
                    : 'block text-[var(--muted)]'
            }
            key={`${index}:${line.slice(0, 32)}`}
          >
            {shorten_paths(line)}
            {'\n'}
          </span>
        ))}
        {hidden > 0 && <span className="text-[var(--muted)]">… {hidden} more lines</span>}
      </pre>
    </div>
  )
}

function build_inline_diff(old_text: string, new_text: string) {
  const lines: string[] = []
  if (old_text) lines.push(...old_text.split('\n').map((line) => `-${line}`))
  if (new_text) lines.push(...new_text.split('\n').map((line) => `+${line}`))
  return lines.join('\n')
}

function ActivityDetail({ detail, tool }: { detail: string; tool: string }) {
  const parsed = parse_detail(detail)
  if (parsed === null) return null

  if (typeof parsed === 'string') {
    if (parsed.startsWith('/') && !parsed.includes('\n')) return null
    const text = compact_text(parsed, 8, 1000)
    return text.includes('\n') ? (
      <CodeBlock value={text} />
    ) : (
      <div className="mt-0.5 break-words text-[9px] leading-relaxed text-[var(--muted)] select-text">{text}</div>
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const fields = parsed as Record<string, unknown>
  const command = string_value(fields.command)
  const diff = string_value(fields.diff || fields.patch)
  const old_text = string_value(fields.oldText || fields.old_text)
  const new_text = string_value(fields.newText || fields.new_text)
  const stdout = string_value(fields.stdout)
  const stderr = string_value(fields.stderr)
  const error = string_value(fields.error)
  const message = string_value(fields.message || fields.summary)
  const is_terminal = tool.includes('terminal') || Boolean(command)
  const is_edit = Boolean(diff || old_text || new_text) || /edit|write|patch|diff/.test(tool)
  const is_file_read = /files\.(read|list|find|stat)/.test(tool)

  if (is_terminal) {
    return (
      <div className="min-w-0 select-text">
        {command && <CodeBlock label="Command" value={compact_text(command, 4, 700)} />}
        {stdout && <CodeBlock label="Output" value={compact_text(stdout)} />}
        {stderr && <CodeBlock label="Error output" value={compact_text(stderr, 8, 1000)} />}
        {error && <div className="mt-1 text-[9px] text-red-300">{compact_text(error, 4, 700)}</div>}
      </div>
    )
  }

  if (is_edit) {
    const preview = diff || build_inline_diff(old_text, new_text)
    return (
      <div className="min-w-0 select-text">
        {preview && <DiffPreview value={preview} />}
        {error && <div className="mt-1 text-[9px] text-red-300">{compact_text(error, 4, 700)}</div>}
      </div>
    )
  }

  if (error) {
    return <div className="mt-1 text-[9px] text-red-300">{compact_text(error, 4, 700)}</div>
  }

  if (is_file_read) return null

  if (message) {
    return (
      <div className="mt-0.5 break-words text-[9px] leading-relaxed text-[var(--muted)] select-text">
        {compact_text(message, 4, 700)}
      </div>
    )
  }

  return null
}

function row_file_name(row: ActivityRow) {
  return (
    detail_file_name(row.call?.detail || '') ||
    detail_file_name(row.result?.detail || '') ||
    detail_file_name(row.item.detail || '')
  )
}

function fallback_tool_title(tool: string, label: string) {
  const clean_label = label.replace(/\s+(complete|failed)$/i, '').trim()
  if (clean_label && !/^tool(?: call)?$/i.test(clean_label)) return clean_label
  if (!tool) return 'Agent action'
  return tool.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function row_title(row: ActivityRow) {
  const tool = row.call?.tool || row.item.tool
  const name = row_file_name(row)
  const running = Boolean(row.call && !row.result)

  if (tool === 'files.read') return name ? `Read ${name}` : 'Read file'
  if (/^files\.(write|edit|patch|diff)$/.test(tool)) return name ? `Edited ${name}` : 'Edited file'
  if (tool === 'files.find') return 'Searched files'
  if (tool === 'files.list') return name ? `Listed ${name}` : 'Listed files'
  if (tool === 'files.stat') return name ? `Inspected ${name}` : 'Inspected files'
  if (tool === 'image.generate') return running ? 'Generating image' : name ? `Generated ${name}` : 'Generated image'
  if (tool.includes('terminal')) return running ? 'Running command' : 'Ran command'
  if (tool.includes('diagnostics')) return running ? 'Checking diagnostics' : 'Checked diagnostics'
  if (tool === 'code.definition') return running ? 'Finding definition' : 'Found definition'
  if (tool === 'code.references') return running ? 'Finding references' : 'Found references'
  if (tool === 'search.web') return running ? 'Searching web' : 'Searched web'
  if (tool === 'web.fetch') return running ? 'Fetching page' : 'Fetched page'
  if (tool === 'browser.inspect') return running ? 'Inspecting browser' : 'Inspected browser'
  if (tool === 'agent.delegate') return running ? 'Delegating task' : 'Delegated task'
  if (tool === 'agent.consult') return running ? 'Consulting specialist' : 'Consulted specialist'
  if (tool === 'agent.review') return running ? 'Reviewing changes' : 'Reviewed changes'
  if (tool === 'user.ask') return 'Asked user'
  if (tool === 'approval.request') return 'Requested approval'

  return fallback_tool_title(tool, row.call?.label || row.item.label)
}

function AgentActivityTimeline({ activity }: AgentActivityTimelineProps) {
  const [expanded, set_expanded] = useState(false)
  const rows = pair_activity(activity.filter((item) => item.type !== 'planning'))

  return (
    <>
      <AgentReasoningPanel activity={activity} />
      {rows.length > 0 && (
        <details
          className="mb-2 rounded-lg border border-[var(--border)] bg-black/[0.05] px-2 py-1.5"
          onToggle={(event) => set_expanded(event.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none text-[9px] font-medium text-[var(--muted)]">
            Agent activity · {rows.length} action{rows.length === 1 ? '' : 's'}
          </summary>
          {expanded && (
            <div className="mt-2 space-y-1">
              {rows.map((row) => {
                const state = activity_state(row)
                const label = state_label(state)
                const detail = row.result?.detail || row.call?.detail || row.item.detail
                const detail_tool = row.result?.tool || row.call?.tool || row.item.tool

                return (
                  <div
                    className="group flex min-w-0 gap-2 rounded-md px-1 py-1 hover:bg-white/[0.025]"
                    key={`${row.item.id}-${row.result?.id || ''}`}
                  >
                    <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${state_dot_class(state)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-1.5 text-[9px]">
                        <span className="truncate font-medium text-[var(--text)]">{row_title(row)}</span>
                        {label && (
                          <span className={state === 'failed' ? 'shrink-0 text-red-300' : 'shrink-0 text-amber-300'}>
                            ({label})
                          </span>
                        )}
                      </div>
                      {detail && <ActivityDetail detail={detail} tool={detail_tool} />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </details>
      )}
    </>
  )
}

export default AgentActivityTimeline
