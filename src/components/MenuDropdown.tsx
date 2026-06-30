import type { ReactNode } from 'react'

interface MenuDropdownProps {
  children: ReactNode
  className?: string
}

interface MenuItemProps {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
  trailing?: ReactNode
}

function MenuDropdown({ children, className = '' }: MenuDropdownProps) {
  return (
    <div
      className={`absolute top-full z-[220] min-w-52 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-1 shadow-2xl ${className}`}
    >
      {children}
    </div>
  )
}

function MenuItem({ children, disabled = false, onClick, trailing }: MenuItemProps) {
  return (
    <button
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)] disabled:text-[var(--muted)] disabled:opacity-45 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      {trailing && <span className="text-[var(--muted)]">{trailing}</span>}
    </button>
  )
}

function MenuSeparator() {
  return <div className="my-1 border-t border-[var(--border)]" />
}

export { MenuDropdown, MenuItem, MenuSeparator }
