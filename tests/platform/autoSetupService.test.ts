/**
 * Verifies the one-click service deliberately tests stored keys, discovers installed local
 * models, and persists one complete automatically generated profile patch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  keys: {} as Record<string, string>,
  testConnection: vi.fn(),
  discoverLocalAIServers: vi.fn(),
  pullLocalOllamaModel: vi.fn(),
  systemStats: vi.fn(),
}))

vi.mock('@/platform/aiService', () => ({
  testConnection: mocks.testConnection,
}))

vi.mock('@/platform/desktopBridge', () => ({
  discoverLocalAIServers: mocks.discoverLocalAIServers,
  pullLocalOllamaModel: mocks.pullLocalOllamaModel,
  systemStats: mocks.systemStats,
}))

vi.mock('@/platform/keyStore', () => ({
  getKey: vi.fn((provider: string, keyId = '1') => mocks.keys[`${provider}:${keyId}`] || ''),
  listProviderKeys: vi.fn((provider: string) =>
    Object.keys(mocks.keys)
      .filter((entry) => entry.startsWith(`${provider}:`))
      .map((entry) => entry.slice(provider.length + 1)),
  ),
}))

import { runAutomaticSetup } from '@/platform/autoSetup/autoSetupService'

describe('runAutomaticSetup', () => {
  beforeEach(() => {
    mocks.keys = {}
    mocks.testConnection.mockReset()
    mocks.discoverLocalAIServers.mockReset()
    mocks.pullLocalOllamaModel.mockReset()
    mocks.systemStats.mockReset()
    mocks.systemStats.mockResolvedValue({
      memoryTotal: 64 * 1024 ** 3,
      gpuMemoryTotalMb: 49152,
    })
    mocks.pullLocalOllamaModel.mockResolvedValue({ ok: true })
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [],
      preferred: null,
    })
  })

  it('tests stored cloud keys and builds a cloud/local role profile in one operation', async () => {
    mocks.keys = {
      'openai:1': 'openai-key',
      'deepseek:1': 'deepseek-key',
    }
    mocks.testConnection.mockImplementation(async (settings: Record<string, unknown>) => {
      if (settings.ai_provider === 'openai') {
        return {
          ok: true,
          models: ['gpt-4.1', 'gpt-4o-mini'],
          message: 'Connected',
        }
      }
      return {
        ok: true,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        message: 'Connected',
      }
    })
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [
        {
          kind: 'ollama',
          url: 'http://127.0.0.1:11434',
          modelCount: 2,
          models: ['qwen3-coder:30b', 'qwen3.5:9b'],
        },
      ],
      preferred: {
        kind: 'ollama',
        url: 'http://127.0.0.1:11434',
        modelCount: 2,
        models: ['qwen3-coder:30b', 'qwen3.5:9b'],
      },
    })

    const result = await runAutomaticSetup({
      ai_provider: 'openai',
      ai_model: 'gpt-4.1',
      ai_local_url: 'http://127.0.0.1:11434',
    })

    expect(result.testedKeys).toBe(2)
    expect(result.validKeys).toBe(2)
    expect(result.localDetected).toBe(true)
    expect(result.patch.provider_key_validation).toMatchObject({
      openai: { status: 'valid', models: ['gpt-4.1', 'gpt-4o-mini'] },
      deepseek: {
        status: 'valid',
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      },
      local: { status: 'valid', models: ['qwen3-coder:30b', 'qwen3.5:9b'] },
    })
    expect(result.patch.agent_models).toHaveLength(6)
    expect(result.patch.agent_multi_enabled).toBe(true)
    expect(result.patch).toMatchObject({
      audio_provider: 'local',
      audio_model: 'gabegoodhart/granite4.1-speech:2b',
      audio_local_fallback: true,
    })
    expect(result.summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Local runtime:'),
        expect.stringContaining('Cloud responders:'),
        expect.stringContaining('Audio:'),
      ]),
    )
  })

  it('keeps a rejected key visible as invalid and excludes it from a local-only profile', async () => {
    mocks.keys = { 'deepseek:1': 'bad-key' }
    mocks.testConnection.mockResolvedValue({
      ok: false,
      models: [],
      message: '401 invalid API key',
    })
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [
        {
          kind: 'ollama',
          url: 'http://127.0.0.1:11434',
          modelCount: 1,
          models: ['qwen3.6:27b'],
        },
      ],
      preferred: {
        kind: 'ollama',
        url: 'http://127.0.0.1:11434',
        modelCount: 1,
        models: ['qwen3.6:27b'],
      },
    })

    const result = await runAutomaticSetup({
      ai_provider: 'local',
      ai_model: 'qwen3.6:27b',
      ai_local_url: 'http://127.0.0.1:11434',
    })

    expect(result.patch.provider_key_validation).toMatchObject({
      deepseek: { status: 'invalid', message: '401 invalid API key' },
    })
    expect(result.patch.ai_provider).toBe('local')
    expect(result.patch.agent_execution_policy).toBe('local_only')
    expect(
      (result.patch.agent_models as Array<{ provider: string }>).every((entry) => entry.provider === 'local'),
    ).toBe(true)
  })

  it('preserves an explicitly configured cloud audio binding', async () => {
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [
        {
          kind: 'ollama',
          url: 'http://127.0.0.1:11434',
          modelCount: 1,
          models: ['qwen3.6:27b'],
        },
      ],
      preferred: {
        kind: 'ollama',
        url: 'http://127.0.0.1:11434',
        modelCount: 1,
        models: ['qwen3.6:27b'],
      },
    })

    const result = await runAutomaticSetup({
      ai_provider: 'local',
      ai_model: 'qwen3.6:27b',
      ai_local_url: 'http://127.0.0.1:11434',
      audio_provider: 'openai',
      audio_model: 'gpt-4o-mini-transcribe',
      audio_key_id: '2',
      audio_local_fallback: false,
    })

    expect(result.patch).toMatchObject({
      audio_provider: 'openai',
      audio_model: 'gpt-4o-mini-transcribe',
      audio_key_id: '2',
      audio_local_fallback: false,
    })
    expect(result.summary.at(-1)).toBe('Audio: openai / gpt-4o-mini-transcribe')
  })

  it('uses runtime-fit policy to select the stronger worker on a 24 GB GPU', async () => {
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [{ kind: 'ollama', url: 'http://127.0.0.1:11434', modelCount: 1, models: ['all-minilm:22m'] }],
      preferred: { kind: 'ollama', url: 'http://127.0.0.1:11434', modelCount: 1, models: ['all-minilm:22m'] },
    })
    mocks.systemStats.mockResolvedValue({ memTotal: 64 * 1024 ** 3, gpuMemoryTotalMb: 24 * 1024 })

    const result = await runAutomaticSetup({
      ai_provider: 'local',
      ai_model: '',
      ai_local_url: 'http://127.0.0.1:11434',
    })

    expect(mocks.pullLocalOllamaModel).toHaveBeenCalledWith('http://127.0.0.1:11434', 'qwen3.6:27b')
    expect(result.patch.agent_required_local_model).toBe('qwen3.6:27b')
  })

  it('does not download a known-oversized worker on a very small GPU', async () => {
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [{ kind: 'ollama', url: 'http://127.0.0.1:11434', modelCount: 1, models: ['all-minilm:22m'] }],
      preferred: { kind: 'ollama', url: 'http://127.0.0.1:11434', modelCount: 1, models: ['all-minilm:22m'] },
    })
    mocks.systemStats.mockResolvedValue({ memTotal: 32 * 1024 ** 3, gpuMemoryTotalMb: 4 * 1024 })

    await expect(
      runAutomaticSetup({ ai_provider: 'local', ai_model: '', ai_local_url: 'http://127.0.0.1:11434' }),
    ).rejects.toThrow(/safely fits/i)
    expect(mocks.pullLocalOllamaModel).not.toHaveBeenCalled()
  })

  it('downloads a hardware-appropriate Ollama model when no suitable chat model is installed', async () => {
    mocks.discoverLocalAIServers.mockResolvedValue({
      servers: [
        {
          kind: 'ollama',
          url: 'http://127.0.0.1:11434',
          modelCount: 1,
          models: ['all-minilm:22m'],
        },
      ],
      preferred: {
        kind: 'ollama',
        url: 'http://127.0.0.1:11434',
        modelCount: 1,
        models: ['all-minilm:22m'],
      },
    })
    mocks.systemStats.mockResolvedValue({
      memTotal: 64 * 1024 ** 3,
      gpuMemoryTotalMb: 48 * 1024,
    })

    const result = await runAutomaticSetup({
      ai_provider: 'local',
      ai_model: '',
      ai_local_url: 'http://127.0.0.1:11434',
    })

    expect(mocks.pullLocalOllamaModel).toHaveBeenCalledWith('http://127.0.0.1:11434', 'qwen3.6:27b')
    expect(result.patch.agent_required_local_model).toBe('qwen3.6:27b')
    expect(result.summary[0]).toContain('Downloaded local worker')
  })
})
