import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import Icon from './Icon'
import trash_icon from './images/trash.svg'
import type { BottomPanelTab, TerminalSession } from '../types/editor'

interface TerminalPanelProps {
  activeTab: BottomPanelTab
  activeTerminalId: number | null
  terminalListWidth: number
  terminals: TerminalSession[]
  visibleTerminals: TerminalSession[]
  onClosePanel: () => void
  onCreateTerminal: () => void
  onDeleteTerminal: (terminalId: number) => void
  onResizePanel: (event: ReactPointerEvent<HTMLElement>) => void
  onResizeTerminalList: (event: ReactPointerEvent<HTMLElement>) => void
  onSelectTab: (tab: BottomPanelTab) => void
  onSelectTerminal: (terminalId: number) => void
  onSubmitTerminalInput: (terminalId: number) => void
  onUpdateTerminalInput: (terminalId: number, input: string) => void
}

const prompt = '[code-editor]$'

function TerminalPane({
  active,
  terminal,
  onSelectTerminal,
  onSubmitTerminalInput,
  onUpdateTerminalInput,
}: {
  active: boolean
  terminal: TerminalSession
  onSelectTerminal: (terminalId: number) => void
  onSubmitTerminalInput: (terminalId: number) => void
  onUpdateTerminalInput: (terminalId: number, input: string) => void
}) {
  const handle_terminal_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onSubmitTerminalInput(terminal.id)
    }
  }

  return (
    <div
      className={`min-w-0 overflow-auto px-4 py-3 font-mono text-[13px] text-[var(--terminal-text)] ${active ? 'bg-[var(--terminal-active)]' : ''}`}
      onClick={() => onSelectTerminal(terminal.id)}
    >
      {terminal.history.map((command, index) => (
        <div className="whitespace-pre-wrap" key={`${terminal.id}-${index}`}>
          <span className="text-[var(--terminal-prompt)]">{prompt} </span>
          <span>{command}</span>
        </div>
      ))}

      <div className="flex min-w-0 items-center">
        <span className="shrink-0 text-[var(--terminal-prompt)]">{prompt}&nbsp;</span>
        <input
          aria-label={`${terminal.name} command input`}
          autoFocus={active}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[13px] text-[var(--terminal-text)] caret-sky-400 outline-none"
          onChange={(event) => onUpdateTerminalInput(terminal.id, event.target.value)}
          onFocus={() => onSelectTerminal(terminal.id)}
          onKeyDown={handle_terminal_key_down}
          spellCheck={false}
          value={terminal.input}
        />
      </div>
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

function TerminalPanel({
  activeTab,
  activeTerminalId,
  terminalListWidth,
  terminals,
  visibleTerminals,
  onClosePanel,
  onCreateTerminal,
  onDeleteTerminal,
  onResizePanel,
  onResizeTerminalList,
  onSelectTab,
  onSelectTerminal,
  onSubmitTerminalInput,
  onUpdateTerminalInput,
}: TerminalPanelProps) {
  const root_terminals = terminals
    .filter((terminal) => terminal.parent_id === null)
    .sort((first_terminal, second_terminal) => first_terminal.id - second_terminal.id)

  return (
    <section
      aria-label="Bottom panel"
      className="relative flex min-h-0 flex-col border-t border-[var(--border)] bg-[var(--surface-3)]"
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
            PROBLEMS
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

      {activeTab === 'problems' ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3 text-xs text-[var(--text)]">
          No problems have been identified in the workspace.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            className="grid min-w-0 flex-1 divide-x divide-[var(--border)]"
            style={{
              gridTemplateColumns: `repeat(${Math.max(visibleTerminals.length, 1)}, minmax(0, 1fr))`,
            }}
          >
            {visibleTerminals.length > 0 ? (
              visibleTerminals.map((terminal) => (
                <TerminalPane
                  active={terminal.id === activeTerminalId}
                  key={terminal.id}
                  onSelectTerminal={onSelectTerminal}
                  onSubmitTerminalInput={onSubmitTerminalInput}
                  onUpdateTerminalInput={onUpdateTerminalInput}
                  terminal={terminal}
                />
              ))
            ) : (
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
              const child_terminals = terminals
                .filter((item) => item.parent_id === terminal.id)
                .sort((first_terminal, second_terminal) => first_terminal.id - second_terminal.id)

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
      )}
    </section>
  )
}

export default TerminalPanel
