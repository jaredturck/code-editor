/**
 * Exercises the agent broker's persistent permission request path so a disabled capability
 * pauses for user consent instead of disappearing from the runtime or becoming session-wide.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as desktopBridge from '@/platform/desktopBridge'
import { createModuleBroker } from '@/platform/agent/runtime/toolBroker'
import { DEFAULT_ORB_SETTINGS } from '@/platform/settingsStorage'

describe('tool broker permission grants', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requests a persistent file-read grant outside the autonomous workspace path', async () => {
    vi.spyOn(desktopBridge, 'readTextFile').mockResolvedValue({
      path: '/tmp/test.txt',
      content: 'hello',
      isBinary: false,
    })

    const onApprovalRequest = vi.fn().mockResolvedValue({
      approved: true,
      decision: 'approve',
    })
    const approvalState = {
      granted: false,
      sessionPermissionOverrides: {},
    }
    const broker = createModuleBroker({
      settings: {
        ...DEFAULT_ORB_SETTINGS,
        agent_working_dir: '',
      },
      todoTool: {
        list: () => [],
        applyUpdates: () => [],
      },
      traceTool: {
        thinking: vi.fn(),
      },
      safetyConfig: {
        profile: 'strict',
        requireExplicitApproval: false,
        maxSteps: 12,
      },
      approvalState,
      webSearchState: {},
      userInput: 'read test.txt',
      requestAI: vi.fn(),
      onApprovalRequest,
      stepHistory: [],
    })

    await broker.execute('files.read', { path: 'test.txt' })

    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'permission',
        permissionKeys: ['file_read'],
        persistentPermission: true,
      }),
    )
    expect(approvalState.sessionPermissionOverrides).toEqual({ file_read: true })
    expect(approvalState.granted).toBe(false)
  })

  it('keeps a persistent capability grant separate from risky-action approval', async () => {
    vi.spyOn(desktopBridge, 'writeTextFile').mockResolvedValue({
      path: '/tmp/output.txt',
      saved: true,
    })

    const onApprovalRequest = vi
      .fn()
      .mockResolvedValueOnce({ approved: true, decision: 'approve' })
      .mockResolvedValueOnce({ approved: true, decision: 'approve' })
    const approvalState = {
      granted: false,
      sessionPermissionOverrides: {},
    }
    const broker = createModuleBroker({
      settings: {
        ...DEFAULT_ORB_SETTINGS,
        agent_working_dir: '',
      },
      todoTool: {
        list: () => [],
        applyUpdates: () => [],
      },
      traceTool: {
        thinking: vi.fn(),
      },
      safetyConfig: {
        profile: 'strict',
        requireExplicitApproval: true,
        maxSteps: 12,
      },
      approvalState,
      webSearchState: {},
      userInput: 'write output.txt',
      requestAI: vi.fn(),
      onApprovalRequest,
      stepHistory: [],
    })

    await broker.execute('files.write', {
      path: 'output.txt',
      content: 'hello',
    })

    expect(onApprovalRequest).toHaveBeenCalledTimes(2)
    expect(onApprovalRequest.mock.calls[0][0]).toMatchObject({
      permissionKeys: ['file_write'],
      persistentPermission: true,
    })
    expect(onApprovalRequest.mock.calls[1][0]).toMatchObject({
      permissionKeys: [],
      persistentPermission: false,
    })
    expect(approvalState.sessionPermissionOverrides).toEqual({ file_write: true })
    expect(approvalState.granted).toBe(true)
  })
})
