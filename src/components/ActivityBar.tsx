import type { ActivitySection } from '../types/editor'

interface ActivityBarProps {
  activeSection: ActivitySection
  settingsOpen: boolean
  onSelectSection: (section: ActivitySection) => void
  onToggleSettings: () => void
}

const activity_items: Array<{ id: ActivitySection, icon: string, label: string }> = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'search', icon: '🔍', label: 'Search' },
  { id: 'source-control', icon: '⑂', label: 'Source Control' },
]

function ActivityBar({ activeSection, settingsOpen, onSelectSection, onToggleSettings }: ActivityBarProps) {
  return (
    <aside aria-label="Activity bar" className="relative z-40 flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface-1)]">
      <div>
        {activity_items.map((activity_item) => {
          const is_active = activity_item.id === activeSection

          return (
            <button
              aria-label={activity_item.label}
              className={`relative flex h-12 w-full items-center justify-center text-lg transition hover:bg-[var(--hover)] ${is_active ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}
              key={activity_item.id}
              onClick={() => onSelectSection(activity_item.id)}
              title={activity_item.label}
              type="button"
            >
              {is_active && <span className="absolute left-0 h-8 w-0.5 bg-sky-500" />}
              <span aria-hidden="true">{activity_item.icon}</span>
            </button>
          )
        })}
      </div>

      <div className="relative mt-auto">
        <button
          aria-expanded={settingsOpen}
          aria-label="Settings"
          className="flex h-12 w-full items-center justify-center text-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={onToggleSettings}
          title="Settings"
          type="button"
        >
          <span aria-hidden="true">⚙</span>
        </button>

        {settingsOpen && (
          <div
            aria-label="Settings menu"
            className="absolute bottom-2 left-[calc(100%+8px)] h-28 w-48 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] shadow-2xl"
            role="menu"
          />
        )}
      </div>
    </aside>
  )
}

export default ActivityBar
