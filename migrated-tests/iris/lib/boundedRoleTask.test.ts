/** Protects the short local-first task runner used outside the full chat loop. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIWithMeta: vi.fn(),
  getKey: vi.fn(() => 'cloud-key'),
}));

vi.mock('@/platform/aiService', () => ({ callAIWithMeta: mocks.callAIWithMeta }));
vi.mock('@/platform/keyStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/keyStore')>();
  return { ...original, getKey: mocks.getKey };
});

import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask';
import { resetModelHealth } from '@/platform/agent/modelHealth';

const SETTINGS = {
  ai_provider: 'openai',
  ai_model: 'gpt-4o',
  agent_models: [
    {
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
      keyId: '1',
      primary: true,
    },
    {
      role: 'orchestrator',
      provider: 'openai',
      model: 'gpt-4o',
      keyId: '1',
      primary: true,
    },
  ],
};

describe('runBoundedRoleTask', () => {
  beforeEach(() => {
    resetModelHealth();
    mocks.callAIWithMeta.mockReset();
    mocks.getKey.mockClear();
  });

  it('selects a configured local role model before any cloud candidate', async () => {
    mocks.callAIWithMeta.mockResolvedValue({ text: 'local result', usage: {} });

    const result = await runBoundedRoleTask({
      settings: SETTINGS,
      messages: [{ role: 'user', content: 'summarize' }],
      preferredRoles: ['scout', 'orchestrator'],
      requiredTags: ['general'],
      allowCloud: true,
      cloudApproved: true,
    });

    expect(result).toMatchObject({
      text: 'local result',
      local: true,
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
    });
    expect(mocks.callAIWithMeta).toHaveBeenCalledTimes(1);
    expect(mocks.callAIWithMeta.mock.calls[0][1]).toMatchObject({
      ai_provider: 'local',
      ai_model: 'qwen3:4b',
      ai_runtime_api_key: '',
      agent_primary_locked: true,
    });
    expect(mocks.getKey).not.toHaveBeenCalled();
  });

  it('never attempts a cloud model unless cloud use is both enabled and approved', async () => {
    mocks.callAIWithMeta.mockRejectedValue(new Error('local unavailable'));

    await expect(
      runBoundedRoleTask({
        settings: SETTINGS,
        messages: [{ role: 'user', content: 'summarize' }],
        requiredTags: ['general'],
        allowCloud: true,
        cloudApproved: false,
      }),
    ).rejects.toThrow('Cloud fallback was not approved');

    expect(mocks.callAIWithMeta).toHaveBeenCalledTimes(1);
    expect(mocks.getKey).not.toHaveBeenCalled();
  });

  it('uses an approved cloud candidate only after the local candidate fails', async () => {
    mocks.callAIWithMeta
      .mockRejectedValueOnce(new Error('local unavailable'))
      .mockResolvedValueOnce({ text: 'cloud result', usage: {} });

    const result = await runBoundedRoleTask({
      settings: SETTINGS,
      messages: [{ role: 'user', content: 'hard task' }],
      preferredRoles: ['scout', 'orchestrator'],
      requiredTags: ['general'],
      allowCloud: true,
      cloudApproved: true,
      maxAttempts: 2,
    });

    expect(result).toMatchObject({
      text: 'cloud result',
      local: false,
      provider: 'openai',
    });
    expect(mocks.callAIWithMeta.mock.calls[1][1]).toMatchObject({
      ai_provider: 'openai',
      ai_model: 'gpt-4o',
      ai_runtime_api_key: 'cloud-key',
    });
  });

  it('forwards separate thinking and answer streams to bounded-task callers', async () => {
    const onToken = vi.fn();
    const onThinkingToken = vi.fn();
    mocks.callAIWithMeta.mockImplementation(async (_messages, _settings, options) => {
      options.onThinkingToken?.('reasoning');
      options.onToken?.('answer');
      return {
        text: 'answer',
        thinkingText: 'reasoning',
        usage: null,
        toolCalls: [],
        stopReason: 'stop',
        provider: 'Local',
        model: 'qwen3:4b',
      };
    });

    const result = await runBoundedRoleTask({
      settings: SETTINGS,
      messages: [{ role: 'user', content: 'summarize' }],
      onToken,
      onThinkingToken,
    });

    expect(onThinkingToken).toHaveBeenCalledWith('reasoning');
    expect(onToken).toHaveBeenCalledWith('answer');
    expect(result.meta.thinkingText).toBe('reasoning');
  });
});
