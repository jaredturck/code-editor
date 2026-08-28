import MarkdownView from './MarkdownView'
import type { AgentActivityItem } from '../types/editor'

interface AgentReasoningPanelProps {
  activity: AgentActivityItem[]
}

function AgentReasoningPanel({ activity }: AgentReasoningPanelProps) {
  const planning = activity.filter((item) => item.type === 'planning')
  if (!planning.length) return null

  return (
    <details className="mb-2 rounded-lg border border-[var(--border)] bg-black/[0.05] px-2 py-1.5">
      <summary className="cursor-pointer select-none text-[9px] font-medium text-[var(--muted)]">
        Reasoning · {planning.length} stage{planning.length === 1 ? '' : 's'}
      </summary>
      <div className="mt-2 space-y-2">
        {planning.map((item) => (
          <section className="rounded-md border border-[var(--border)] bg-black/[0.04] px-2 py-1.5" key={item.id}>
            <div className="mb-1 text-[9px] font-medium text-[var(--text)]">{item.label}</div>
            <div className="text-[10px] leading-relaxed text-[var(--muted)]">
              <MarkdownView baseFilePath={null} content={item.detail} />
            </div>
          </section>
        ))}
      </div>
    </details>
  )
}

export default AgentReasoningPanel
