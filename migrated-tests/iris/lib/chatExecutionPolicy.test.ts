import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getKey: vi.fn() }));
vi.mock('@/platform/keyStore', () => ({
  getKey: mocks.getKey,
  normalizeKeyId: (value: unknown) => String(value || '1'),
}));

import {
  buildChatExecutionSettings,
  getChatResponderChoices,
  getDefaultChatResponder,
  resolveChatResponder,
} from '@/platform/agent/chatExecutionPolicy';

describe('chatExecutionPolicy', () => {
  const settings = {
    ai_provider: 'openai',
    ai_model: 'gpt-old',
    agent_model_routing: 'auto',
    agent_failover_mode: 'auto',
    agent_models: [
      {
        id: 'openai-main',
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-4.1',
        keyId: '2',
        primary: true,
        tags: [],
        disabledTags: [],
      },
      {
        id: 'local-main',
        role: 'orchestrator',
        provider: 'local',
        model: 'qwen3.5:9b',
        keyId: '1',
        primary: false,
        tags: [],
        disabledTags: [],
      },
      {
        id: 'local-scout',
        role: 'scout',
        provider: 'local',
        model: 'qwen3.5:9b',
        keyId: '1',
        primary: true,
        tags: [],
        disabledTags: [],
      },
    ],
  };

  beforeEach(() => {
    mocks.getKey.mockReset();
    mocks.getKey.mockReturnValue('key-two');
  });

  it('lists only configured Orchestrators and restores the starred default', () => {
    expect(getChatResponderChoices(settings).map((entry) => entry.id)).toEqual([
      'orchestrator:openai:gpt-4.1:2',
      'orchestrator:local:qwen3.5:9b:1',
    ]);
    expect(getDefaultChatResponder(settings)?.model).toBe('gpt-4.1');
    expect(resolveChatResponder(settings, 'missing')?.model).toBe('gpt-4.1');
  });

  it('runs a cloud responder through the mesh (unlocked, full roster) in hybrid mode', () => {
    const responder = getDefaultChatResponder(settings);
    const result = buildChatExecutionSettings(settings, responder, 'hybrid');
    expect(result).toMatchObject({
      ai_provider: 'openai',
      ai_model: 'gpt-4.1',
      ai_runtime_api_key: 'key-two',
      agent_execution_policy: 'hybrid',
      // Hybrid no longer locks the primary, and it enables the bridge so cloud can pull in / escalate
      // to peers as full agents under their own role tier.
      agent_multi_enabled: true,
      agent_peer_consult_enabled: true,
    });
    expect(result.agent_primary_locked).not.toBe(true);
    // Full roster preserved (no local-clone flattening for hybrid).
    expect(result.agent_models).toHaveLength(3);
  });

  it('enforces a local-only model pool when a local responder is selected', () => {
    const responder = getChatResponderChoices(settings).find((entry) => entry.provider === 'local');
    const result = buildChatExecutionSettings(settings, responder || null, 'hybrid');
    expect(result).toMatchObject({
      ai_provider: 'local',
      ai_model: 'qwen3.5:9b',
      agent_execution_policy: 'local_only',
      agent_local_only_enforced: true,
      agent_model_routing: 'off',
      agent_failover_mode: 'off',
      agent_multi_enabled: true,
    });
    expect(result.agent_models.every((entry) => entry.provider === 'local')).toBe(true);
    expect(result.agent_models.map((entry) => entry.role)).toEqual([
      'orchestrator',
      'executor',
      'scout',
      'overwatcher',
    ]);
  });
});
