import type { TextEditorDocument } from '../types/editor'

interface SaveChangesModalProps {
  document: TextEditorDocument
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}

function SaveChangesModal({ document, onCancel, onDiscard, onSave }: SaveChangesModalProps) {
  return (
    <div
      aria-label="Unsaved changes dialog backdrop"
      className="absolute inset-0 z-[310] flex items-center justify-center bg-black/50 px-6 backdrop-blur-[2px]"
      onMouseDown={onCancel}
      role="presentation"
    >
      <section
        aria-labelledby="save-changes-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border border-white/10 bg-gradient-to-br from-[var(--modal-start)] to-[var(--modal-end)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="text-lg font-semibold text-[var(--text)]" id="save-changes-title">
          Save changes?
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Would you like to save the changes made to{' '}
          <span className="font-medium text-[var(--text)]">{document.name}</span>?
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">Unsaved changes will be lost if you close this file.</p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-md border border-[var(--border)] px-4 py-2 text-xs text-[var(--text)] hover:bg-[var(--hover)]"
            onClick={onDiscard}
            type="button"
          >
            Don&apos;t Save
          </button>
          <button
            className="rounded-md border border-[var(--border)] px-4 py-2 text-xs text-[var(--text)] hover:bg-[var(--hover)]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            onClick={onSave}
            type="button"
          >
            Save
          </button>
        </div>
      </section>
    </div>
  )
}

export default SaveChangesModal
