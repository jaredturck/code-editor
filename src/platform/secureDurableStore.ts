/**
 * Provides narrowly-scoped reads from the encrypted durable store. Sensitive run/checkpoint
 * records are intentionally absent from startup hydration and are decrypted only on demand.
 */

import { bridgeUrl } from '@/platform/desktopBridgeBase';

function bridgeToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URLSearchParams(window.location.search).get('bridgeToken') || '';
  } catch {
    return '';
  }
}

function notifyStorageFailure(error: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('iris:storage-fatal', {
      detail: {
        message: error instanceof Error ? error.message : String(error || 'Encrypted storage failed'),
      },
    }),
  );
}

async function requestEncryptedStore(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const token = bridgeToken();
  const headers: Record<string, string> = {};
  if (token) headers['x-iris-bridge-token'] = token;
  if (body) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(bridgeUrl(path), {
      method: body ? 'POST' : 'GET',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.error || `Encrypted storage request failed (${response.status})`));
    }
    const values = payload?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch (error) {
    notifyStorageFailure(error);
    throw error;
  }
}

export function durableStoreGetBootstrap(): Promise<Record<string, string>> {
  return requestEncryptedStore('/store/bootstrap');
}

export function durableStoreGetMany(keys: string[]): Promise<Record<string, string>> {
  const normalized = Array.from(new Set(keys.map((key) => String(key || '').trim()).filter(Boolean))).slice(0, 64);
  if (!normalized.length) return Promise.resolve({});
  return requestEncryptedStore('/store/get-many', { keys: normalized });
}
