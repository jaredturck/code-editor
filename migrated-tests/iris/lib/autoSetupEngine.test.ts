/**
 * Verifies the one-click setup engine builds a balanced role profile from only the
 * models confirmed by validated provider keys and installed local runtimes.
 */

import { describe, expect, it } from 'vitest';
import { buildAutomaticSetupPlan } from '@/platform/autoSetup/autoSetupEngine';
import { evaluateModel } from '@/platform/autoSetup/modelSelectionRules';
import type { ProviderConfigurationSettings } from '@/platform/providers/providerConfiguration';

function validSettings(models: Record<string, string[]>): ProviderConfigurationSettings {
  return {
    provider_key_validation: Object.fromEntries(
      Object.entries(models).map(([provider, available]) => [
        provider,
        {
          status: 'valid',
          testedAt: 1,
          message: 'Connected',
          models: available,
        },
      ]),
    ),
    discovered_models: models,
    provider_selected_models: {},
  };
}

describe('automatic setup model selection', () => {
  it('prefers a balanced proven model over an expensive flagship by default', () => {
    const plan = buildAutomaticSetupPlan(
      validSettings({
        openai: ['gpt-5.5', 'gpt-4.1', 'gpt-4o-mini', 'text-embedding-3-large'],
        gemini: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'],
        local: ['qwen3.5:9b', 'qwen3-coder:30b'],
      }),
    );

    expect(plan.patch.agent_models).toHaveLength(6);
    expect(plan.patch.ai_model).not.toBe('gpt-5.5');
    expect(['gpt-4.1', 'gemini-3.5-flash']).toContain(plan.patch.ai_model);
    expect(plan.patch.agent_execution_policy).toBe('hybrid');
    expect(plan.patch.agent_models.filter((entry) => entry.role === 'orchestrator')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'local', primary: false }),
        expect.objectContaining({ primary: true }),
      ]),
    );
    expect(plan.patch.agent_models.find((entry) => entry.role === 'scout')?.provider).toBe('local');
    expect(plan.patch.provider_selected_models.openai).not.toContain('text-embedding-3-large');
  });

  it('uses DeepSeek as a capable budget cloud primary when it is the available provider', () => {
    const plan = buildAutomaticSetupPlan(
      validSettings({
        deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        local: ['qwen3.5:9b', 'qwen3-coder:30b'],
      }),
    );

    expect(plan.patch.ai_provider).toBe('deepseek');
    expect(plan.patch.ai_model).toBe('deepseek-v4-pro');
    expect(plan.patch.agent_models.filter((entry) => entry.role === 'orchestrator')).toHaveLength(
      2,
    );
    expect(
      plan.patch.agent_models.some(
        (entry) => entry.role === 'orchestrator' && entry.provider === 'local',
      ),
    ).toBe(true);
    expect(plan.patch.provider_selected_models.deepseek).toEqual(
      expect.arrayContaining(['deepseek-v4-pro', 'deepseek-v4-flash']),
    );
  });

  it('creates a hard local-only profile when no validated cloud model is available', () => {
    const plan = buildAutomaticSetupPlan(
      validSettings({
        local: ['qwen3.6:27b', 'qwen3-coder:30b', 'qwen3.5:9b'],
      }),
    );

    expect(plan.patch.ai_provider).toBe('local');
    expect(plan.patch.agent_execution_policy).toBe('local_only');
    expect(plan.patch.agent_models.every((entry) => entry.provider === 'local')).toBe(true);
  });

  it('excludes non-chat model categories from automatic profiles', () => {
    for (const model of [
      'text-embedding-3-large',
      'gpt-4o-realtime-preview',
      'tts-1',
      'sora-2',
      'omni-moderation-latest',
    ]) {
      expect(evaluateModel({ provider: 'openai', model, keyId: '1' }).excluded, model).toBe(true);
    }
  });
});
