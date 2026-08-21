/**
 * Provides the renderer's synchronous state facade while keeping all durable values in the
 * Electron-owned encrypted SQLite store. Plaintext values exist only in this process memory;
 * Chromium localStorage is never used as application persistence.
 */

import { durableStoreDelete, durableStoreSet } from '@/platform/desktopBridge';
import { durableStoreGetBootstrap } from '@/platform/secureDurableStore';

const memoryStore = new Map<string, string>();
const writeQueues = new Map<string, Promise<unknown>>();
let hydrated = false;
let fatalError = '';
let testMode = false;

function resolveFallback<T>(fallbackValue: T | (() => T)): T {
  return typeof fallbackValue === 'function' ? (fallbackValue as () => T)() : fallbackValue;
}

function clearLegacyBrowserStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith('iris_')) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Browser storage may be blocked. It is not used by the desktop application.
  }
}

function showFatalStorageError(error: unknown): void {
  if (fatalError) return;
  fatalError = error instanceof Error ? error.message : String(error || 'Encrypted storage failed');
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent('iris:storage-fatal', {
      detail: { message: fatalError },
    }),
  );

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alert');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.display = 'grid';
  overlay.style.placeItems = 'center';
  overlay.style.padding = '32px';
  overlay.style.background = '#09090b';
  overlay.style.color = '#fafafa';
  overlay.style.fontFamily = 'system-ui, sans-serif';
  overlay.innerHTML = `
    <div style="max-width:620px;text-align:center">
      <h1 style="font-size:22px;margin:0 0 12px">Secure storage unavailable</h1>
      <p style="line-height:1.55;margin:0">IRIS stopped using persistent features because encrypted storage failed. Restart the desktop application after checking the operating-system credential store.</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

function assertHydrated(): void {
  if (!hydrated) throw new Error('Encrypted renderer storage has not been hydrated');
  if (fatalError) throw new Error(fatalError);
}

function queueWrite(key: string, operation: () => Promise<unknown>): void {
  if (testMode) return;
  const previous = writeQueues.get(key) || Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(operation)
    .catch((error) => {
      showFatalStorageError(error);
      return undefined;
    });
  writeQueues.set(key, queued);
  void queued.then(() => {
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  });
}

/** Loads only bootstrap-safe encrypted renderer values before React mounts. */
export async function hydrateDurableStore(): Promise<number> {
  if (hydrated) return memoryStore.size;
  clearLegacyBrowserStorage();

  try {
    const values = await durableStoreGetBootstrap();
    memoryStore.clear();
    for (const [key, raw] of Object.entries(values)) {
      if (typeof raw === 'string') memoryStore.set(key, raw);
    }
    hydrated = true;
    return memoryStore.size;
  } catch (error) {
    showFatalStorageError(error);
    throw error;
  }
}

/**
 * Reports whether the encrypted renderer-state facade is ready. The legacy function name is
 * retained for callers; it does not indicate that Chromium localStorage is used.
 */
export function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && hydrated && !fatalError;
}

export function readStorageJson<T>(key: string, fallbackValue: T | (() => T)): T {
  if (!hydrated || fatalError) return resolveFallback(fallbackValue);
  const raw = memoryStore.get(key);
  if (!raw) return resolveFallback(fallbackValue);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return resolveFallback(fallbackValue);
  }
}

export function writeStorageJson(key: string, value: unknown): boolean {
  assertHydrated();
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') return false;
  if (memoryStore.get(key) === serialized) return true;
  memoryStore.set(key, serialized);
  queueWrite(key, () => durableStoreSet(key, serialized));
  return true;
}

export function readStorageText(key: string, fallbackValue = ''): string {
  if (!hydrated || fatalError) return fallbackValue;
  return memoryStore.get(key) ?? fallbackValue;
}

export function writeStorageText(key: string, value: unknown): boolean {
  assertHydrated();
  const text = String(value ?? '');
  if (memoryStore.get(key) === text) return true;
  memoryStore.set(key, text);
  queueWrite(key, () => durableStoreSet(key, text));
  return true;
}

export function removeStorageKey(key: string): void {
  assertHydrated();
  memoryStore.delete(key);
  queueWrite(key, () => durableStoreDelete(key));
}

/** Explicit test harness initialization; production never enables this path. */
export function initializeStorageForTests(values: Record<string, string> = {}): void {
  testMode = true;
  hydrated = true;
  fatalError = '';
  memoryStore.clear();
  writeQueues.clear();
  for (const [key, value] of Object.entries(values)) memoryStore.set(key, String(value));
}


export function hydrateStorageValues(values: Record<string, string>): void {
  assertHydrated();
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw === 'string') memoryStore.set(key, raw);
  }
}

export function getStorageFatalError(): string {
  return fatalError;
}

export async function flushEncryptedStoreWrites(): Promise<void> {
  await Promise.all(Array.from(writeQueues.values()));
}
