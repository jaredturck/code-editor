import type { PointerEvent as ReactPointerEvent } from 'react'
import SearchPanel from './SearchPanel'
import type { ActivitySection } from '../types/editor'

interface ExplorerPanelProps {
  activeSection: ActivitySection
  onResize: (event: ReactPointerEvent<HTMLElement>) => void
}

const panel_titles: Record<ActivitySection, string> = {
  explorer: 'EXPLORER',
  search: 'SEARCH',
  'source-control': 'SOURCE CONTROL',
}

function ExplorerPanel({ activeSection, onResize }: ExplorerPanelProps) {
  return (
    <aside
      aria-label={`${panel_titles[activeSection]} panel`}
      className="relative z-10 min-h-0 border-r border-[var(--border)] bg-[var(--surface-2)]"
    >
      <div className="flex h-10 items-center px-4 text-[11px] font-medium tracking-wide text-[var(--muted)]">
        {panel_titles[activeSection]}
      </div>

      {activeSection === 'search' && <SearchPanel />}

      <div
        aria-label="Resize side panel"
        aria-orientation="vertical"
        className="absolute inset-y-0 right-0 z-30 w-1 translate-x-1/2 cursor-col-resize hover:bg-sky-500/70"
        onPointerDown={onResize}
        role="separator"
      />
    </aside>
  )
}

export default ExplorerPanel
