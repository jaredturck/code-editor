import { useEffect, useRef, useState } from 'react'

interface ExplorerInlineInputProps {
  initialValue: string
  selectBaseName?: boolean
  onCancel: () => void
  onConfirm: (value: string) => Promise<boolean>
}

function ExplorerInlineInput({ initialValue, selectBaseName = false, onCancel, onConfirm }: ExplorerInlineInputProps) {
  const [value, set_value] = useState(initialValue)
  const [submitting, set_submitting] = useState(false)
  const input_ref = useRef<HTMLInputElement>(null)
  const submitting_ref = useRef(false)

  useEffect(() => {
    const input = input_ref.current

    if (!input) {
      return
    }

    input.focus()

    if (selectBaseName) {
      const extension_index = value.lastIndexOf('.')
      input.setSelectionRange(0, extension_index > 0 ? extension_index : value.length)
    } else {
      input.select()
    }
  }, [])

  const submit = async () => {
    if (submitting_ref.current) {
      return
    }

    submitting_ref.current = true
    set_submitting(true)
    const succeeded = await onConfirm(value)
    submitting_ref.current = false
    set_submitting(false)

    if (!succeeded) {
      input_ref.current?.focus()
      input_ref.current?.select()
    }
  }

  return (
    <input
      aria-label="File or folder name"
      className="h-6 min-w-0 flex-1 rounded border border-sky-500 bg-[var(--input-bg)] px-1.5 text-xs text-[var(--text)] outline-none"
      disabled={submitting}
      onBlur={() => {
        if (!value.trim()) {
          onCancel()
        } else {
          void submit()
        }
      }}
      onChange={(event) => set_value(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void submit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      ref={input_ref}
      value={value}
    />
  )
}

export default ExplorerInlineInput
