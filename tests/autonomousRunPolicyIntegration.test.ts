import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_IRIS_SETTINGS } from '../src/platform/settingsStorage'
import {
  get_core_agent_tool_allowlist,
  should_block_core_agent_permission_grant,
} from '../src/chat/agentChat'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('autonomous-run security policy integration', () => {
  it('keeps autonomous machine authority fail-closed by default', () => {
    expect(DEFAULT_IRIS_SETTINGS.agent_safety_profile).toBe('strict')
    expect(DEFAULT_IRIS_SETTINGS.permissions_file_read).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.permissions_file_write).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.permissions_terminal).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.permissions_screen_capture).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.permissions_mouse_control).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.agent_block_sudo).toBe(true)
    expect(DEFAULT_IRIS_SETTINGS.agent_allow_network_commands).toBe(false)
    expect(DEFAULT_IRIS_SETTINGS.agent_web_site_guard).toBe(true)
    expect(DEFAULT_IRIS_SETTINGS.agent_package_install_guard).toBe(true)
    expect(DEFAULT_IRIS_SETTINGS.agent_package_require_venv).toBe(true)
    expect(DEFAULT_IRIS_SETTINGS.vision_auto_execute).toBe(false)
  })

  it('advertises only file capabilities granted to the current project run', () => {
    const read_only = get_core_agent_tool_allowlist('/workspace', false, false, true, false)
    expect(read_only).toContain('files.read')
    expect(read_only).toContain('rag.retrieve')
    expect(read_only).not.toContain('files.write')
    expect(read_only).not.toContain('files.patch')
    expect(read_only).not.toContain('terminal.exec')

    const locked = get_core_agent_tool_allowlist('/workspace', false, false, false, false)
    expect(locked).not.toContain('files.read')
    expect(locked).not.toContain('files.write')
    expect(locked).not.toContain('rag.retrieve')
    expect(locked).toContain('system.stats')
  })

  it('prevents autonomous sessions from persisting machine-permission grants', () => {
    expect(should_block_core_agent_permission_grant('permission', ['file_write'])).toBe(true)
    expect(should_block_core_agent_permission_grant('permission', ['terminal_exec'])).toBe(true)
    expect(should_block_core_agent_permission_grant('permission', ['mouse_control'])).toBe(true)
  })

  it('applies the same file and terminal capability toggles to delegated agents', () => {
    const sub_agent = source('src/platform/subAgentRuntime.ts')
    expect(sub_agent).toContain("throw new Error('File System Read permission is disabled.')")
    expect(sub_agent).toContain("throw new Error('File System Write permission is disabled.')")
    expect(sub_agent).toContain("throw new Error('Terminal Execution permission is disabled.')")
    expect(sub_agent).toContain('assertSubAgentPathSafe')
    expect(sub_agent).toContain('assertSubAgentCommandSafe')
  })

  it('keeps guarded web/package operations fail-closed without user approval', () => {
    const broker = source('src/platform/agent/runtime/toolBroker.ts')
    expect(broker).toContain('if (settings?.agent_web_site_guard === false) return true')
    expect(broker).toContain('if (!onApprovalRequest) return false; // guard on, unknown package, no UI → fail closed')
    expect(broker).toContain('agent_package_require_venv')
    expect(broker).toContain("requestType: 'web_site_access'")
    expect(broker).toContain("requestType: 'package_install'")
  })

  it('rechecks privileged launcher, screen and automation authority at bridge routes', () => {
    const launcher_routes = source('backend/desktopBridge/routes/fileRoutes.ts')
    const screen_routes = source('backend/desktopBridge/routes/screenRoutes.ts')
    const automation_routes = source('backend/desktopBridge/routes/automationRoutes.ts')

    expect(launcher_routes).toContain("requireBridgePermission(securityContext, 'launcher')")
    expect(screen_routes).toContain("requireBridgePermission(securityContext, 'screenCapture')")
    expect(automation_routes).toContain("requireBridgePermission(securityContext, 'automation')")
    expect(automation_routes).toContain('consumeAutomationApproval')
  })
})
