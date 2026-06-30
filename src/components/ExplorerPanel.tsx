import type { ActivitySection } from '../types/editor'

interface ExplorerPanelProps {
  activeSection: ActivitySection
}

const panel_titles: Record<ActivitySection, string> = {
  explorer: 'EXPLORER',
  search: 'SEARCH',
  'source-control': 'SOURCE CONTROL',
}

function ExplorerPanel({ activeSection }: ExplorerPanelProps) {
  return (
    <aside
      aria-label={`${panel_titles[activeSection]} panel`}
      className="min-h-0 border-r border-[var(--border)] bg-[var(--surface-2)]"
    >
      <div className="flex h-10 items-center px-4 text-[11px] text-[var(--muted)]">
        {panel_titles[activeSection]}
      </div>
    </aside>
  )
}

export default ExplorerPanel
