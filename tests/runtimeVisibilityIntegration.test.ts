import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  get_core_agent_tool_allowlist,
  normalize_agent_activity_event,
} from '../src/chat/agentChat'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('runtime visibility and local-system integration', () => {
  it('exposes read-only system/tool discovery without granting local execution', () => {
    const read_only = get_core_agent_tool_allowlist('/workspace', false, false)
    expect(read_only).toContain('system.stats')
    expect(read_only).toContain('system.processes')
    expect(read_only).toContain('launcher.list')
    expect(read_only).not.toContain('launch.run')

    const executable = get_core_agent_tool_allowlist('/workspace', true, false)
    expect(executable).toContain('launch.run')
    expect(executable).toContain('terminal.exec')
  })

  it('keeps the runtime monitor bounded to telemetry and durable run state', () => {
    const monitor = source('src/components/AgentRuntimePanel.tsx')
    const run_controller = source('src/chat/projectRunController.ts')

    expect(monitor).toContain('useSystemMonitor()')
    expect(monitor).toContain('handleAgentRoster()')
    expect(monitor).toContain('projectRunController.subscribe(set_project_run)')
    expect(monitor).toContain('getRoutingProfile(usage_provider, usage_model).costTier')
    expect(monitor).toContain('usage.contextUsedPct')
    expect(monitor).toContain('usage.cacheHitRatio')

    expect(run_controller).toContain('usage: AgentUsageSummary | null')
    expect(run_controller).toContain('normalize_project_run_usage')
    expect(run_controller).toContain('state.usage = normalize_project_run_usage(summary?.usage)')
  })

  it('does not surface raw reasoning events in Agent Chat activity', () => {
    expect(normalize_agent_activity_event({ type: 'thinking', text: 'private reasoning' })).toBeNull()
    expect(normalize_agent_activity_event({ type: 'thinking_stream', text: 'private reasoning' })).toBeNull()
    expect(normalize_agent_activity_event({ type: 'stream', text: 'raw token stream' })).toBeNull()
  })
})
