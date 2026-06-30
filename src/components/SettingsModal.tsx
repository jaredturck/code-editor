interface SettingsModalProps {
  onClose: () => void
}

function SettingsModal({ onClose }: SettingsModalProps) {
  return (
    <div
      aria-label="Settings dialog backdrop"
      className="absolute inset-0 z-[300] flex items-center justify-center bg-black/45 px-6 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="relative w-full max-w-lg rounded-xl border border-white/10 bg-gradient-to-br from-[var(--modal-start)] to-[var(--modal-end)] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="Close settings"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-white/10 hover:text-[var(--text)]"
          onClick={onClose}
          title="Close settings"
          type="button"
        >
          ×
        </button>

        <h2 className="pr-10 text-xl font-semibold text-[var(--text)]" id="settings-title">
          Settings
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Application Settings</p>

        <div className="mt-8 h-32 rounded-lg border border-dashed border-[var(--border)] bg-black/5" />
      </section>
    </div>
  )
}

export default SettingsModal
