import { useEffect, useRef, useState } from 'react'
import type { IndentStyle, TextEditorDocument } from '../types/editor'

interface IndentationPickerProps {
  document: TextEditorDocument
  onClose: () => void
  onSelect: (document_id: number, indent_style: IndentStyle, indent_size: number) => void
}

const indentation_options: Array<{
  label: string
  style: IndentStyle
  size: number
}> = [
  { label: 'Spaces: 1', style: 'spaces', size: 1 },
  { label: 'Spaces: 2', style: 'spaces', size: 2 },
  { label: 'Spaces: 4', style: 'spaces', size: 4 },
  { label: 'Spaces: 8', style: 'spaces', size: 8 },
  { label: 'Tabs: 2', style: 'tabs', size: 2 },
  { label: 'Tabs: 4', style: 'tabs', size: 4 },
  { label: 'Tabs: 8', style: 'tabs', size: 8 },
]

function IndentationPicker({ document, onClose, onSelect }: IndentationPickerProps) {
  const initial_index = Math.max(
    0,
    indentation_options.findIndex(
      (option) => option.style === document.indent_style && option.size === document.indent_size,
    ),
  )
  const [selected_index, set_selected_index] = useState(initial_index)
  const picker_ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    picker_ref.current?.focus()
  }, [])

  return (
    <div className="absolute inset-0 z-[280]" onMouseDown={onClose} role="presentation">
      <div
        className="absolute bottom-7 right-3 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--menu-bg)] py-1 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            set_selected_index((current_index) => (current_index + 1) % indentation_options.length)
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault()
            set_selected_index(
              (current_index) => (current_index - 1 + indentation_options.length) % indentation_options.length,
            )
          }

          if (event.key === 'Enter') {
            event.preventDefault()
            const option = indentation_options[selected_index]
            onSelect(document.id, option.style, option.size)
          }

          if (event.key === 'Escape') {
            onClose()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        ref={picker_ref}
        role="listbox"
        tabIndex={-1}
      >
        {indentation_options.map((option, index) => {
          const is_selected = index === selected_index
          const is_active = option.style === document.indent_style && option.size === document.indent_size

          return (
            <button
              aria-selected={is_active}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs ${is_selected ? 'bg-sky-600 text-white' : 'text-[var(--text)] hover:bg-[var(--hover)]'}`}
              key={option.label}
              onClick={() => onSelect(document.id, option.style, option.size)}
              onMouseEnter={() => set_selected_index(index)}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {is_active && <span>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default IndentationPicker
