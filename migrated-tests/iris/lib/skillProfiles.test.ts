/**
 * Exercises the observable skill profiles contract, with regression cases for “handles
 * OpenRouter provider prefixes” and “falls back to a normalized model slug”. The suite
 * documents caller-visible behavior so implementation refactors cannot silently weaken
 * those guarantees.
 */

import { describe, expect, it } from 'vitest'
import {
  buildSkillProfile,
  inferModelFamily,
  normalizeSkillProfileName,
  resolveActiveSkillProfile,
} from '@/platform/skillProfiles'

describe('skillProfiles', () => {
  it.each([
    ['claude-3-5-sonnet', 'claude'],
    ['gpt-4o', 'gpt4o'],
    ['gpt-4-turbo', 'gpt4'],
    ['gpt-3.5-turbo', 'gpt35'],
    ['o3', 'openai-o'],
    ['gemini-1.5-pro', 'gemini15'],
    ['gemini-2.0-flash', 'gemini2'],
    ['llama-3.1-70b', 'llama3'],
    ['gemma-3-27b', 'gemma3'],
    ['codestral-latest', 'codestral'],
    ['mistral-large', 'mistral'],
    ['mixtral-8x7b', 'mixtral'],
    ['phi-4', 'phi4'],
    ['deepseek-r1', ['-r1', 'deepseek-r1']],
    ['qwen2.5-coder', ['2.5-coder', 'qwen25']],
    ['grok-2', 'grok'],
    ['command-r-plus', 'cohere'],
  ])('infers %s as %s', (model, family) => {
    const inferred = inferModelFamily(model)
    if (Array.isArray(family)) {
      expect(family).toContain(inferred)
      return
    }
    expect(inferred).toBe(family)
  })

  it('handles OpenRouter provider prefixes', () => {
    expect(inferModelFamily('openai/gpt-4o')).toBe('gpt4o')
    expect(inferModelFamily('anthropic/claude-3-5-sonnet')).toBe('claude')
    expect(inferModelFamily('google/gemini-2.0-flash')).toBe('gemini2')
  })

  it('falls back to a normalized model slug', () => {
    expect(inferModelFamily('My Custom Model!')).toBe('my-custom-model')
  })

  it('builds a provider and model-family profile', () => {
    expect(buildSkillProfile('OpenAI', 'gpt-4o')).toBe('openai-gpt4o')
  })

  it('normalizes profile names and applies a fallback', () => {
    expect(normalizeSkillProfileName(' My Profile / One ')).toBe('my-profile-one')
    expect(normalizeSkillProfileName('', 'fallback-profile')).toBe('fallback-profile')
  })

  it('auto-switches to the computed profile by default', () => {
    expect(
      resolveActiveSkillProfile({
        ai_provider: 'anthropic',
        ai_model: 'claude-3-5-sonnet',
        skills_active_profile: 'manual',
      }),
    ).toBe('anthropic-claude')
  })

  it('uses a manual profile when auto-switching is disabled', () => {
    expect(
      resolveActiveSkillProfile({
        ai_provider: 'openai',
        ai_model: 'gpt-4o',
        skills_auto_switch: false,
        skills_active_profile: ' Team Profile ',
      }),
    ).toBe('team-profile')
  })

  it('falls back to the computed profile when a manual profile is empty', () => {
    expect(
      resolveActiveSkillProfile({
        ai_provider: 'local',
        ai_model: 'llama3',
        skills_auto_switch: false,
        skills_active_profile: '',
      }),
    ).toBe('local-llama3')
  })
})
