interface NoticeToastProps {
  message: string
  onClose: () => void
}

function NoticeToast({ message, onClose }: NoticeToastProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-9 z-[340] flex justify-center px-6">
      <div className="pointer-events-auto flex max-w-xl items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--menu-bg)] px-4 py-3 text-xs text-[var(--text)] shadow-2xl">
        <span className="min-w-0 flex-1">{message}</span>
        <button
          aria-label="Dismiss message"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default NoticeToast
