/**
 * Project-run policy facade around the inherited Agent Chat integration.
 * Automatic mode is optimized for long-running autonomous project work: project-scoped
 * permissions, specialist roles, durable runtime state, and progress-based safety controls.
 */
export * from '@/chat/agentChatLegacy'

import { build_core_agent_settings as buildLegacyCoreAgentSettings } from '@/chat/agentChatLegacy'
import type { ProjectRunMode } from '@/chat/projectRunController'
import type { OrbSettings } from '@/platform/settingsStorage'

const automatic_blocked_tools = new Set([
  'approval.request',
  'todo.update',
  'chat.remember',
  'chat.recall',
  'context.summarize',
  'launcher.list',
  'resources.list',
  'trace.log',
])

function autonomous_tool_allowlist(value: unknown, screen_enabled: boolean) {
  if (!Array.isArray(value)) return value
  return value.filter((tool) => {
    const name = String(tool || '')
    if (automatic_blocked_tools.has(name)) return false
    if (!screen_enabled && name === 'screen.capabilities') return false
    return true
  })
}

/** Builds execution settings for the selected project-run mode. */
export function build_core_agent_settings(
  settings: OrbSettings,
  workspace_root: string | null,
  run_mode: ProjectRunMode = 'automatic',
) {
  const base = buildLegacyCoreAgentSettings(settings, workspace_root, run_mode)
  const automatic = run_mode !== 'plan_first'

  if (!automatic) {
    return {
      ...base,
      agent_planning_mode: true,
      agent_require_explicit_approval: true,
    }
  }

  const project_scoped = Boolean(workspace_root)
  const screen_enabled = base.permissions_screen_capture === true
  const configured_repeat_cap = Math.max(2, Number(base.agent_tool_repeat_cap) || 4)

  return {
    ...base,
    permissions_file_read: project_scoped,
    permissions_file_write: project_scoped,
    permissions_terminal: project_scoped,
    agent_permission_tier_orchestrator: 3,
    agent_permission_tier_executor: 3,
    agent_permission_tier_scout: 1,
    agent_permission_tier_overwatcher: 1,
    agent_allow_network_commands: project_scoped || base.agent_allow_network_commands === true,
    agent_require_explicit_approval: false,
    agent_web_site_guard: false,
    search_web_require_paid_fallback_confirmation: false,
    agent_search_web_budget: Math.max(2, Number(base.agent_search_web_budget) || 2),

    // A project run is not a chat-turn timer. Individual model/tool calls remain bounded,
    // but the outer project lifecycle is allowed to continue for hours while it progresses.
    agent_session_minutes: 0,
    agent_bounded_automatic: false,
    agent_tool_repeat_cap: configured_repeat_cap,

    // Restore semantic specialization. Runtime code owns queueing/status/persistence; models
    // own role-level decisions such as investigate, implement, review, and escalate.
    agent_multi_enabled: base.agent_multi_enabled !== false,
    agent_peer_consult_enabled: base.agent_peer_consult_enabled !== false,
    agent_peer_review: base.agent_peer_review || 'suggested',
    agent_model_routing: base.agent_model_routing || 'auto',
    agent_overwatch_continuous: false,

    // Skills remain available through progressive disclosure / role filtering. The agent is
    // not required to maintain skill state manually during ordinary project execution.
    skills_enabled: base.skills_enabled !== false,
    agent_finish_open_todos: false,
    context_budget_warn_ratio: 0.05,
    agent_tool_allowlist: autonomous_tool_allowlist(base.agent_tool_allowlist, screen_enabled),
  }
}

/** Builds the minimal semantic contract for a project run. Runtime policy owns permissions,
 * source control, verification, continuity, and tool availability. */
export function build_project_run_input(goal: string, run_mode: ProjectRunMode, resume = false) {
  const clean_goal = String(goal || '').trim()
  if (resume) {
    return `Resume this project goal from the current files and persisted project ledger. Continue unfinished requirements without redoing completed work.\n\n${clean_goal}`
  }
  if (run_mode === 'plan_first') {
    return `Plan before substantive changes and ask for approval once the plan is ready.\n\nGoal:\n${clean_goal}`
  }
  return clean_goal
}
