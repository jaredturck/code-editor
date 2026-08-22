/**
 * Small project-run guidance facade around the inherited Agent Chat integration.
 *
 * The established chat/runtime adapter remains byte-for-byte in agentChatLegacy.ts. This
 * layer changes only autonomous project guidance so software-engineering judgement stays
 * progressive/model-owned rather than being inferred from framework or language names.
 */
export * from '@/chat/agentChatLegacy'

import { build_project_run_input as buildLegacyProjectRunInput } from '@/chat/agentChatLegacy'
import type { ProjectRunMode } from '@/chat/projectRunController'

const legacyBrowserGuidance = `RUNTIME VERIFICATION: Compilation, a successful dev-server start, or an HTTP 200 is not proof that a browser application works. When the task creates or changes a browser application, start it and use browser.inspect on its local loopback URL. Treat JavaScript console errors, failed page loads/resources, blocked runtime dependencies, an unexpectedly blank DOM, or missing expected rendered content as evidence to diagnose and fix. Re-run browser.inspect after fixes before declaring the browser application complete. Use Playwright or the project's own E2E framework when repeatable interaction testing is warranted; do not install it merely to replace the built-in local runtime smoke inspection.`
const developmentGuidance = `DEVELOPMENT JUDGMENT: Use the progressive skills system for project-specific engineering practice rather than assuming a framework, language workflow, test runner, environment, or verification method from the request alone. Inspect the actual project, load relevant development/environment/runtime-verification skills when useful, and choose the checks that best prove the requested outcome. The model owns those semantic choices; deterministic host policy only validates safety and real evidence.`

/** Builds project-run guidance while leaving semantic development decisions to the model. */
export function build_project_run_input(goal: string, run_mode: ProjectRunMode, resume = false) {
  return buildLegacyProjectRunInput(goal, run_mode, resume).replace(
    legacyBrowserGuidance,
    developmentGuidance,
  )
}
