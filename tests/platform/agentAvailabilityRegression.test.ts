import { beforeEach, describe, expect, it } from 'vitest'
import { clearKey, setKey } from '@/platform/keyStore'
import {
  isModelCredentialReady,
  pickFailoverModel,
  recordModelFailure,
  resetModelHealth,
} from '@/platform/agent/modelHealth'
import { pickDelegateMember, stopAllSubAgentLoops } from '@/platform/orchestrationClient'
import { inferModelFamily } from '@/platform/skillProfiles'
import { isReasoningModel } from '@/platform/modelProfiles'

beforeEach(() => {
  stopAllSubAgentLoops()
  resetModelHealth()
  clearKey('openai')
})

describe('agent availability regressions', () => {
  it('never selects a credential-required cloud model when no key is saved', () => {
    const settings = {
      agent_models: [
        { role: 'executor', provider: 'local', model: 'qwen3.6:27b', keyId: '1', primary: true },
        { role: 'orchestrator', provider: 'openai', model: 'gpt-5.1-codex-max', keyId: '1', primary: true },
      ],
    }

    expect(isModelCredentialReady('local', '1')).toBe(true)
    expect(isModelCredentialReady('openai', '1')).toBe(false)
    expect(
      pickFailoverModel(settings as never, {
        provider: 'local',
        model: 'qwen3.6:27b',
        keyId: '1',
      }),
    ).toBeNull()

    setKey('openai', 'test-key')
    expect(isModelCredentialReady('openai', '1')).toBe(true)
  })

  it('does not immediately cycle back to another model that already failed', () => {
    const settings = {
      agent_models: [
        { role: 'executor', provider: 'local', model: 'worker-a', keyId: '1', primary: true },
        { role: 'scout', provider: 'local', model: 'worker-b', keyId: '1', primary: true },
      ],
    }

    recordModelFailure('local', 'worker-a', '1', { error: 'timeout' })
    expect(
      pickFailoverModel(settings as never, {
        provider: 'local',
        model: 'worker-a',
        keyId: '1',
      })?.model,
    ).toBe('worker-b')

    recordModelFailure('local', 'worker-b', '1', { error: 'timeout' })
    expect(
      pickFailoverModel(settings as never, {
        provider: 'local',
        model: 'worker-b',
        keyId: '1',
      }),
    ).toBeNull()
  })

  it('rejects delegation before starting an explicitly assigned cloud agent with no key', () => {
    const settings = {
      agent_multi_enabled: true,
      agent_models: [
        {
          role: 'executor',
          provider: 'openai',
          model: 'gpt-5.1-codex-max',
          keyId: '1',
          primary: true,
        },
      ],
    }

    expect(() => pickDelegateMember('executor', settings as never)).toThrow(
      'No available executor agent is configured.',
    )
  })

  it('classifies Qwen 3.6 with the deliberative Qwen capability family', () => {
    expect(inferModelFamily('qwen3.6:27b')).toBe('qwen35')
    expect(isReasoningModel('local', 'qwen3.6:27b')).toBe(true)
  })
})
