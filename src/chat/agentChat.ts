/**
 * Small project-run policy facade around the inherited Agent Chat integration.
 *
 * The established chat/runtime adapter remains in agentChatLegacy.ts. This layer owns the
 * current autonomous-mode policy and project guidance without reopening the large legacy file.
 */
export * from '@/chat/agentChatLegacy'

import {
  build_core_agent_settings as buildLegacyCoreAgentSettings,
  build_project_run_input as buildLegacyProjectRunInput,
} from '@/chat/agentChatLegacy'
import type { ProjectRunMode } from '@/chat/projectRunController'
import type { OrbSettings } from '@/platform/settingsStorage'

const legacyBrowserGuidance = `RUNTIME VERIFICATION: Compilation, a successful dev-server start, or an HTTP 200 is not proof that a browser application works. When the task creates or changes a browser application, start it and use browser.inspect on its local loopback URL. Treat JavaScript console errors, failed page loads/resources, blocked runtime dependencies, an unexpectedly blank DOM, or missing expected rendered content as evidence to diagnose and fix. Re-run browser.inspect after fixes before declaring the browser application complete. Use Playwright or the project's own E2E framework when repeatable interaction testing is warranted; do not install it merely to replace the built-in local runtime smoke inspection.`
const developmentGuidance = `DEVELOPMENT JUDGMENT: Use the progressive skills system for project-specific engineering practice rather than assuming a framework, language workflow, test runner, environment, or verification method from the request alone. Inspect the actual project, load relevant development/environment/runtime-verification skills when useful, and choose the checks that best prove the requested outcome. The model owns those semantic choices; deterministic host policy only validates safety and real evidence.`
const automaticAuthorityGuidance = `AUTOMATIC MODE AUTHORITY: Work autonomously. Do not ask the user to approve routine project-scoped development work. Read and edit project files, create or remove project files when needed, run normal build/test/dev/package-manager commands, install project dependencies, and use web research directly. The runtime will block inherently dangerous commands and will surface a short-lived approval only when an action crosses the open-project boundary or another privileged safety boundary. If that approval is denied or times out, continue with a project-scoped alternative instead of waiting for the user. Screen capture and mouse/desktop control are never implied by Automatic mode; use them only when already explicitly enabled.`

function autonomous_tool_allowlist(value: unknown, screen_enabled: boolean) {
  if (!Array.isArray(value)) return value
  return value.filter((tool) => screen_enabled || String(tool) !== 'screen.capabilities')
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
    agent_tool_allowlist: autonomous_tool_allowlist(base.agent_tool_allowlist, screen_enabled),
  }
}

/** Builds project-run guidance while leaving semantic development decisions to the model. */
export function build_project_run_input(goal: string, run_mode: ProjectRunMode, resume = false) {
  const prompt = buildLegacyProjectRunInput(goal, run_mode, resume).replace(legacyBrowserGuidance, developmentGuidance)
  if (run_mode === 'plan_first') return prompt
  return `${prompt}\n\n${automaticAuthorityGuidance}`
}
