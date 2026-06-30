import { useState } from 'react'

function SearchToggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] transition ${active ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function SearchPanel() {
  const [replace_open, set_replace_open] = useState(true)
  const [match_case, set_match_case] = useState(false)
  const [match_word, set_match_word] = useState(false)
  const [use_regex, set_use_regex] = useState(false)
  const [preserve_case, set_preserve_case] = useState(false)

  return (
    <div className="px-3 pb-3">
      <div className="flex items-start gap-1.5">
        <button
          aria-label={replace_open ? 'Hide replace input' : 'Show replace input'}
          aria-expanded={replace_open}
          className="mt-1 flex h-6 w-5 shrink-0 items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
          onClick={() => set_replace_open((current_value) => !current_value)}
          title={replace_open ? 'Hide replace' : 'Show replace'}
          type="button"
        >
          <span className={`text-xs transition-transform ${replace_open ? 'rotate-90' : ''}`}>›</span>
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex h-8 items-center rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 focus-within:border-sky-500">
            <input
              aria-label="Search"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
              placeholder="Search"
              type="text"
            />

            <div className="ml-1 flex items-center gap-0.5">
              <SearchToggle
                active={match_case}
                label="Match case"
                onClick={() => set_match_case((current_value) => !current_value)}
              >
                Aa
              </SearchToggle>
              <SearchToggle
                active={match_word}
                label="Match whole word"
                onClick={() => set_match_word((current_value) => !current_value)}
              >
                ab
              </SearchToggle>
              <SearchToggle
                active={use_regex}
                label="Use regular expression"
                onClick={() => set_use_regex((current_value) => !current_value)}
              >
                .*
              </SearchToggle>
            </div>
          </div>

          {replace_open && (
            <div className="flex h-8 items-center rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 focus-within:border-sky-500">
              <input
                aria-label="Replace"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                placeholder="Replace"
                type="text"
              />

              <SearchToggle
                active={preserve_case}
                label="Preserve case"
                onClick={() => set_preserve_case((current_value) => !current_value)}
              >
                AB
              </SearchToggle>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchPanel
