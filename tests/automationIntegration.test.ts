import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAutomationApprovalsForTests,
  consumeAutomationApproval,
  createAutomationApproval,
} from '../backend/desktopBridge/shared/automationApproval'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Automation integration boundary', () => {
  beforeEach(() => clearAutomationApprovalsForTests())

  it('binds a single-use approval to the exact action plan and cwd', () => {
    const request = { actions: [{ type: 'click', button: 'left', repeat: 1 }], cwd: '/workspace' }
    const token = createAutomationApproval(request)

    expect(consumeAutomationApproval(token, { ...request, cwd: '/other' })).toBe(false)
    expect(consumeAutomationApproval(token, request)).toBe(false)

    const exactToken = createAutomationApproval(request)
    expect(consumeAutomationApproval(exactToken, request)).toBe(true)
    expect(consumeAutomationApproval(exactToken, request)).toBe(false)
  })

  it('keeps action execution behind the trusted automation permission and approval route', () => {
    const route = source('backend/desktopBridge/routes/automationAiRoutes.ts')
    const desktopBridge = source('src/platform/desktopBridge.ts')
    const settings = source('src/components/settings/AISettingsPanel.tsx')

    expect(route).toContain("requireBridgePermission(securityContext, 'automation')")
    expect(route).toContain('consumeAutomationApproval(body.approvalToken')
    expect(route).toContain("acquireOperation('automation'")
    expect(desktopBridge).toContain('settings.permissions_mouse_control === true')
    expect(desktopBridge).toContain('base.executeAutomationActions(vision.actions')
    expect(settings).toContain("['permissions_screen_capture', 'Capture screen'")
    expect(settings).toContain("['permissions_mouse_control', 'Desktop automation'")
  })
})
