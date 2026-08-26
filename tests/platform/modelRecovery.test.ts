/**
 * Tier-exhaustion recovery (WS6): recommends a model that is RECOMMENDED (best role fit) AND
 * AVAILABLE (saved key / installed locally) and healthy, excluding the failing model — so the chat
 * can offer to load it instead of stopping.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { recommendRecoveryModel } from '@/platform/agent/modelRecovery'
import { resetModelHealth, recordModelFailure } from '@/platform/agent/modelHealth'
import { clearKey, setKey } from '@/platform/keyStore'

const settings = {
  discovered_models: { local: ['qwen3:8b', 'llama3.1:8b'] },
  provider_selected_models: { openai: ['gpt-4.1', 'gpt-4o-mini'] },
  provider_key_validation: {
    openai: {
      status: 'valid' as const,
      testedAt: 1,
      message: '',
      models: ['gpt-4.1', 'gpt-4o-mini'],
    },
  },
}

describe('modelRecovery', () => {
  beforeEach(() => {
    resetModelHealth()
    clearKey('openai')
  })

  it('recommends an available, healthy model and excludes the failing one', async () => {
    const rec = await recommendRecoveryModel(settings, 'orchestrator', [
      { provider: 'openai', model: 'gpt-4.1', keyId: '1' },
    ])
    expect(rec).toBeTruthy()
    expect(`${rec!.provider}:${rec!.model}`).not.toBe('openai:gpt-4.1')
  })

  it('does not offer a cloud recovery model from stale validation when its key is absent', async () => {
    const cloudOnly = { ...settings, discovered_models: { local: [] } }
    await expect(recommendRecoveryModel(cloudOnly, 'orchestrator')).resolves.toBeNull()

    setKey('openai', 'test-key')
    await expect(recommendRecoveryModel(cloudOnly, 'orchestrator')).resolves.toMatchObject({
      provider: 'openai',
      requiresDownload: false,
    })
  })

  it('skips models that are currently suspended', async () => {
    for (const [provider, model] of [
      ['openai', 'gpt-4.1'],
      ['openai', 'gpt-4o-mini'],
      ['local', 'qwen3:8b'],
      ['local', 'llama3.1:8b'],
    ] as const) {
      recordModelFailure(provider, model, '1', {})
      recordModelFailure(provider, model, '1', {})
    }
    await expect(recommendRecoveryModel(settings, 'orchestrator')).resolves.toBeNull()
  })

  it('recommends a hardware-sized Ollama download when no suitable model is available', async () => {
    const rec = await recommendRecoveryModel(
      {
        local_runtime_kind: 'ollama',
        ai_local_url: 'http://127.0.0.1:11434',
        discovered_models: { local: [] },
      },
      'orchestrator',
    )
    expect(rec).toMatchObject({
      provider: 'local',
      requiresDownload: true,
      downloadBaseUrl: 'http://127.0.0.1:11434',
    })
    expect(rec?.model).toBeTruthy()
  })

  it('returns null when nothing is available to load', async () => {
    await expect(recommendRecoveryModel({}, 'orchestrator')).resolves.toBeNull()
  })
})
