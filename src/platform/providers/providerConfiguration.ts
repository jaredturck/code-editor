/**
 * Shared provider-readiness helpers used by Settings, Agents, and Chat.
 * Credentials remain in Electron safeStorage; this module only reads the persisted
 * last-known validation state and the user's curated model shortlist.
 */

import { AI_PROVIDER_DEFINITIONS } from '@/platform/providers/providerRegistry';

export type ProviderValidationStatus = 'untested' | 'valid' | 'invalid' | 'unavailable';

export interface ProviderKeyValidationRecord {
  status: ProviderValidationStatus;
  testedAt: number;
  message: string;
  models: string[];
}

export interface ProviderConfigurationSettings {
  provider_key_validation?: Record<string, ProviderKeyValidationRecord>;
  provider_selected_models?: Record<string, string[]>;
  discovered_models?: Record<string, string[]>;
  [key: string]: unknown;
}

export function providerCredentialId(providerId: string, keyId = '1'): string {
  const provider = String(providerId || '')
    .trim()
    .toLowerCase();
  const key = String(keyId || '1').trim() || '1';
  return key === '1' ? provider : `${provider}:${key}`;
}

export function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((model) => String(model || '').trim()).filter(Boolean)));
}

export function getProviderValidation(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId = '1',
): ProviderKeyValidationRecord {
  const record = settings?.provider_key_validation?.[providerCredentialId(providerId, keyId)];
  const status = String(record?.status || 'untested') as ProviderValidationStatus;
  return {
    status: ['valid', 'invalid', 'unavailable'].includes(status) ? status : 'untested',
    testedAt: Number(record?.testedAt) || 0,
    message: String(record?.message || ''),
    models: normalizeModelList(record?.models),
  };
}

export function isProviderKeyValid(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId = '1',
): boolean {
  return getProviderValidation(settings, providerId, keyId).status === 'valid';
}

export function getValidProviderKeyIds(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
): string[] {
  const provider = String(providerId || '')
    .trim()
    .toLowerCase();
  if (!provider) return [];
  const records = settings?.provider_key_validation || {};
  return Object.entries(records)
    .filter(([id, record]) => {
      const matches = id === provider || id.startsWith(`${provider}:`);
      return matches && record?.status === 'valid';
    })
    .map(([id]) => (id === provider ? '1' : id.slice(provider.length + 1)))
    .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
}

export function getSelectedProviderModels(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
): string[] {
  return normalizeModelList(settings?.provider_selected_models?.[String(providerId || '').trim()]);
}

export function getDiscoveredModelsForKey(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId = '1',
): string[] {
  const credentialId = providerCredentialId(providerId, keyId);
  const validationModels = getProviderValidation(settings, providerId, keyId).models;
  if (validationModels.length) return validationModels;
  const credentialModels = normalizeModelList(settings?.discovered_models?.[credentialId]);
  if (credentialModels.length) return credentialModels;
  return normalizeModelList(settings?.discovered_models?.[providerId]);
}

export function getProviderCatalog(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
): string[] {
  const validKeyIds = getValidProviderKeyIds(settings, providerId);
  const discovered = validKeyIds.flatMap((keyId) =>
    getDiscoveredModelsForKey(settings, providerId, keyId),
  );
  if (discovered.length) return normalizeModelList(discovered).sort((a, b) => a.localeCompare(b));
  return normalizeModelList(settings?.discovered_models?.[providerId]).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function getCuratedModelsForKey(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId = '1',
): string[] {
  const selected = getSelectedProviderModels(settings, providerId);
  if (providerId === 'local') return selected;
  const accessible = new Set(getDiscoveredModelsForKey(settings, providerId, keyId));
  if (!accessible.size) return selected;
  return selected.filter((model) => accessible.has(model));
}

export function isProviderReady(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
): boolean {
  return (
    getValidProviderKeyIds(settings, providerId).length > 0 &&
    getSelectedProviderModels(settings, providerId).length > 0
  );
}

export function getReadyProviderIds(
  settings: ProviderConfigurationSettings | null | undefined,
): string[] {
  return AI_PROVIDER_DEFINITIONS.filter((provider) => isProviderReady(settings, provider.id)).map(
    (provider) => provider.id,
  );
}

export function buildProviderValidationPatch(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId: string,
  record: ProviderKeyValidationRecord | null,
): Record<string, ProviderKeyValidationRecord> {
  const next = { ...(settings?.provider_key_validation || {}) };
  const id = providerCredentialId(providerId, keyId);
  if (record) next[id] = record;
  else delete next[id];
  return next;
}

export function buildDiscoveredModelsPatch(
  settings: ProviderConfigurationSettings | null | undefined,
  providerId: string,
  keyId: string,
  models: string[] | null,
): Record<string, string[]> {
  const next = { ...(settings?.discovered_models || {}) };
  const id = providerCredentialId(providerId, keyId);
  if (models) next[id] = normalizeModelList(models);
  else delete next[id];
  if (keyId === '1') {
    if (models) next[providerId] = normalizeModelList(models);
    else delete next[providerId];
  }
  return next;
}
