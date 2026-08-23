/**
 * Covers the complexity-aware routing primitives (Workstream B): derived cost/local tags,
 * the cheap no-model-call complexity heuristic, and right-sized model selection.
 */
import { describe, expect, it } from 'vitest'
import {
  getRoutingProfile,
  estimateTaskComplexity,
  pickModelForComplexity,
  isModelRoutingEnabled,
} from '@/platform/agent/modelRouting'

describe('modelRouting', () => {
  it('derives routing tags from the capability spine', () => {
    expect(getRoutingProfile('anthropic', 'claude-opus-4-8').costTier).toBe('premium')
    const local = getRoutingProfile('local', 'gemma3')
    expect(local.costTier).toBe('cheap')
    expect(local.local).toBe(true)
  })

  it('estimates complexity cheaply (no model call)', () => {
    expect(estimateTaskComplexity('hello')).toBe('trivial')
    expect(estimateTaskComplexity('refactor the auth module across several files')).toBe('complex')
    expect(estimateTaskComplexity('what time is it')).toBe('trivial')
    expect(estimateTaskComplexity('summarize the differences between these two config approaches please')).toBe(
      'standard',
    )
  })

  it('picks the right-sized model for the complexity', () => {
    const candidates = [
      { id: 'scout', provider: 'local', model: 'gemma3' },
      { id: 'orchestrator', provider: 'anthropic', model: 'claude-opus-4-8' },
    ]
    expect(pickModelForComplexity(candidates, 'complex')?.id).toBe('orchestrator')
    expect(pickModelForComplexity(candidates, 'trivial')?.id).toBe('scout')
    expect(pickModelForComplexity([], 'complex')).toBeNull()
  })

  it('is off by default', () => {
    expect(isModelRoutingEnabled({})).toBe(false)
    expect(isModelRoutingEnabled({ agent_model_routing: 'on' })).toBe(true)
  })
})
