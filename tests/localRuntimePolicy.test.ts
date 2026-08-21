import { describe, expect, it } from 'vitest'
import {
  estimateLocalModelMemoryGb,
  evaluateLocalRuntimeFit,
  localRuntimeFitScore,
  parseLocalModelParameterBillions,
  parseLocalModelQuantization,
} from '../src/platform/providers/localRuntimePolicy'

describe('local runtime resource policy', () => {
  it('parses common local parameter and quantization tags', () => {
    expect(parseLocalModelParameterBillions('qwen3-coder:30b-q4_K_M')).toBe(30)
    expect(parseLocalModelQuantization('qwen3-coder:30b-q4_K_M')).toBe('q4')
    expect(parseLocalModelQuantization('custom/13b-fp16')).toBe('fp16')
  })

  it('uses curated memory estimates before heuristic estimates', () => {
    expect(estimateLocalModelMemoryGb('qwen3.6:27b')).toBe(17)
    expect(estimateLocalModelMemoryGb('qwen3.5:9b')).toBe(6.6)
    expect(estimateLocalModelMemoryGb('custom:14b-q4')).toBeCloseTo(10.5, 1)
  })

  it('keeps comfortable, tight, and oversized VRAM fits distinct', () => {
    const comfortable = evaluateLocalRuntimeFit('qwen3.5:9b', { gpuMemoryTotalMb: 12 * 1024 })
    const tight = evaluateLocalRuntimeFit('qwen3.5:9b', { gpuMemoryTotalMb: 8 * 1024 })
    const oversized = evaluateLocalRuntimeFit('qwen3.6:27b', { gpuMemoryTotalMb: 16 * 1024 })

    expect(comfortable.fit).toBe('fits')
    expect(tight.fit).toBe('tight')
    expect(oversized.fit).toBe('oversized')
    expect(localRuntimeFitScore(comfortable)).toBeGreaterThan(localRuntimeFitScore(tight))
    expect(localRuntimeFitScore(oversized)).toBeLessThan(0)
  })

  it('does not reject unknown custom OpenAI-compatible model names', () => {
    const estimate = evaluateLocalRuntimeFit('company-custom-model', { gpuMemoryTotalMb: 8192 })
    expect(estimate.estimatedMemoryGb).toBeNull()
    expect(estimate.fit).toBe('unknown')
    expect(localRuntimeFitScore(estimate)).toBe(0)
  })
})
