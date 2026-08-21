import { describe, expect, it } from 'vitest'
import { buildCapabilitySnapshot, evaluateToolAccess } from '../src/platform/agent/runtime/capabilityPolicy'

const safety_config = {
  profile: 'standard',
  blockSudo: true,
  allowNetworkCommands: false,
  requireExplicitApproval: false,
  maxSteps: 100,
}

const settings = {
  ai_provider: 'openai',
  permissions_file_read: true,
  permissions_file_write: true,
  permissions_terminal: true,
  agent_tool_allowlist: ['files.read', 'files.list'],
}

describe('session tool allowlist', () => {
  it('blocks excluded machine-authority tools even when their persistent permission is enabled', () => {
    const access = evaluateToolAccess('files.write', {
      settings,
      safetyConfig: safety_config,
      userApprovalGranted: true,
    })

    expect(access.available).toBe(false)
    expect(access.code).toBe('session_tool_not_allowed')
  })

  it('does not advertise excluded tools as requestable permissions', () => {
    const snapshot = buildCapabilitySnapshot({
      settings,
      safetyConfig: safety_config,
      userApprovalGranted: true,
    })

    expect(snapshot.advertisedTools).toContain('files.read')
    expect(snapshot.advertisedTools).not.toContain('files.write')
    expect(snapshot.requestableTools).not.toContain('files.write')
    expect(snapshot.advertisedTools).not.toContain('terminal.exec')
  })

  it('also blocks excluded internal tools because internal is not a security boundary', () => {
    for (const tool of ['system.processes', 'artifact.create', 'agent.delegate', 'cloud.consult']) {
      const access = evaluateToolAccess(tool, {
        settings,
        safetyConfig: safety_config,
        userApprovalGranted: true,
      })

      expect(access.available).toBe(false)
      expect(access.code).toBe('session_tool_not_allowed')
    }
  })
})
