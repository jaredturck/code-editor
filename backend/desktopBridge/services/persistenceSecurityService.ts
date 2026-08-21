/**
 * Narrows which encrypted durable-state records are decrypted into the renderer at startup.
 * Chat bodies live in dedicated encrypted tables; per-chat run state and extended run history
 * stay sealed until the renderer explicitly requests the active record.
 */

import { readEncryptedStoreAll } from '../storage/encryptedDatabase.js';
import {
  filterRendererBootstrapValues,
  normalizeRequestedDurableStoreKeys,
} from '../storage/persistenceSecurityPolicy.js';

export async function readRendererBootstrapStore(): Promise<Record<string, string>> {
  return filterRendererBootstrapValues(await readEncryptedStoreAll());
}

export async function readRequestedDurableStoreKeys(
  keys: unknown,
): Promise<Record<string, string>> {
  const normalized = normalizeRequestedDurableStoreKeys(keys);
  if (!normalized.length) return {};
  const allValues = await readEncryptedStoreAll();
  const requested: Record<string, string> = {};
  for (const key of normalized) {
    if (typeof allValues[key] === 'string') requested[key] = allValues[key];
  }
  return requested;
}
