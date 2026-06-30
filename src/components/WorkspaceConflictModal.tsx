interface WorkspaceConflictModalProps {
  destinationPath: string
  onCancel: () => void
  onKeepBoth: () => void
  onReplace: () => void
}

function WorkspaceConflictModal({ destinationPath, onCancel, onKeepBoth, onReplace }: WorkspaceConflictModalProps) {
  const name = destinationPath.split(/[\\/]/).pop() ?? destinationPath

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <section className="w-[min(440px,calc(100vw-32px))] rounded-xl border border-[var(--window-border)] bg-gradient-to-b from-[var(--modal-start)] to-[var(--modal-end)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-[var(--text)]">A file already exists</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          <span className="font-medium text-[var(--text)]">{name}</span> already exists in this folder. Choose how to
          continue.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--hover)]"
            onClick={onKeepBoth}
            type="button"
          >
            Keep Both
          </button>
          <button
            className="rounded-md bg-sky-600 px-3 py-2 text-xs text-white hover:bg-sky-500"
            onClick={onReplace}
            type="button"
          >
            Replace
          </button>
        </div>
      </section>
    </div>
  )
}

export default WorkspaceConflictModal
