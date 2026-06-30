import LanguageSelector from './LanguageSelector'

interface LanguagePickerProps {
  activeLanguage: string
  onClose: () => void
  onSelect: (language: string) => void
}

function LanguagePicker({ activeLanguage, onClose, onSelect }: LanguagePickerProps) {
  return (
    <div
      className="absolute inset-0 z-[280] flex items-start justify-center bg-black/20 px-6 pt-14 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="Select language mode"
        className="flex h-[min(64vh,520px)] min-h-80 w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--menu-bg)] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <LanguageSelector activeLanguage={activeLanguage} onClose={onClose} onSelect={onSelect} />
      </section>
    </div>
  )
}

export default LanguagePicker
