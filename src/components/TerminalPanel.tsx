import { useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { BottomPanelTab, EditorDiagnostic, TerminalSession } from '../types/editor'
import Icon from './Icon'
import trash_icon from './images/trash.svg'

interface TerminalPanelProps {
  activeTab: BottomPanelTab
  activeTerminalId: number | null
  terminalListWidth: number
  terminals: TerminalSession[]
  visible: boolean
  diagnostics: EditorDiagnostic[]
  onClosePanel: () => void
  onCreateTerminal: () => void
  onDeleteTerminal: (terminalId: number) => void
  onOpenDiagnostic: (diagnostic: EditorDiagnostic) => void
  onResizePanel: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizeTerminalList: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizeTerminalPanes: (
    leftTerminalId: number,
    rightTerminalId: number,
    leftWeight: number,
    rightWeight: number,
  ) => void
  onSelectTab: (tab: BottomPanelTab) => void
  onSelectTerminal: (terminalId: number) => void
  onTerminalStatusChange: (terminalId: number, status: TerminalSession['status'], exitCode?: number | null) => void
}

const minimum_terminal_pane_width = 140

function start_terminal_split_resize(
  event: React.PointerEvent<HTMLDivElement>,
  container: HTMLDivElement,
  terminals: TerminalSession[],
  divider_index: number,
  onResizeTerminalPanes: TerminalPanelProps['onResizeTerminalPanes'],
) {
  event.preventDefault()
  const left_terminal = terminals[divider_index]
  const right_terminal = terminals[divider_index + 1]
  const container_width = container.getBoundingClientRect().width
  const total_weight = terminals.reduce((sum, terminal) => sum + terminal.weight, 0)
  const pair_weight = left_terminal.weight + right_terminal.weight
  const minimum_weight = Math.min(pair_weight / 2, (minimum_terminal_pane_width / container_width) * total_weight)
  const start_x = event.clientX
  const start_left_weight = left_terminal.weight

  const move = (move_event: PointerEvent) => {
    const weight_delta = ((move_event.clientX - start_x) / container_width) * total_weight
    const next_left_weight = Math.min(
      pair_weight - minimum_weight,
      Math.max(minimum_weight, start_left_weight + weight_delta),
    )

    onResizeTerminalPanes(left_terminal.id, right_terminal.id, next_left_weight, pair_weight - next_left_weight)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

function TerminalPane({
  active,
  terminal,
  onSelectTerminal,
  onTerminalStatusChange,
  visible,
}: {
  active: boolean
  terminal: TerminalSession
  onSelectTerminal: (terminalId: number) => void
  onTerminalStatusChange: TerminalPanelProps['onTerminalStatusChange']
  visible: boolean
}) {
  const container_ref = useRef<HTMLDivElement>(null)
  const terminal_ref = useRef<Terminal | null>(null)
  const fit_ref = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!container_ref.current) {
      return
    }

    const styles = getComputedStyle(container_ref.current)
    const xterm = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: styles.getPropertyValue('--terminal-bg').trim() || '#18181b',
        foreground: styles.getPropertyValue('--terminal-text').trim() || '#d4d4d4',
        cursor: '#38bdf8',
        selectionBackground: '#2563eb66',
      },
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(container_ref.current)
    terminal_ref.current = xterm
    fit_ref.current = fit

    const remove_data_listener = window.editor_api.terminal.on_data((payload) => {
      if (payload.terminal_id === terminal.id) {
        xterm.write(payload.data)
      }
    })
    const remove_exit_listener = window.editor_api.terminal.on_exit((payload) => {
      if (payload.terminal_id !== terminal.id) {
        return
      }

      xterm.write(`\r\n\x1b[90m[Process exited with code ${payload.exit_code}]\x1b[0m\r\n`)
      onTerminalStatusChange(terminal.id, 'exited', payload.exit_code)
    })
    const input_disposable = xterm.onData((data) => window.editor_api.terminal.write(terminal.id, data))
    const resize_observer = new ResizeObserver(() => {
      if (!container_ref.current || container_ref.current.offsetParent === null) {
        return
      }

      fit.fit()
      window.editor_api.terminal.resize(terminal.id, xterm.cols, xterm.rows)
    })

    resize_observer.observe(container_ref.current)
    void window.editor_api.terminal
      .create(terminal.id, terminal.cwd)
      .then(() => {
        onTerminalStatusChange(terminal.id, 'running', null)
        requestAnimationFrame(() => {
          fit.fit()
          window.editor_api.terminal.resize(terminal.id, xterm.cols, xterm.rows)
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to start the terminal.'
        xterm.writeln(`\x1b[31m${message}\x1b[0m`)
        onTerminalStatusChange(terminal.id, 'error', null)
      })

    return () => {
      resize_observer.disconnect()
      input_disposable.dispose()
      remove_data_listener()
      remove_exit_listener()
      xterm.dispose()
      terminal_ref.current = null
      fit_ref.current = null
    }
  }, [terminal.id])

  useEffect(() => {
    if (!active || !visible) {
      return
    }

    requestAnimationFrame(() => {
      fit_ref.current?.fit()
      terminal_ref.current?.focus()

      if (terminal_ref.current) {
        window.editor_api.terminal.resize(terminal.id, terminal_ref.current.cols, terminal_ref.current.rows)
      }
    })
  }, [active, terminal.id, terminal.weight, visible])

  return (
    <div
      className={`min-w-0 overflow-hidden bg-[var(--terminal-bg)] ${active ? 'ring-1 ring-inset ring-[var(--border)]' : ''}`}
      onMouseDown={() => {
        onSelectTerminal(terminal.id)
        terminal_ref.current?.focus()
      }}
      style={{
        flexBasis: 0,
        flexGrow: terminal.weight,
        minWidth: minimum_terminal_pane_width,
      }}
    >
      <div className="h-full w-full px-2 py-1" ref={container_ref} />
    </div>
  )
}

function TerminalSessionRow({
  child,
  isActive,
  terminal,
  onDeleteTerminal,
  onSelectTerminal,
}: {
  child: boolean
  isActive: boolean
  terminal: TerminalSession
  onDeleteTerminal: (terminalId: number) => void
  onSelectTerminal: (terminalId: number) => void
}) {
  const status_label =
    terminal.status === 'starting'
      ? 'Starting'
      : terminal.status === 'error'
        ? 'Error'
        : terminal.status === 'exited'
          ? 'Exited'
          : ''

  return (
    <div
      className={`group relative flex h-7 items-center ${isActive ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'}`}
    >
      {child && <span className="absolute -left-3 top-1/2 h-px w-3 bg-[var(--muted)]/50" />}
      <button
        className="min-w-0 flex-1 truncate px-3 text-left text-xs text-[var(--text)]"
        onClick={() => onSelectTerminal(terminal.id)}
        title={terminal.name}
        type="button"
      >
        <span className="mr-2 text-[var(--muted)]">›_</span>
        {terminal.name}
        {status_label && <span className="ml-2 text-[9px] text-amber-400">{status_label}</span>}
      </button>
      <button
        aria-label={`Delete ${terminal.name}`}
        className="mr-1 hidden h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--selected)] hover:text-[var(--text)] group-hover:flex"
        onClick={() => onDeleteTerminal(terminal.id)}
        title={`Delete ${terminal.name}`}
        type="button"
      >
        <Icon className="h-3.5 w-3.5" src={trash_icon} />
      </button>
    </div>
  )
}

function ProblemsPanel({
  diagnostics,
  onOpenDiagnostic,
}: Pick<TerminalPanelProps, 'diagnostics' | 'onOpenDiagnostic'>) {
  const [filter, set_filter] = useState<'all' | 'error' | 'warning'>('all')
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length
  const visible_diagnostics = diagnostics.filter((diagnostic) => filter === 'all' || diagnostic.severity === filter)
  const grouped = useMemo(() => {
    const groups = new Map<string, EditorDiagnostic[]>()

    for (const diagnostic of visible_diagnostics) {
      const key = diagnostic.file_path ?? `Untitled ${diagnostic.document_id}`
      groups.set(key, [...(groups.get(key) ?? []), diagnostic])
    }

    return [...groups.entries()]
  }, [visible_diagnostics])

  if (diagnostics.length === 0) {
    return <div className="px-5 py-4 text-xs text-[var(--muted)]">No problems have been identified.</div>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] text-[var(--muted)]">
          {errors} errors · {warnings} warnings
        </span>
        <div className="flex rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {(
            [
              ['all', 'All'],
              ['error', 'Errors'],
              ['warning', 'Warnings'],
            ] as const
          ).map(([value, label]) => (
            <button
              className={`rounded px-2 py-1 text-[10px] ${filter === value ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
              key={value}
              onClick={() => set_filter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {visible_diagnostics.length === 0 && (
        <div className="px-2 py-3 text-[var(--muted)]">No {filter === 'error' ? 'errors' : 'warnings'} to show.</div>
      )}
      {grouped.map(([file_path, items]) => (
        <section className="mb-3" key={file_path}>
          <div className="mb-1 truncate px-2 text-[11px] font-semibold text-[var(--text)]" title={file_path}>
            {file_path.split(/[\\/]/).pop()}
          </div>
          {items.map((diagnostic) => (
            <button
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--hover)]"
              key={diagnostic.id}
              onClick={() => onOpenDiagnostic(diagnostic)}
              type="button"
            >
              <span className={diagnostic.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                {diagnostic.severity === 'error' ? '●' : '▲'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[var(--text)]">{diagnostic.message}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                  {diagnostic.source}
                  {diagnostic.code ? ` · ${diagnostic.code}` : ''} · {diagnostic.line}:{diagnostic.column}
                </span>
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function TerminalPanel({
  activeTab,
  activeTerminalId,
  terminalListWidth,
  terminals,
  visible,
  diagnostics,
  onClosePanel,
  onCreateTerminal,
  onDeleteTerminal,
  onOpenDiagnostic,
  onResizePanel,
  onResizeTerminalList,
  onResizeTerminalPanes,
  onSelectTab,
  onSelectTerminal,
  onTerminalStatusChange,
}: TerminalPanelProps) {
  const terminal_panes_ref = useRef<HTMLDivElement>(null)
  const root_terminals = terminals
    .filter((terminal) => terminal.parent_id === null)
    .sort((first_terminal, second_terminal) => first_terminal.id - second_terminal.id)
  const active_terminal = terminals.find((terminal) => terminal.id === activeTerminalId) ?? null
  const active_root_id = active_terminal?.parent_id ?? active_terminal?.id ?? null

  return (
    <section
      aria-label="Bottom panel"
      className={`relative min-h-0 flex-col border-t border-[var(--border)] bg-[var(--surface-3)] ${visible ? 'flex' : 'hidden'}`}
    >
      <div
        aria-label="Resize bottom panel"
        aria-orientation="horizontal"
        className="absolute inset-x-0 top-0 z-20 h-1 -translate-y-1/2 cursor-row-resize hover:bg-sky-500/70"
        onPointerDown={onResizePanel}
        role="separator"
      />
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--border)] px-3 text-xs">
        <div className="flex h-full items-center gap-5">
          <button
            className={`relative h-full text-xs ${activeTab === 'problems' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            onClick={() => onSelectTab('problems')}
            type="button"
          >
            PROBLEMS{' '}
            {diagnostics.length > 0 && <span className="ml-1 text-[10px] text-red-400">{diagnostics.length}</span>}
            {activeTab === 'problems' && <span className="absolute inset-x-0 bottom-0 h-px bg-sky-500" />}
          </button>
          <button
            className={`relative h-full text-xs ${activeTab === 'terminal' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            onClick={() => onSelectTab('terminal')}
            type="button"
          >
            TERMINAL
            {activeTab === 'terminal' && <span className="absolute inset-x-0 bottom-0 h-px bg-sky-500" />}
          </button>
        </div>
        <div className="ml-auto flex h-full items-center gap-1">
          {activeTab === 'terminal' && (
            <button
              aria-label="New terminal"
              className="flex h-7 w-7 items-center justify-center rounded text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={onCreateTerminal}
              title="New terminal"
              type="button"
            >
              +
            </button>
          )}
          <button
            aria-label="Close bottom panel"
            className="flex h-7 w-7 items-center justify-center rounded text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onClosePanel}
            title="Close panel"
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      {activeTab === 'problems' && <ProblemsPanel diagnostics={diagnostics} onOpenDiagnostic={onOpenDiagnostic} />}
      <div className={`min-h-0 flex-1 ${activeTab === 'terminal' ? 'flex' : 'hidden'}`}>
        <div className="relative min-w-0 flex-1 overflow-hidden" ref={terminal_panes_ref}>
          {root_terminals.map((root_terminal) => {
            const group = [root_terminal, ...terminals.filter((terminal) => terminal.parent_id === root_terminal.id)]
            const group_active = root_terminal.id === active_root_id

            return (
              <div className={`absolute inset-0 ${group_active ? 'flex' : 'invisible flex'}`} key={root_terminal.id}>
                {group.map((terminal, index) => (
                  <div className="contents" key={terminal.id}>
                    <TerminalPane
                      active={group_active && terminal.id === activeTerminalId}
                      onSelectTerminal={onSelectTerminal}
                      onTerminalStatusChange={onTerminalStatusChange}
                      terminal={terminal}
                      visible={visible && activeTab === 'terminal'}
                    />
                    {index < group.length - 1 && (
                      <div className="relative w-px shrink-0 bg-[var(--border)]">
                        <div
                          aria-label={`Resize ${terminal.name} split`}
                          aria-orientation="vertical"
                          className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-sky-500/70"
                          onPointerDown={(event) => {
                            if (terminal_panes_ref.current) {
                              start_terminal_split_resize(
                                event,
                                terminal_panes_ref.current,
                                group,
                                index,
                                onResizeTerminalPanes,
                              )
                            }
                          }}
                          role="separator"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
          {terminals.length === 0 && (
            <div className="px-4 py-3 text-xs text-[var(--muted)]">
              No terminal sessions. Use the plus button to create one.
            </div>
          )}
        </div>
        <aside
          aria-label="Terminal sessions"
          className="relative shrink-0 border-l border-[var(--border)] py-2 text-xs"
          style={{ width: terminalListWidth }}
        >
          <div
            aria-label="Resize terminal session list"
            aria-orientation="vertical"
            className="absolute inset-y-0 left-0 z-20 w-1 -translate-x-1/2 cursor-col-resize hover:bg-sky-500/70"
            onPointerDown={onResizeTerminalList}
            role="separator"
          />
          {root_terminals.map((terminal) => {
            const child_terminals = terminals.filter((item) => item.parent_id === terminal.id)

            return (
              <div key={terminal.id}>
                <TerminalSessionRow
                  child={false}
                  isActive={terminal.id === activeTerminalId}
                  onDeleteTerminal={onDeleteTerminal}
                  onSelectTerminal={onSelectTerminal}
                  terminal={terminal}
                />
                {child_terminals.length > 0 && (
                  <div className="relative ml-4 border-l border-[var(--muted)]/40 pl-3">
                    {child_terminals.map((child_terminal) => (
                      <TerminalSessionRow
                        child
                        isActive={child_terminal.id === activeTerminalId}
                        key={child_terminal.id}
                        onDeleteTerminal={onDeleteTerminal}
                        onSelectTerminal={onSelectTerminal}
                        terminal={child_terminal}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </aside>
      </div>
    </section>
  )
}

export default TerminalPanel
