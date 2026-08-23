/**
 * Provides the renderer's provider-credential interface. Credentials are available only
 * through Electron's OS-backed safeStorage bridge; no browser, localStorage, settings, or
 * in-memory persistence fallback is permitted.
 */

export interface LegacyKeySettings {
  ai_api_key?: unknown
  ai_provider?: unknown
  [key: string]: unknown
}

export interface CredentialStorageStatus {
  available: boolean
  persistent: boolean
  backend: string
  reason: string
}

export interface CredentialMigrationResult {
  hadLegacy: boolean
  complete: boolean
  migrated: string[]
  failed: string[]
}

function normalizeProvider(provider: unknown): string {
  return String(provider || '')
    .trim()
    .toLowerCase()
}

// A provider can hold MULTIPLE keys (Key 1, Key 2, …) so different agents use different keys and
// don't share a rate limit. Each key is a separate encrypted credential under a composite id:
// keyId "1" (the default / legacy single key) → the bare provider id (backward compatible);
// keyId "2","3",… → `provider:keyId`. keyIds are short numeric-ish slugs.
export function normalizeKeyId(keyId: unknown): string {
  const k = String(keyId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return k || '1'
}

function credentialId(provider: unknown, keyId?: unknown): string {
  const p = normalizeProvider(provider)
  const k = normalizeKeyId(keyId)
  return k === '1' ? p : `${p}:${k}`
}

function desktopCredentials(): OrbitDesktopBridge['credentials'] | null {
  if (typeof window === 'undefined') return null
  return window.orbitDesktop?.credentials ?? null
}

export function getCredentialStorageStatus(): CredentialStorageStatus {
  const bridge = desktopCredentials()
  if (!bridge) {
    return {
      available: false,
      persistent: false,
      backend: 'unavailable',
      reason: 'electron-safe-storage-required',
    }
  }
  try {
    const result = bridge.status()
    return {
      available: result?.ok === true && result.available === true,
      persistent: result?.ok === true && result.persistent === true,
      backend: String(result?.backend || 'unavailable'),
      reason: String(result?.reason || result?.error || ''),
    }
  } catch (error) {
    return {
      available: false,
      persistent: false,
      backend: 'unavailable',
      reason: error instanceof Error ? error.message : 'credential-bridge-failed',
    }
  }
}

function requireCredentialBridge(): NonNullable<OrbitDesktopBridge['credentials']> {
  const bridge = desktopCredentials()
  const status = getCredentialStorageStatus()
  if (!bridge || !status.available || !status.persistent) {
    throw new Error(status.reason || 'Secure credential storage is unavailable')
  }
  return bridge
}

export function setKey(provider: string, value: string, keyId?: unknown): boolean {
  if (!normalizeProvider(provider)) return false
  const id = credentialId(provider, keyId)
  try {
    const bridge = requireCredentialBridge()
    const normalized = String(value || '').trim()
    if (normalized) {
      const result = bridge.set(id, normalized)
      return result?.ok === true && result.saved === true
    }
    const result = bridge.delete(id)
    return result?.ok === true && result.deleted === true
  } catch {
    return false
  }
}

export function getKey(provider: string, keyId?: unknown): string {
  if (!normalizeProvider(provider)) return ''
  const id = credentialId(provider, keyId)
  try {
    const result = requireCredentialBridge().get(id)
    return result?.ok === true ? String(result.value || '') : ''
  } catch {
    return ''
  }
}

export function clearKey(provider: string, keyId?: unknown): void {
  setKey(provider, '', keyId)
}

/**
 * The keyIds (e.g. "1", "2", …) that currently have a stored key for this provider — so the UI
 * can list "Key 1, Key 2, …" and an agent role can be bound to a specific one. Always includes
 * "1" so the provider's primary slot is offered even before extra keys are added.
 */
export function listProviderKeys(provider: string): string[] {
  const p = normalizeProvider(provider)
  if (!p) return ['1']
  const ids = new Set<string>(['1'])
  try {
    const result = requireCredentialBridge().list()
    const stored = result?.ok === true && Array.isArray(result.providers) ? result.providers : []
    for (const raw of stored) {
      const cid = normalizeProvider(raw)
      if (cid === p) ids.add('1')
      else if (cid.startsWith(`${p}:`)) ids.add(cid.slice(p.length + 1))
    }
  } catch {
    /* fall through to the default single key */
  }
  return Array.from(ids).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

/** True when a specific key slot has a stored value. */
export function hasKeyFor(provider: string, keyId?: unknown): boolean {
  return Boolean(getKey(provider, keyId))
}

export function listStoredProviders(): string[] {
  try {
    const result = requireCredentialBridge().list()
    return result?.ok === true && Array.isArray(result.providers)
      ? result.providers.map(normalizeProvider).filter(Boolean)
      : []
  } catch {
    return []
  }
}

export function hasKey(provider: string): boolean {
  return Boolean(getKey(provider))
}

/** Legacy plaintext credentials are deliberately not imported into the secure design. */
export function migrateLegacyStoredProviderKeys(): CredentialMigrationResult {
  return { hadLegacy: false, complete: true, migrated: [], failed: [] }
}

/** Legacy plaintext settings are deliberately ignored rather than re-persisted. */
export function migrateLegacyCredentials(_settings: LegacyKeySettings | null | undefined): CredentialMigrationResult {
  return { hadLegacy: false, complete: true, migrated: [], failed: [] }
}

/** Retained as a compatibility export; plaintext legacy key migration is disabled. */
export function migrateLegacyKey(_settings: LegacyKeySettings | null | undefined): boolean {
  return false
}
