import { describe, expect, it } from 'vitest'
import { build_core_agent_settings, build_project_run_input } from '@/chat/agentChat'
import { createToolGuard } from '@/platform/agent/toolGuard'
import { getToolCatalogEntry, getToolPermissionKey, getToolTimeoutMs, isToolRisky } from '@/platform/agent/toolCatalog'
import { DEFAULT_ORB_SETTINGS } from '@/platform/settingsStorage'

describe('image generation tool', () => {
  it('exposes one small native project-image contract', () => {
    const tool = getToolCatalogEntry('image.generate')

    expect(tool).not.toBeNull()
    expect(tool?.module).toBe('Files')
    expect(tool?.args).toEqual({
      prompt: 'string',
      path: 'string',
      format: 'square | landscape | portrait',
    })
    expect(getToolPermissionKey('image.generate')).toBe('file_write')
    expect(getToolTimeoutMs('image.generate')).toBe(4 * 60_000)
    expect(isToolRisky('image.generate')).toBe(true)
  })

  it('rejects fake raster assets written through text file tools', () => {
    const guard = createToolGuard()

    expect(guard.check('files.write', { path: 'public/cat.jpg', content: '[PLACEHOLDER CAT IMAGE]' })).toMatchObject({
      blocked: true,
    })
    expect(guard.check('files.patch', { path: 'public/cat.webp', patch: 'placeholder' })).toMatchObject({
      blocked: true,
    })
    expect(guard.check('files.write', { path: 'public/cat.svg', content: '<svg />' }).blocked).toBe(false)
  })

  it('migrates the legacy off state without overriding a later explicit disable', () => {
    const legacy = build_core_agent_settings(
      {
        ...DEFAULT_ORB_SETTINGS,
        image_generation_enabled: false,
      },
      '/workspace/project',
    )
    const explicitly_disabled = build_core_agent_settings(
      {
        ...DEFAULT_ORB_SETTINGS,
        image_generation_enabled: false,
        image_generation_auto_enabled_v1: true,
      },
      '/workspace/project',
    )

    expect(legacy.image_generation_enabled).toBe(true)
    expect(explicitly_disabled.image_generation_enabled).toBe(false)
  })

  it('tells the coding model to generate real raster assets and use declared tools', () => {
    const input = build_project_run_input('Build a cat website with cat images.', 'automatic')

    expect(input).toContain('use it and save the generated asset directly into the project')
    expect(input).toContain('Never create fake .jpg')
    expect(input).toContain('Run shell commands with terminal.exec')
    expect(input).toContain('do not invent files.exec')
  })
})
