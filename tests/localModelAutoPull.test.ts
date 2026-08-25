import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  pull: vi.fn(),
}))

vi.mock('@/platform/desktopBridge', () => ({
  proxyAIRequest: vi.fn(),
  proxyAIStream: vi.fn(),
  pullLocalOllamaModel: state.pull,
}))

vi.mock('@/platform/keyStore', () => ({ getKey: vi.fn(() => '') }))
vi.mock('@/platform/agent/localOnlyPolicy', () => ({
  enforceLocalOnlyProvider: (settings: unknown) => settings,
}))
vi.mock('@/platform/agent/cloudUsagePolicy', () => ({
  consumeCloudRequest: vi.fn(),
  getCloudUsageState: vi.fn(() => null),
  isCloudProvider: vi.fn(() => false),
}))
vi.mock('@/platform/providers/openaiProvider', () => ({
  listOpenAICompatibleModels: vi.fn(),
}))
vi.mock('@/platform/providers/providerRegistry', () => ({
  DEFAULT_AI_PROVIDER_ID: 'openai',
  findAIProvider: vi.fn(),
  getAIProvider: vi.fn(() => ({
    id: 'local',
    defaultModel: 'llama3',
    invoke: state.invoke,
  })),
}))

import { callAIWithMeta } from '../src/platform/aiService'

const local_settings = {
  ai_provider: 'local',
  ai_model: 'qwen3.5:9b',
  ai_local_url: 'http://localhost:11434',
}

describe('configured local model auto-pull', () => {
  beforeEach(() => {
    state.invoke.mockReset()
    state.pull.mockReset()
  })

  it('pulls the exact configured Ollama model and retries it before failover can occur', async () => {
    state.invoke
      .mockRejectedValueOnce(
        new Error("Local model \"qwen3.5:9b\" isn't available on the Ollama server (model 'qwen3.5:9b' not found)."),
      )
      .mockResolvedValueOnce({ text: 'ready', usage: {} })
    state.pull.mockResolvedValue({ ok: true, model: 'qwen3.5:9b', status: 'success' })

    const result = await callAIWithMeta([], local_settings as never)

    expect(state.pull).toHaveBeenCalledTimes(1)
    expect(state.pull).toHaveBeenCalledWith('http://localhost:11434', 'qwen3.5:9b')
    expect(state.invoke).toHaveBeenCalledTimes(2)
    expect(result.text).toBe('ready')
  })

  it('does not pull a model for unrelated provider failures', async () => {
    state.invoke.mockRejectedValueOnce(new Error('Ollama connection reset'))

    await expect(callAIWithMeta([], local_settings as never)).rejects.toThrow('connection reset')
    expect(state.pull).not.toHaveBeenCalled()
    expect(state.invoke).toHaveBeenCalledTimes(1)
  })
})
