import Icon from './Icon'
import source_control_icon from './images/source-control.svg'
import type { ActivitySection } from '../types/editor'

interface ActivityBarProps {
  activeSection: ActivitySection
  settingsOpen: boolean
  onSelectSection: (section: ActivitySection) => void
  onToggleSettings: () => void
}

const activity_items: Array<{ id: ActivitySection, icon: string, label: string, svg?: string }> = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'search', icon: '⌕', label: 'Search' },
  { id: 'source-control', icon: '', label: 'Source Control', svg: source_control_icon },
]

function ActivityBar({ activeSection, settingsOpen, onSelectSection, onToggleSettings }: ActivityBarProps) {
  return (
    <aside aria-label="Activity bar" className="relative z-20 flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface-1)]">
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
              {activity_item.svg ? (
                <Icon className="h-5 w-5" src={activity_item.svg} />
              ) : (
                <span aria-hidden="true">{activity_item.icon}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-auto">
        <button
          aria-expanded={settingsOpen}
          aria-label="Settings"
          className={`flex h-12 w-full items-center justify-center text-lg transition hover:bg-[var(--hover)] hover:text-[var(--text)] ${settingsOpen ? 'bg-[var(--hover)] text-[var(--text)]' : 'text-[var(--muted)]'}`}
          onClick={onToggleSettings}
          title="Settings"
          type="button"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
    </aside>
  )
}

export default ActivityBar
