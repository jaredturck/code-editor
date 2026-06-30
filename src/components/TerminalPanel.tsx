import type { KeyboardEvent } from 'react'
import type { BottomPanelTab, TerminalSession } from '../types/editor'

interface TerminalPanelProps {
  activeTab: BottomPanelTab
  activeTerminal: TerminalSession | null
  activeTerminalId: number | null
  terminals: TerminalSession[]
  onClosePanel: () => void
  onCreateTerminal: () => void
  onDeleteTerminal: (terminalId: number) => void
  onSelectTab: (tab: BottomPanelTab) => void
  onSelectTerminal: (terminalId: number) => void
  onSubmitTerminalInput: (terminalId: number) => void
  onUpdateTerminalInput: (terminalId: number, input: string) => void
}

const prompt = '[code-editor]$'

function TerminalPanel({ activeTab, activeTerminal, activeTerminalId, terminals, onClosePanel, onCreateTerminal, onDeleteTerminal, onSelectTab, onSelectTerminal, onSubmitTerminalInput, onUpdateTerminalInput }: TerminalPanelProps) {
  const handle_terminal_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && activeTerminal) {
      onSubmitTerminalInput(activeTerminal.id)
    }
  }

  return (
    <section aria-label="Bottom panel" className="flex min-h-0 flex-col border-t border-[var(--border)] bg-[var(--surface-3)]">
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--border)] px-3">
        <div className="flex h-full items-center gap-5">
          <button
            className={`relative h-full text-[11px] ${activeTab === 'problems' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            onClick={() => onSelectTab('problems')}
            type="button"
          >
            PROBLEMS
            {activeTab === 'problems' && <span className="absolute inset-x-0 bottom-0 h-px bg-sky-500" />}
          </button>

          <button
            className={`relative h-full text-[11px] ${activeTab === 'terminal' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
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
          <div className="min-w-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm text-[var(--terminal-text)]">
            {activeTerminal ? (
              <div>
                {activeTerminal.history.map((command, index) => (
                  <div className="whitespace-pre-wrap" key={`${activeTerminal.id}-${index}`}>
                    <span className="text-[var(--terminal-prompt)]">{prompt} </span>
                    <span>{command}</span>
                  </div>
                ))}

                <div className="flex min-w-0 items-center">
                  <span className="shrink-0 text-[var(--terminal-prompt)]">{prompt}&nbsp;</span>
                  <input
                    aria-label={`${activeTerminal.name} command input`}
                    autoFocus
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-sm text-[var(--terminal-text)] caret-sky-400 outline-none"
                    key={activeTerminal.id}
                    onChange={(event) => onUpdateTerminalInput(activeTerminal.id, event.target.value)}
                    onKeyDown={handle_terminal_key_down}
                    spellCheck={false}
                    value={activeTerminal.input}
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--muted)]">
                No terminal sessions. Use the plus button to create one.
              </div>
            )}
          </div>

          <aside aria-label="Terminal sessions" className="w-44 shrink-0 border-l border-[var(--border)] py-2">
            {terminals.map((terminal) => {
              const is_active = terminal.id === activeTerminalId

              return (
                <div className={`group flex h-7 items-center ${is_active ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'}`} key={terminal.id}>
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
                    className="mr-1 hidden h-6 w-6 items-center justify-center rounded text-xs text-[var(--muted)] hover:bg-[var(--selected)] hover:text-[var(--text)] group-hover:flex"
                    onClick={() => onDeleteTerminal(terminal.id)}
                    title={`Delete ${terminal.name}`}
                    type="button"
                  >
                    🗑
                  </button>
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
