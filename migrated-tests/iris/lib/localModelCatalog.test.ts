import { describe, expect, it } from 'vitest'
import { chooseAutomaticLocalModel } from '@/platform/providers/localModelCatalog'

describe('chooseAutomaticLocalModel', () => {
  it('uses the larger local worker when the machine has substantial GPU memory', () => {
    expect(
      chooseAutomaticLocalModel({
        memTotal: 64 * 1024 ** 3,
        gpuMemoryTotalMb: 48 * 1024,
      }),
    ).toBe('qwen3.6:27b')
  })

  it('uses the larger worker when the shared runtime-fit policy accepts a 24 GB GPU', () => {
    expect(
      chooseAutomaticLocalModel({
        memTotal: 64 * 1024 ** 3,
        gpuMemoryTotalMb: 24 * 1024,
      }),
    ).toBe('qwen3.6:27b')
  })

  it('refuses to auto-download a recommended worker when known VRAM is too small', () => {
    expect(
      chooseAutomaticLocalModel({
        memTotal: 32 * 1024 ** 3,
        gpuMemoryTotalMb: 4 * 1024,
      }),
    ).toBe('')
  })

  it('uses the smaller balanced worker on modest or CPU-only machines', () => {
    expect(
      chooseAutomaticLocalModel({
        memTotal: 64 * 1024 ** 3,
        gpuMemoryTotalMb: 0,
      }),
    ).toBe('qwen3.5:9b')
  })
})
