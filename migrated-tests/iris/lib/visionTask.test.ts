/** Protects Vision's bounded local-only model path and structured-plan safety fallback. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runBoundedRoleTask: vi.fn() }))
vi.mock('@/platform/agent/boundedRoleTask', () => ({
  runBoundedRoleTask: mocks.runBoundedRoleTask,
}))

import { runVisionTask } from '@/platform/agent/visionTask'

const SETTINGS = { agent_models: [] }
const FRAME = 'data:image/png;base64,QUJDRA=='

describe('runVisionTask', () => {
  beforeEach(() => mocks.runBoundedRoleTask.mockReset())

  it('requires a captured image before any model call', async () => {
    await expect(runVisionTask('describe', '', SETTINGS)).rejects.toThrow('Capture a screen frame')
    expect(mocks.runBoundedRoleTask).not.toHaveBeenCalled()
  })

  it('requests a vision-capable local role and parses a structured plan', async () => {
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: JSON.stringify({
        summary: 'A settings window is visible.',
        warnings: ['Confirm before clicking.'],
        actions: [{ type: 'click', button: 'left', repeat: 1 }],
      }),
      model: 'qwen2.5vl:7b',
      role: 'scout',
      provider: 'local',
    })

    const result = await runVisionTask('open settings', FRAME, SETTINGS)

    expect(mocks.runBoundedRoleTask).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredRoles: ['scout', 'orchestrator'],
        requiredTags: ['vision'],
        allowCloud: false,
        taskLabel: 'screen vision analysis',
      }),
    )
    expect(result).toEqual({
      summary: 'A settings window is visible.',
      warnings: ['Confirm before clicking.'],
      actions: [{ type: 'click', button: 'left', repeat: 1 }],
      model: 'qwen2.5vl:7b',
      role: 'scout',
      provider: 'local',
    })
  })

  it('never accepts actions from an unstructured response', async () => {
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'I can see a window, click the button.',
      model: 'local-vlm',
      role: 'orchestrator',
      provider: 'local',
    })

    const result = await runVisionTask('inspect', FRAME, SETTINGS)

    expect(result.actions).toEqual([])
    expect(result.warnings).toContain('The response was not structured, so no desktop actions were accepted.')
  })
})
