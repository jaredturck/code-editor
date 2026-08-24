interface WorkspaceDeleteModalProps {
  hasDirectories: boolean
  paths: string[]
  rootPath: string
  onCancel: () => void
  onConfirm: () => void
}

function get_relative_path(root_path: string, target_path: string) {
  const normalized_root = root_path.replace(/\\/g, '/').replace(/\/$/, '')
  const normalized_target = target_path.replace(/\\/g, '/')
  return normalized_target.slice(normalized_root.length).replace(/^\//, '') || normalized_target
}

function WorkspaceDeleteModal({ hasDirectories, paths, rootPath, onCancel, onConfirm }: WorkspaceDeleteModalProps) {
  const show_paths = paths.length <= 10

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <section className="w-[min(520px,calc(100vw-32px))] rounded-xl border border-[var(--window-border)] bg-gradient-to-b from-[var(--modal-start)] to-[var(--modal-end)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-[var(--text)]">Move selected items to Trash?</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {paths.length === 1
            ? 'The selected item will be moved to Trash.'
            : `${paths.length} selected items will be moved to Trash.`}
        </p>
        {hasDirectories && (
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Folders include everything inside them.</p>
        )}

        {show_paths && (
          <div className="mt-3 max-h-48 overflow-auto rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
            {paths.map((target_path) => (
              <div className="truncate py-0.5 text-xs text-[var(--text)]" key={target_path} title={target_path}>
                {get_relative_path(rootPath, target_path)}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-red-600 px-3 py-2 text-xs text-white hover:bg-red-500"
            onClick={onConfirm}
            type="button"
          >
            Move to Trash
          </button>
        </div>
      </section>
    </div>
  )
}

export default WorkspaceDeleteModal
