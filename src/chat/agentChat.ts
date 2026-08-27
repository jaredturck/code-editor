/**
 * Small project-run policy facade around the inherited Agent Chat integration.
 *
 * The established chat/runtime adapter remains in agentChatLegacy.ts. This layer owns the
 * current autonomous-mode policy and project guidance without reopening the large legacy file.
 */
export * from '@/chat/agentChatLegacy'

import { build_core_agent_settings as buildLegacyCoreAgentSettings } from '@/chat/agentChatLegacy'
import type { ProjectRunMode } from '@/chat/projectRunController'
import type { OrbSettings } from '@/platform/settingsStorage'

function autonomous_tool_allowlist(value: unknown, screen_enabled: boolean) {
  if (!Array.isArray(value)) return value
  return value.filter((tool) => screen_enabled || String(tool) !== 'screen.capabilities')
}

function automatic_agent_models(value: unknown) {
  if (!Array.isArray(value)) return value
  return value.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true
    return String((entry as Record<string, unknown>).role || '').toLowerCase() !== 'overwatcher'
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

  return {
    ...base,
    permissions_file_read: project_scoped,
    permissions_file_write: project_scoped,
    permissions_terminal: project_scoped,
    agent_permission_tier_orchestrator: 3,
    agent_permission_tier_executor: 3,
    agent_allow_network_commands: project_scoped || base.agent_allow_network_commands === true,
    agent_require_explicit_approval: false,
    agent_web_site_guard: false,
    search_web_require_paid_fallback_confirmation: false,
    agent_search_web_budget: 4,
    agent_models: automatic_agent_models(base.agent_models),
    agent_overwatch_continuous: false,
    agent_tool_allowlist: autonomous_tool_allowlist(base.agent_tool_allowlist, screen_enabled),
  }
}

/** Builds the minimal semantic contract for a project run. Runtime policy owns permissions,
 * source control, verification, continuity, and tool availability. */
export function build_project_run_input(goal: string, run_mode: ProjectRunMode, resume = false) {
  const clean_goal = String(goal || '').trim()
  if (resume) {
    return `Resume this project goal from the current files and persisted run state. Do not redo completed work.\n\n${clean_goal}`
  }
  if (run_mode === 'plan_first') {
    return `Plan before substantive changes and ask for approval once the plan is ready.\n\nGoal:\n${clean_goal}`
  }
  return clean_goal
}
