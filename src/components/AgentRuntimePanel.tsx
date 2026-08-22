import { useEffect, useState } from 'react'
import { handleAgentRoster } from '../platform/orchestrationClient'
import { getRoutingProfile } from '../platform/agent/modelRouting'
import type { SubAgentRosterEntry } from '../platform/agent/subAgentTypes'
import type { AgentUsageSummary } from '../types/editor'
import { useSystemMonitor } from '../platform-features/systemMonitor/useSystemMonitor'

interface AgentRuntimePanelProps {
  generating: boolean
  provider: string
  model: string
  usage?: AgentUsageSummary | null
}

function format_bytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function format_tokens(tokens: number) {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(Math.round(tokens))
}

function format_vram(megabytes: number) {
  if (!Number.isFinite(megabytes) || megabytes <= 0) return '—'
  return `${(megabytes / 1024).toFixed(1)} GB`
}

function agent_status_label(agent: SubAgentRosterEntry) {
  const role = String(agent.role || agent.id).split('#')[0]
  return `${role} · ${agent.status}${agent.queueDepth ? ` · ${agent.queueDepth} queued` : ''}`
}

function AgentRuntimePanel({ generating, provider, model, usage }: AgentRuntimePanelProps) {
  const { stats, procs, err } = useSystemMonitor()
  const [agents, set_agents] = useState<SubAgentRosterEntry[]>([])

  useEffect(() => {
    const poll = () => {
      try {
        const roster = handleAgentRoster()
        set_agents(Array.isArray(roster.agents) ? roster.agents : [])
      } catch {
        set_agents([])
      }
    }

    poll()
    const timer = window.setInterval(poll, 2000)
    return () => window.clearInterval(timer)
  }, [])

  const usage_provider = usage?.provider || provider
  const usage_model = usage?.model || model
  const cost_tier = getRoutingProfile(usage_provider, usage_model).costTier
  const active_agents = agents.filter(
    (agent) => agent.status === 'working' || Boolean(agent.currentTaskId),
  ).length
  const queued_work = agents.reduce((total, agent) => total + Math.max(0, Number(agent.queueDepth) || 0), 0)

  return (
    <details className="shrink-0 border-b border-[var(--border)] bg-black/[0.03] px-3 py-2 text-[9px] text-[var(--muted)]">
      <summary className="flex cursor-pointer select-none items-center gap-2">
        <span className="font-medium text-[var(--text)]">Runtime</span>
        <span>{stats ? `CPU ${Math.round(stats.cpuPercent)}%` : 'CPU —'}</span>
        <span>·</span>
        <span>{stats ? `RAM ${Math.round(stats.memPercent)}%` : 'RAM —'}</span>
        {stats?.gpuMemoryTotalMb ? (
          <>
            <span>·</span>
            <span>GPU {format_vram(stats.gpuMemoryTotalMb)}</span>
          </>
        ) : null}
        <span>·</span>
        <span>{active_agents || (generating ? 1 : 0)} active</span>
        {queued_work > 0 && <span>· {queued_work} queued</span>}
        {usage?.totalTokens ? <span>· {format_tokens(usage.totalTokens)} tokens</span> : null}
      </summary>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <span>Memory</span>
        <span className="text-right text-[var(--text)]">
          {stats ? `${format_bytes(stats.memUsed)} / ${format_bytes(stats.memTotal)}` : '—'}
        </span>
        <span>Load</span>
        <span className="text-right text-[var(--text)]">
          {stats?.loadavg?.length ? stats.loadavg.slice(0, 3).map((value) => value.toFixed(2)).join(' · ') : '—'}
        </span>
        <span>Agents</span>
        <span className="text-right text-[var(--text)]">{agents.length || (generating ? 1 : 0)}</span>
        <span>Model cost tier</span>
        <span className="text-right capitalize text-[var(--text)]">{cost_tier}</span>
      </div>

      {usage && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[var(--border)] pt-2">
          <span>Model requests</span>
          <span className="text-right text-[var(--text)]">{usage.requests}</span>
          <span>Tokens</span>
          <span className="text-right text-[var(--text)]">
            {format_tokens(usage.promptTokens)} in · {format_tokens(usage.completionTokens)} out
          </span>
          <span>Context</span>
          <span className="text-right text-[var(--text)]">
            {usage.contextWindow ? `${usage.contextUsedPct.toFixed(1)}% · ${format_tokens(usage.contextRemaining)} left` : '—'}
          </span>
          <span>Prompt cache</span>
          <span className="text-right text-[var(--text)]">{Math.round(usage.cacheHitRatio * 100)}% hit</span>
        </div>
      )}

      {stats?.gpuDevices?.length ? (
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
          {stats.gpuDevices.map((gpu, index) => (
            <div className="flex gap-2" key={`${gpu.name}-${index}`}>
              <span className="min-w-0 flex-1 truncate text-[var(--text)]">{gpu.name}</span>
              <span>{format_vram(gpu.memoryTotalMb)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {agents.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
          {agents.map((agent) => (
            <div className="flex gap-2" key={agent.id}>
              <span className="min-w-0 flex-1 truncate text-[var(--text)]">{agent_status_label(agent)}</span>
              <span>{Math.round((agent.health?.successRate || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {procs.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <div className="mb-1 font-medium text-[var(--text)]">Top processes</div>
          {procs.slice(0, 5).map((process) => (
            <div className="flex gap-2" key={process.pid}>
              <span className="min-w-0 flex-1 truncate">{process.command}</span>
              <span>{process.cpu.toFixed(1)}% CPU</span>
              <span>{process.mem.toFixed(1)}% RAM</span>
            </div>
          ))}
        </div>
      )}

      {err && <div className="mt-2 text-amber-300">{err}</div>}
    </details>
  )
}

export default AgentRuntimePanel
