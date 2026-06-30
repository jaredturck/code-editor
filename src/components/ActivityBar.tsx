import Icon from './Icon'
import browser_icon from './images/browser.svg'
import explorer_icon from './images/explorer.svg'
import search_icon from './images/search.svg'
import settings_icon from './images/settings.svg'
import source_control_icon from './images/source-control.svg'
import type { ActivitySection } from '../types/editor'

interface ActivityBarProps {
  activeSection: ActivitySection
  settingsOpen: boolean
  onOpenBrowser: () => void
  onSelectSection: (section: ActivitySection) => void
  onToggleSettings: () => void
}

const activity_items: Array<{
  id: ActivitySection
  icon: string
  label: string
}> = [
  { id: 'explorer', icon: explorer_icon, label: 'Explorer' },
  { id: 'search', icon: search_icon, label: 'Search' },
  { id: 'source-control', icon: source_control_icon, label: 'Source Control' },
]

function ActivityBar({
  activeSection,
  settingsOpen,
  onOpenBrowser,
  onSelectSection,
  onToggleSettings,
}: ActivityBarProps) {
  return (
    <aside
      aria-label="Activity bar"
      className="relative z-20 flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface-1)]"
    >
      <div>
        {activity_items.map((activity_item) => {
          const is_active = activity_item.id === activeSection

          return (
            <button
              aria-label={activity_item.label}
              className={`group relative flex h-12 w-full items-center justify-center transition hover:bg-[var(--hover)] ${is_active ? 'bg-[var(--hover)]' : ''}`}
              key={activity_item.id}
              onClick={() => onSelectSection(activity_item.id)}
              title={activity_item.label}
              type="button"
            >
              {is_active && <span className="absolute left-0 h-8 w-0.5 bg-sky-500" />}
              <Icon
                className={`h-5 w-5 transition-opacity group-hover:opacity-100 ${is_active ? 'opacity-100' : 'opacity-60'}`}
                src={activity_item.icon}
              />
            </button>
          )
        })}

        <button
          aria-label="Browser"
          className="group relative flex h-12 w-full items-center justify-center transition hover:bg-[var(--hover)]"
          onClick={onOpenBrowser}
          title="Browser"
          type="button"
        >
          <Icon className="h-5 w-5 opacity-60 transition-opacity group-hover:opacity-100" src={browser_icon} />
        </button>
      </div>

      <div className="mt-auto">
        <button
          aria-expanded={settingsOpen}
          aria-label="Settings"
          className={`group flex h-12 w-full items-center justify-center transition hover:bg-[var(--hover)] ${settingsOpen ? 'bg-[var(--hover)]' : ''}`}
          onClick={onToggleSettings}
          title="Settings"
          type="button"
        >
          <Icon
            className={`h-[22px] w-[22px] transition-opacity group-hover:opacity-100 ${settingsOpen ? 'opacity-100' : 'opacity-65'}`}
            src={settings_icon}
          />
        </button>
      </div>
    </aside>
  )
}

export default ActivityBar
