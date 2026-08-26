/**
 * Exercises the observable agent identity contract, with regression cases for “defines the
 * stable orchestration roles” and “reads role bindings without changing the persisted
 * shape”. The suite documents caller-visible behavior so implementation refactors cannot
 * silently weaken those guarantees.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { clearKey, setKey } from '@/platform/keyStore'
import {
  AGENT_ROLE_IDS,
  applyAgentIdentityToSettings,
  getAgentRoleBinding,
  hasAgentRoleModel,
  isAgentRoleId,
  normalizeAgentRole,
  readAgentModels,
  readAgentRoleAssignments,
  resolveAgentIdentity,
  resolveAgentRoleSettings,
  resolveCurrentAgentRole,
  resolveLegacyAgentId,
} from '@/platform/agent/agentIdentity'

beforeEach(() => {
  clearKey('openrouter')
})

describe('agentIdentity', () => {
  it('defines the stable orchestration roles', () => {
    expect(AGENT_ROLE_IDS).toEqual(['orchestrator', 'executor', 'scout', 'overwatcher'])
    expect(isAgentRoleId('executor')).toBe(true)
    expect(isAgentRoleId('overwatcher')).toBe(true)
    expect(isAgentRoleId('deepseek')).toBe(false)
  })

  it.each([
    ['orchestrator', 'orchestrator'],
    ['claude', 'orchestrator'],
    ['anthropic', 'orchestrator'],
    ['executor', 'executor'],
    ['deepseek', 'executor'],
    ['opencode', 'executor'],
    ['coder', 'executor'],
    ['scout', 'scout'],
    ['local', 'scout'],
    ['ollama', 'scout'],
    ['lmstudio', 'scout'],
    ['unknown', 'executor'],
  ])('normalizes %s to the %s role', (input, expected) => {
    expect(normalizeAgentRole(input)).toBe(expected)
  })

  it('reads role bindings from the canonical flat model list', () => {
    const settings = {
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-sonnet',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'openrouter',
          model: 'deepseek/deepseek-r1',
          keyId: '1',
          primary: true,
        },
      ],
    }

    expect(readAgentRoleAssignments(settings)).toEqual({
      orchestrator: {
        provider: 'anthropic',
        model: 'claude-sonnet',
        keyId: '1',
      },
      executor: {
        provider: 'openrouter',
        model: 'deepseek/deepseek-r1',
        keyId: '1',
      },
    })
    expect(getAgentRoleBinding(settings, 'deepseek')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1',
      keyId: '1',
    })
  })

  it('resolves role, provider, and model independently', () => {
    setKey('openrouter', 'test-key')
    const settings = {
      ai_provider: 'openai',
      ai_model: 'gpt-4o',
      agent_models: [
        {
          role: 'executor',
          provider: 'openrouter',
          model: 'deepseek/deepseek-r1',
          keyId: '1',
          primary: true,
        },
      ],
    }

    expect(resolveAgentIdentity('deepseek', settings)).toEqual({
      role: 'executor',
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1',
      keyId: '1',
      explicitlyAssigned: true,
    })
    expect(resolveAgentRoleSettings('executor', settings).settings).toMatchObject({
      ai_provider: 'openrouter',
      ai_model: 'deepseek/deepseek-r1',
    })
  })

  it('does not apply an explicitly configured cloud role until its live key exists', () => {
    const settings = {
      ai_provider: 'local',
      ai_model: 'qwen3.6:27b',
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'openrouter',
          model: 'gpt-oss-120b',
          keyId: '1',
          primary: true,
        },
      ],
    }

    const unavailable = resolveAgentRoleSettings('orchestrator', settings)
    expect(unavailable.identity).toMatchObject({
      provider: 'openrouter',
      model: 'gpt-oss-120b',
      explicitlyAssigned: true,
    })
    expect(unavailable.settings).toBe(settings)

    setKey('openrouter', 'test-key')
    expect(resolveAgentRoleSettings('orchestrator', settings).settings).toMatchObject({
      ai_provider: 'openrouter',
      ai_model: 'gpt-oss-120b',
      ai_runtime_api_key: 'test-key',
    })
  })

  it('preserves active settings when a role is not explicitly assigned', () => {
    const settings = { ai_provider: 'openai', ai_model: 'gpt-4o' }
    const identity = resolveAgentIdentity('scout', settings)

    expect(identity).toEqual({
      role: 'scout',
      provider: 'openai',
      model: 'gpt-4o',
      keyId: '1',
      explicitlyAssigned: false,
    })
    expect(applyAgentIdentityToSettings(settings, identity)).toBe(settings)
  })

  it('resolves current roles from explicit assignments before legacy inference', () => {
    expect(
      resolveCurrentAgentRole({
        ai_provider: 'openai',
        ai_model: 'gpt-4o',
        agent_models: [
          {
            role: 'orchestrator',
            provider: 'openai',
            model: 'gpt-4o',
            keyId: '1',
            primary: true,
          },
        ],
      }),
    ).toBe('orchestrator')
    expect(resolveCurrentAgentRole({ ai_provider: 'anthropic', ai_model: 'other' })).toBe('orchestrator')
    expect(resolveCurrentAgentRole({ ai_provider: 'local', ai_model: 'llama3' })).toBe('scout')
    expect(resolveCurrentAgentRole({ ai_provider: 'openai', ai_model: 'gpt-4o' })).toBe('executor')
  })

  it('preserves legacy provider/model-derived agent ids', () => {
    expect(resolveLegacyAgentId({ ai_provider: 'anthropic', ai_model: 'other' })).toBe('claude')
    expect(
      resolveLegacyAgentId({
        ai_provider: 'openrouter',
        ai_model: 'deepseek-r1',
      }),
    ).toBe('deepseek')
    expect(resolveLegacyAgentId({ ai_provider: 'local', ai_model: 'llama3' })).toBe('local')
    expect(resolveLegacyAgentId({ ai_provider: 'openai', ai_model: 'gpt-4o' })).toBe('openai')
  })
})

describe('readAgentModels (flat model mesh)', () => {
  it('reads canonical flat entries with per-model tags', () => {
    const models = readAgentModels({
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus',
          keyId: '1',
          primary: true,
          tags: ['planner'],
        },
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus',
          keyId: '2',
          primary: false,
          tags: ['planner'],
        },
      ],
    })

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      role: 'orchestrator',
      keyId: '1',
      primary: true,
    })
    expect(models[1]).toMatchObject({
      role: 'orchestrator',
      keyId: '2',
      primary: false,
    })
    expect(models[0].tags).toContain('planner')
    expect(models[1].tags).toContain('planner')
  })

  it('does not read retired per-role fields at runtime', () => {
    const models = readAgentModels({
      agent_role_assignment: {
        orchestrator: { provider: 'anthropic', model: 'claude' },
      },
    })
    expect(models).toEqual([])
  })

  it('keeps the SAME model on different keys as distinct agents but de-dups identical entries', () => {
    const models = readAgentModels({
      agent_models: [
        {
          role: 'executor',
          provider: 'anthropic',
          model: 'claude',
          keyId: '1',
        },
        {
          role: 'executor',
          provider: 'anthropic',
          model: 'claude',
          keyId: '2',
        },
        {
          role: 'executor',
          provider: 'anthropic',
          model: 'claude',
          keyId: '1',
        },
      ],
    })
    expect(models).toHaveLength(2)
    expect(models.map((m) => m.keyId)).toEqual(['1', '2'])
  })

  it('enforces exactly one primary per role (demoting extras, promoting the first if none)', () => {
    const demoted = readAgentModels({
      agent_models: [
        {
          role: 'executor',
          provider: 'a',
          model: 'm1',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'a',
          model: 'm2',
          keyId: '1',
          primary: true,
        },
      ],
    })
    expect(demoted.filter((m) => m.primary)).toHaveLength(1)
    expect(demoted[0].primary).toBe(true)

    const promoted = readAgentModels({
      agent_models: [
        {
          role: 'scout',
          provider: 'a',
          model: 'm1',
          keyId: '1',
          primary: false,
        },
        {
          role: 'scout',
          provider: 'a',
          model: 'm2',
          keyId: '1',
          primary: false,
        },
      ],
    })
    expect(promoted.filter((m) => m.primary)).toHaveLength(1)
    expect(promoted[0].primary).toBe(true)
  })

  it('normalizes malformed entries without crashing', () => {
    const models = readAgentModels({
      agent_models: [
        null,
        {},
        { provider: 'local', model: 'llama3' },
        { role: 'invalid', provider: 'openai', model: 'gpt' },
      ],
    })
    expect(models).toHaveLength(2)
    expect(models[0].role).toBe('executor')
    expect(models[1].role).toBe('executor')
  })

  it('reports whether a role has a configured model', () => {
    const settings = {
      agent_models: [
        { role: 'orchestrator', provider: 'anthropic', model: 'claude', keyId: '1' },
        { role: 'scout', provider: 'local', model: 'llama3', keyId: '1' },
      ],
    }
    expect(hasAgentRoleModel(settings, 'orchestrator')).toBe(true)
    expect(hasAgentRoleModel(settings, 'executor')).toBe(false)
    expect(hasAgentRoleModel(settings, 'scout')).toBe(true)
  })
})
