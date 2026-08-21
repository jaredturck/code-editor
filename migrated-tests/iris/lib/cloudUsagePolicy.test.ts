/**
 * Verifies cloud-selected chats run local-first through the mesh while all remote inference paths
 * share the same bounded per-turn safety budget.
 */

import { describe, expect, it } from 'vitest';
import {
  CLOUD_REQUEST_HARD_CAP,
  buildHybridExecutionPlan,
  canUseCloud,
  consumeCloudRequest,
  createCloudUsageState,
} from '@/platform/agent/cloudUsagePolicy';

const settings = {
  ai_provider: 'openai',
  ai_model: 'gpt-4.1',
  agent_execution_policy: 'hybrid',
  agent_primary_assignment_id: 'orchestrator:openai:gpt-4.1:1',
  agent_cloud_request_budget: 3,
  provider_selected_models: {
    openai: ['gpt-4.1', 'gpt-4o-mini'],
    deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  provider_key_validation: {
    openai: {
      status: 'valid',
      testedAt: 1,
      message: '',
      models: ['gpt-4.1', 'gpt-4o-mini'],
    },
    deepseek: {
      status: 'valid',
      testedAt: 1,
      message: '',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    },
  },
  agent_models: [
    {
      id: 'orchestrator:openai:gpt-4.1:1',
      role: 'orchestrator',
      provider: 'openai',
      model: 'gpt-4.1',
      keyId: '1',
      primary: true,
      tags: [],
      disabledTags: [],
    },
    {
      id: 'orchestrator:deepseek:deepseek-v4-pro:1',
      role: 'orchestrator',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      keyId: '1',
      primary: false,
      tags: [],
      disabledTags: [],
    },
    {
      id: 'scout:local:qwen3.5:9b:1',
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

describe('cloud usage policy', () => {
  it('runs local-first through the mesh while keeping cloud peers reachable', () => {
    const plan = buildHybridExecutionPlan(settings);

    expect(plan?.workingSettings.ai_provider).toBe('local');
    expect(plan?.workingSettings.ai_model).toBe('qwen3.5:9b');
    expect(plan?.finalResponder).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
    });
    // Mesh is enabled and the primary is NOT locked → role binding/routing run; roles stay real.
    expect(plan?.workingSettings.agent_multi_enabled).toBe(true);
    expect(plan?.workingSettings.agent_primary_locked).not.toBe(true);
    // The roster is PRESERVED (not flattened to a local clone) so cloud peers remain reachable as
    // full-capability escalation targets...
    const models = plan?.workingSettings.agent_models as Array<{
      provider: string;
      role: string;
      primary: boolean;
    }>;
    expect(models.some((entry) => entry.provider === 'openai')).toBe(true);
    // ...while the LOCAL worker is the orchestrator primary (local-first).
    const orchestratorPrimary = models.find(
      (entry) => entry.role === 'orchestrator' && entry.primary,
    );
    expect(orchestratorPrimary?.provider).toBe('local');
  });

  it('returns null (cloud responder orchestrates directly) when no local worker is configured', () => {
    const plan = buildHybridExecutionPlan({
      ...settings,
      agent_models: settings.agent_models.filter((entry) => entry.provider !== 'local'),
    });
    expect(plan).toBeNull();
  });

  it('reserves the last cloud request for hybrid final synthesis', () => {
    const state = createCloudUsageState({ agent_cloud_request_budget: 3 }, true);
    expect(state).toEqual({ used: 0, max: 3, reservedForFinal: 1 });

    consumeCloudRequest(state, 'consult');
    consumeCloudRequest(state, 'agent');
    expect(canUseCloud(state, 'consult')).toBe(false);
    expect(canUseCloud(state, 'final')).toBe(true);
    expect(() => consumeCloudRequest(state, 'consult')).toThrow(/budget is exhausted/i);
    expect(consumeCloudRequest(state, 'final')).toBe(3);
    expect(canUseCloud(state, 'final')).toBe(false);
  });

  it('clamps corrupted or excessive settings to the immutable hard ceiling', () => {
    expect(createCloudUsageState({ agent_cloud_request_budget: 9999 }, false).max).toBe(
      CLOUD_REQUEST_HARD_CAP,
    );
  });
});
