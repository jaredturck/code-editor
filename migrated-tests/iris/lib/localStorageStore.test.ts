/** Tests the synchronous in-memory renderer facade used over encrypted SQLite persistence. */

import { describe, expect, it, vi } from 'vitest';
import {
  canUseLocalStorage,
  readStorageJson,
  readStorageText,
  removeStorageKey,
  writeStorageJson,
  writeStorageText,
} from '@/platform/localStorageStore';

describe('localStorageStore', () => {
  it('is available after encrypted startup hydration', () => {
    expect(canUseLocalStorage()).toBe(true);
  });

  it('reads and writes JSON values in process memory', () => {
    expect(writeStorageJson('json-value', { enabled: true })).toBe(true);
    expect(readStorageJson('json-value', null)).toEqual({ enabled: true });
    expect(window.localStorage.getItem('json-value')).toBeNull();
  });

  it('uses value and function fallbacks for missing JSON', () => {
    const fallback = vi.fn(() => ({ generated: true }));
    expect(readStorageJson('missing-json', { fallback: true })).toEqual({ fallback: true });
    expect(readStorageJson('missing-function-json', fallback)).toEqual({ generated: true });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('rejects non-serializable JSON values', () => {
    expect(writeStorageJson('undefined-json', undefined)).toBe(false);
  });

  it('reads and writes text without Chromium persistence', () => {
    expect(writeStorageText('text-value', 42)).toBe(true);
    expect(readStorageText('text-value')).toBe('42');
    expect(window.localStorage.getItem('text-value')).toBeNull();
  });

  it('coerces null text to an empty string', () => {
    expect(writeStorageText('null-text', null)).toBe(true);
    expect(readStorageText('null-text', 'fallback')).toBe('');
  });

  it('removes stored values', () => {
    writeStorageText('remove-me', 'value');
    removeStorageKey('remove-me');
    expect(readStorageText('remove-me', 'fallback')).toBe('fallback');
  });
});
