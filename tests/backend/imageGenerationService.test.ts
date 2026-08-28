import { describe, expect, it } from 'vitest'
import {
  IMAGE_GENERATION_FORMATS,
  waitForProjectImages,
} from '../../backend/desktopBridge/services/imageGenerationService'

describe('image generation formats', () => {
  it('uses fixed diffusion-safe dimensions for every model-facing format', () => {
    expect(IMAGE_GENERATION_FORMATS).toEqual({
      square: { width: 1024, height: 1024 },
      landscape: { width: 1280, height: 720 },
      portrait: { width: 720, height: 1280 },
    })

    for (const size of Object.values(IMAGE_GENERATION_FORMATS)) {
      expect(size.width % 16).toBe(0)
      expect(size.height % 16).toBe(0)
    }
  })

  it('returns immediately when a project has no queued image jobs', async () => {
    await expect(waitForProjectImages('/workspace/no-image-jobs')).resolves.toEqual({
      waited: 0,
      completed: [],
      failed: [],
    })
  })
})
