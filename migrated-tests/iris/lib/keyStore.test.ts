/**
 * Exercises the desktop-only credential contract against a fake Electron safeStorage bridge.
 * The suite verifies that provider secrets never use Web Storage or a browser fallback.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearKey,
  getCredentialStorageStatus,
  getKey,
  hasKey,
  listStoredProviders,
  migrateLegacyCredentials,
  migrateLegacyKey,
  migrateLegacyStoredProviderKeys,
  setKey,
} from '@/platform/keyStore';

function installCredentialBridge({ persistent = true, available = true } = {}) {
  const values = new Map<string, string>();
  window.orbitDesktop = {
    isDesktopShell: true,
    credentials: {
      status: () => ({
        ok: true,
        available,
        persistent,
        backend: persistent ? 'kwallet6' : 'unavailable',
        reason: available ? '' : 'os-encryption-unavailable',
      }),
      list: () => ({ ok: true, providers: Array.from(values.keys()).sort() }),
      get: (provider) => ({
        ok: true,
        value: values.get(String(provider).toLowerCase()) || '',
      }),
      set: (provider, value) => {
        if (!available || !persistent) return { ok: false, saved: false, error: 'unavailable' };
        values.set(String(provider).toLowerCase(), String(value));
        return { ok: true, saved: true };
      },
      delete: (provider) => {
        if (!available || !persistent) return { ok: false, deleted: false, error: 'unavailable' };
        values.delete(String(provider).toLowerCase());
        return { ok: true, deleted: true };
      },
    },
  };
  return values;
}

beforeEach(() => {
  installCredentialBridge();
});

describe('keyStore', () => {
  it('stores and retrieves a provider key through the Electron credential bridge', () => {
    expect(setKey('OpenAI', '  fake-key-123  ')).toBe(true);
    expect(getKey('openai')).toBe('fake-key-123');
    expect(localStorage.getItem('iris_key_v1_openai')).toBeNull();
  });

  it('handles unicode key text', () => {
    setKey('gemini', 'key-✓-测试');
    expect(getKey('gemini')).toBe('key-✓-测试');
  });

  it('clears keys explicitly or when an empty value is stored', () => {
    setKey('openai', 'fake-key');
    clearKey('openai');
    expect(getKey('openai')).toBe('');

    setKey('openai', 'replacement');
    setKey('openai', '');
    expect(hasKey('openai')).toBe(false);
  });

  it('lists only credentials reported by the secure store', () => {
    setKey('openai', 'one');
    setKey('anthropic', 'two');
    localStorage.setItem('iris_key_v1_ignored', 'legacy-plaintext');

    expect(listStoredProviders()).toEqual(['anthropic', 'openai']);
  });

  it('fails closed when the Electron credential bridge is absent', () => {
    delete window.orbitDesktop;
    expect(getCredentialStorageStatus()).toMatchObject({
      available: false,
      persistent: false,
      backend: 'unavailable',
      reason: 'electron-safe-storage-required',
    });
    expect(setKey('openai', 'browser-session-key')).toBe(false);
    expect(getKey('openai')).toBe('');
  });

  it('fails closed when secure persistence is unavailable', () => {
    installCredentialBridge({ persistent: false, available: false });
    expect(getCredentialStorageStatus()).toMatchObject({
      available: false,
      persistent: false,
    });
    expect(setKey('openai', 'secret')).toBe(false);
    expect(getKey('openai')).toBe('');
  });

  it('does not import legacy per-provider Web Storage entries', () => {
    localStorage.setItem('iris_key_v1_openai', 'legacy-plaintext');

    expect(migrateLegacyStoredProviderKeys()).toEqual({
      hadLegacy: false,
      complete: true,
      migrated: [],
      failed: [],
    });
    expect(getKey('openai')).toBe('');
    expect(localStorage.getItem('iris_key_v1_openai')).toBe('legacy-plaintext');
  });

  it('does not import legacy credentials from settings', () => {
    expect(
      migrateLegacyCredentials({
        ai_provider: 'openai',
        ai_api_key: 'legacy-ai-key',
        search_web_tavily_api_key: 'legacy-tavily-key',
      }),
    ).toEqual({ hadLegacy: false, complete: true, migrated: [], failed: [] });
    expect(getKey('openai')).toBe('');
    expect(getKey('search-tavily')).toBe('');
  });

  it('retains the legacy migration export as a disabled compatibility operation', () => {
    expect(
      migrateLegacyKey({
        ai_provider: 'openai',
        ai_api_key: 'legacy-fake-key',
      }),
    ).toBe(false);
    expect(getKey('openai')).toBe('');
  });
});
