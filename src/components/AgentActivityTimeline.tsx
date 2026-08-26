import { useState } from 'react'
import type { AgentActivityItem } from '../types/editor'

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
  if (state === 'complete') return 'succeeded'
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

  try {
    return JSON.parse(clean) as unknown
  } catch {
    return clean
  }
}

function string_value(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function CodeBlock({ label, value }: { label?: string; value: string }) {
  if (!value) return null

  return (
    <div className="mt-1.5 min-w-0">
      {label && <div className="mb-1 text-[8px] uppercase tracking-wide text-[var(--muted)]">{label}</div>}
      <pre className="max-h-56 overflow-auto rounded-md border border-[var(--border)] bg-[var(--editor-bg)] px-2 py-1.5 text-[9px] leading-relaxed text-[var(--text)] select-text">
        <code>{value}</code>
      </pre>
    </div>
  )
}

function JsonFields({ value, exclude = [] }: { value: Record<string, unknown>; exclude?: string[] }) {
  const remaining = Object.fromEntries(Object.entries(value).filter(([key]) => !exclude.includes(key)))
  if (Object.keys(remaining).length === 0) return null

  return <CodeBlock value={JSON.stringify(remaining, null, 2)} />
}

function ActivityDetail({ detail, tool }: { detail: string; tool: string }) {
  const parsed = parse_detail(detail)
  if (parsed === null) return null

  if (typeof parsed === 'string') {
    const multiline = parsed.includes('\n') || parsed.length > 140
    return multiline ? (
      <CodeBlock value={parsed} />
    ) : (
      <div className="mt-0.5 break-words text-[9px] leading-relaxed text-[var(--muted)] select-text">{parsed}</div>
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <CodeBlock value={JSON.stringify(parsed, null, 2)} />
  }

  const fields = parsed as Record<string, unknown>
  const command = string_value(fields.command)
  const path = string_value(fields.path || fields.file_path || fields.filePath)
  const old_text = string_value(fields.oldText || fields.old_text)
  const new_text = string_value(fields.newText || fields.new_text)
  const content = string_value(fields.content)
  const is_terminal = tool.includes('terminal') || Boolean(command)
  const is_edit = Boolean(old_text || new_text) || /edit|write|patch/.test(tool)
  const excluded = ['command', 'path', 'file_path', 'filePath', 'oldText', 'old_text', 'newText', 'new_text', 'content']

  return (
    <div className="min-w-0 select-text">
      {path && <div className="mt-0.5 break-all text-[9px] text-[var(--muted)]">{path}</div>}
      {is_terminal && command && <CodeBlock label="Command" value={command} />}
      {is_edit && old_text && <CodeBlock label="Before" value={old_text} />}
      {is_edit && new_text && <CodeBlock label="After" value={new_text} />}
      {content && <CodeBlock label={is_edit ? 'Content' : undefined} value={content} />}
      <JsonFields exclude={excluded} value={fields} />
    </div>
  )
}

function row_title(row: ActivityRow) {
  const call_label = row.call?.label || row.item.label
  if (row.call) return call_label.replace(/\s+(complete|failed)$/i, '')
  if (row.item.type === 'tool_result') return row.item.label.replace(/\s+(complete|failed)$/i, '')
  return call_label
}

function AgentActivityTimeline({ activity }: AgentActivityTimelineProps) {
  const [expanded, set_expanded] = useState(false)
  const rows = expanded ? pair_activity(activity) : []

  return (
    <details
      className="mb-2 rounded-lg border border-[var(--border)] bg-black/[0.05] px-2 py-1.5"
      onToggle={(event) => set_expanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer select-none text-[9px] font-medium text-[var(--muted)]">
        Agent activity · {activity.length} event{activity.length === 1 ? '' : 's'}
      </summary>
      {expanded && (
        <div className="mt-2 space-y-1">
          {rows.map((row) => {
            const state = activity_state(row)
            const result_detail = row.result && row.result !== row.item ? row.result.detail : ''
            const label = state_label(state)

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
                      <span
                        className={
                          state === 'failed'
                            ? 'shrink-0 text-red-300'
                            : state === 'warning'
                              ? 'shrink-0 text-amber-300'
                              : 'shrink-0 text-[var(--muted)]'
                        }
                      >
                        ({label})
                      </span>
                    )}
                  </div>
                  {row.call?.detail && <ActivityDetail detail={row.call.detail} tool={row.call.tool} />}
                  {!row.call && row.item.detail && <ActivityDetail detail={row.item.detail} tool={row.item.tool} />}
                  {result_detail && result_detail !== row.call?.detail && (
                    <div className="mt-1 border-l border-[var(--border)] pl-2">
                      <ActivityDetail detail={result_detail} tool={row.result?.tool || row.item.tool} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </details>
  )
}

export default AgentActivityTimeline
