import { languages } from '@codemirror/language-data'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextEditorDocument } from '../types/editor'

interface LanguagePickerProps {
  document: TextEditorDocument
  onClose: () => void
  onSelect: (document_id: number, language: string) => void
}

interface LanguageOption {
  name: string
  search: string
}

const language_options: LanguageOption[] = [
  { name: 'Plain Text', search: 'plain text txt' },
  ...languages.map((language) => ({
    name: language.name,
    search: [language.name, ...language.alias, ...language.extensions].join(' ').toLowerCase(),
  })),
]

function LanguagePicker({ document, onClose, onSelect }: LanguagePickerProps) {
  const [query, set_query] = useState('')
  const [selected_index, set_selected_index] = useState(0)
  const input_ref = useRef<HTMLInputElement>(null)
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

  return (
    <div
      className="absolute inset-0 z-[280] flex items-start justify-center bg-black/20 px-6 pt-14 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="Select language mode"
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--menu-bg)] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
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
            onSelect(document.id, filtered_languages[selected_index].name)
          }

          if (event.key === 'Escape') {
            onClose()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="p-2">
          <input
            aria-label="Filter languages"
            className="h-9 w-full rounded-md border border-sky-500 bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            onChange={(event) => set_query(event.target.value)}
            placeholder="Select Language Mode"
            ref={input_ref}
            value={query}
          />
        </div>

        <div className="max-h-[min(60vh,460px)] overflow-auto border-t border-[var(--border)] py-1" role="listbox">
          {filtered_languages.map((language, index) => {
            const is_selected = index === selected_index
            const is_active = language.name === document.language

            return (
              <button
                aria-selected={is_active}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs ${is_selected ? 'bg-sky-600 text-white' : 'text-[var(--text)] hover:bg-[var(--hover)]'}`}
                key={language.name}
                onClick={() => onSelect(document.id, language.name)}
                onMouseEnter={() => set_selected_index(index)}
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
      </section>
    </div>
  )
}

export default LanguagePicker
