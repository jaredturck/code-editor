import { useEffect, useMemo, useRef, useState } from 'react'
import { language_options } from '../data/languages'

interface LanguageSelectorProps {
  activeLanguage?: string
  onBack?: () => void
  onClose: () => void
  onSelect: (language: string) => void
  placeholder?: string
}

function LanguageSelector({
  activeLanguage,
  onBack,
  onClose,
  onSelect,
  placeholder = 'Select Language Mode',
}: LanguageSelectorProps) {
  const [query, set_query] = useState('')
  const [selected_index, set_selected_index] = useState(0)
  const input_ref = useRef<HTMLInputElement>(null)
  const selected_button_ref = useRef<HTMLButtonElement>(null)
  const filtered_languages = useMemo(() => {
    const normalized_query = query.trim().toLowerCase()

    if (!normalized_query) {
      return language_options
    }

    return language_options.filter((language) => language.search.includes(normalized_query))
  }, [query])

  useEffect(() => {
    input_ref.current?.focus()
  }, [])

  useEffect(() => {
    set_selected_index(0)
  }, [query])

  useEffect(() => {
    selected_button_ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected_index])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && filtered_languages.length > 0) {
          event.preventDefault()
          set_selected_index((current_index) => (current_index + 1) % filtered_languages.length)
        }

        if (event.key === 'ArrowUp' && filtered_languages.length > 0) {
          event.preventDefault()
          set_selected_index(
            (current_index) => (current_index - 1 + filtered_languages.length) % filtered_languages.length,
          )
        }

        if (event.key === 'Enter' && filtered_languages[selected_index]) {
          event.preventDefault()
          onSelect(filtered_languages[selected_index].name)
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-2 p-2">
        {onBack && (
          <button
            aria-label="Back to featured languages"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onBack}
            title="Back"
            type="button"
          >
            ‹
          </button>
        )}

        <input
          aria-label="Filter languages"
          className="h-9 min-w-0 flex-1 rounded-md border border-sky-500 bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
          onChange={(event) => set_query(event.target.value)}
          placeholder={placeholder}
          ref={input_ref}
          value={query}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-[var(--border)] py-1" role="listbox">
        {filtered_languages.map((language, index) => {
          const is_selected = index === selected_index
          const is_active = language.name === activeLanguage

          return (
            <button
              aria-selected={is_active}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs ${is_selected ? 'bg-sky-600 text-white' : 'text-[var(--text)] hover:bg-[var(--hover)]'}`}
              key={language.name}
              onClick={() => onSelect(language.name)}
              onMouseEnter={() => set_selected_index(index)}
              ref={is_selected ? selected_button_ref : undefined}
              role="option"
              type="button"
            >
              <span>{language.name}</span>
              {is_active && <span>✓</span>}
            </button>
          )
        })}

        {filtered_languages.length === 0 && (
          <div className="px-4 py-5 text-center text-xs text-[var(--muted)]">No matching languages</div>
        )}
      </div>
    </div>
  )
}

export default LanguageSelector
