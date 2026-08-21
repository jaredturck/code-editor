import { describe, expect, it } from 'vitest';
import {
  getCuratedModelsForKey,
  getProviderCatalog,
  getReadyProviderIds,
  getValidProviderKeyIds,
  isProviderReady,
  providerCredentialId,
} from '@/platform/providers/providerConfiguration';

describe('providerConfiguration', () => {
  const settings = {
    provider_key_validation: {
      openai: {
        status: 'valid' as const,
        testedAt: 1,
        message: '',
        models: ['gpt-4o', 'gpt-4.1'],
      },
      'openai:2': {
        status: 'invalid' as const,
        testedAt: 2,
        message: 'Rejected',
        models: [],
      },
    },
    provider_selected_models: {
      openai: ['gpt-4.1', 'not-accessible'],
    },
    discovered_models: {},
  };

  it('tracks validation separately for each credential slot', () => {
    expect(providerCredentialId('openai', '1')).toBe('openai');
    expect(providerCredentialId('openai', '2')).toBe('openai:2');
    expect(getValidProviderKeyIds(settings, 'openai')).toEqual(['1']);
  });

  it('uses tested model access to filter the curated assignment list', () => {
    expect(getProviderCatalog(settings, 'openai')).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(getCuratedModelsForKey(settings, 'openai', '1')).toEqual(['gpt-4.1']);
  });

  it('only exposes providers that have a validated key and curated model', () => {
    expect(isProviderReady(settings, 'openai')).toBe(true);
    expect(getReadyProviderIds(settings)).toContain('openai');
    expect(isProviderReady(settings, 'gemini')).toBe(false);
  });
});
