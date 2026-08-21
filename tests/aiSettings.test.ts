import { describe, expect, it } from 'vitest'
import {
  clamp_number,
  classify_provider_failure,
  get_primary_agent_model,
  set_primary_agent_model,
  set_provider_selected_models,
} from '../src/settings/aiSettings'
import type { OrbSettings } from '../src/platform/settingsStorage'

function settings_with_models(agent_models: OrbSettings['agent_models']): Pick<OrbSettings, 'agent_models'> {
  return { agent_models }
}

describe('AI settings helpers', () => {
  it('replaces one role primary without deleting secondary mesh models or other roles', () => {
    const settings = settings_with_models([
      {
        id: 'orchestrator:openai:gpt-old:1',
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-old',
        keyId: '1',
        primary: true,
        tags: ['planning'],
        disabledTags: [],
      },
      {
        id: 'orchestrator:anthropic:claude-secondary:2',
        role: 'orchestrator',
        provider: 'anthropic',
        model: 'claude-secondary',
        keyId: '2',
        primary: false,
        tags: ['review'],
        disabledTags: [],
      },
      {
        id: 'orchestrator:openrouter:reviewer-secondary:1',
        role: 'orchestrator',
        provider: 'openrouter',
        model: 'reviewer-secondary',
        keyId: '1',
        primary: false,
        tags: ['secondary'],
        disabledTags: [],
      },
      {
        id: 'scout:local:qwen:1',
        role: 'scout',
        provider: 'local',
        model: 'qwen',
        keyId: '1',
        primary: true,
        tags: [],
        disabledTags: [],
      },
    ])

    const next = set_primary_agent_model(settings, 'orchestrator', {
      provider: 'anthropic',
      model: 'claude-secondary',
      key_id: '2',
    })

    const primary = get_primary_agent_model({ agent_models: next }, 'orchestrator')
    expect(primary?.provider).toBe('anthropic')
    expect(primary?.model).toBe('claude-secondary')
    expect(primary?.tags).toEqual(['review'])
    expect(next.some((entry) => entry.role === 'scout' && entry.model === 'qwen')).toBe(true)
    expect(next.some((entry) => entry.role === 'orchestrator' && entry.model === 'gpt-old')).toBe(false)
    expect(next.some((entry) => entry.role === 'orchestrator' && entry.model === 'reviewer-secondary')).toBe(true)
    expect(next.filter((entry) => entry.role === 'orchestrator')).toHaveLength(2)
  })

  it('removes a role assignment without touching other roles', () => {
    const next = set_primary_agent_model(
      settings_with_models([
        {
          id: 'executor:openai:gpt:1',
          role: 'executor',
          provider: 'openai',
          model: 'gpt',
          keyId: '1',
          primary: true,
          tags: [],
          disabledTags: [],
        },
        {
          id: 'scout:local:qwen:1',
          role: 'scout',
          provider: 'local',
          model: 'qwen',
          keyId: '1',
          primary: true,
          tags: [],
          disabledTags: [],
        },
      ]),
      'executor',
      null,
    )

    expect(next.some((entry) => entry.role === 'executor')).toBe(false)
    expect(next.some((entry) => entry.role === 'scout')).toBe(true)
  })

  it('deduplicates curated provider models', () => {
    expect(
      set_provider_selected_models({ provider_selected_models: {} }, 'openai', ['gpt-4o', 'gpt-4o', '  gpt-4.1  ']),
    ).toEqual({ openai: ['gpt-4o', 'gpt-4.1'] })
  })

  it('classifies credential failures separately from transient provider failures', () => {
    expect(classify_provider_failure('401 Unauthorized: invalid API key')).toBe('invalid')
    expect(classify_provider_failure('connection timed out')).toBe('unavailable')
  })

  it('clamps numeric settings to supported bounds', () => {
    expect(clamp_number('2000', 1, 1440, 15)).toBe(1440)
    expect(clamp_number('-1', 1, 1440, 15)).toBe(1)
    expect(clamp_number('nope', 1, 1440, 15)).toBe(15)
  })
})
