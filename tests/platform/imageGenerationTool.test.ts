import { describe, expect, it } from 'vitest'
import { getToolCatalogEntry, getToolPermissionKey, getToolTimeoutMs, isToolRisky } from '@/platform/agent/toolCatalog'

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
})
