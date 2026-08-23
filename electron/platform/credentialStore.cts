/**
 * Stores provider credentials as safeStorage ciphertext in Electron's user-data directory.
 * Encryption and decryption happen only in the main process; the renderer receives a narrow
 * provider-key interface rather than a general-purpose cryptography primitive.
 */

import crypto = require('node:crypto')
import fs = require('node:fs')
import path = require('node:path')
import type { App, BrowserWindow as ElectronBrowserWindow, IpcMain, IpcMainEvent, SafeStorage } from 'electron'

const STORE_FILENAME = 'secure-credentials.json'
const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/

interface CredentialStoreData {
  version: 1
  entries: Record<string, unknown>
}

interface CredentialStoreStatus {
  available: boolean
  persistent: boolean
  backend: string
  reason: string
}

interface CredentialStoreOptions {
  app?: Pick<App, 'getPath' | 'isReady'>
  safeStorage?: Pick<
    SafeStorage,
    'decryptString' | 'encryptString' | 'getSelectedStorageBackend' | 'isEncryptionAvailable'
  >
  platform?: NodeJS.Platform
}

interface CodedError extends Error {
  code?: string
}

export interface CredentialStore {
  get: (idInput: unknown) => string
  list: () => string[]
  remove: (idInput: unknown) => boolean
  set: (idInput: unknown, valueInput: unknown) => boolean
  status: () => CredentialStoreStatus
  storePath: () => string
}

interface CredentialIpcOptions {
  ipcMain: IpcMain
  BrowserWindow?: Pick<typeof ElectronBrowserWindow, 'fromWebContents'> | null
  store: CredentialStore
}

// Normalizes and validates a provider credential ID before it is used as a storage key.
function normalizeCredentialId(value: unknown): string {
  const id = String(value || '')
    .trim()
    .toLowerCase()
  if (!CREDENTIAL_ID_PATTERN.test(id)) throw new Error('Invalid credential identifier')
  return id
}

// Writes credential metadata through a uniquely named temporary file so partial writes never
// replace the live store.
function writeJsonAtomically(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const suffix = crypto.randomBytes(8).toString('hex')
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${suffix}.tmp`,
  )
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    fs.renameSync(temporaryPath, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // Windows and unusual filesystems may not support POSIX modes.
    }
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {
      // Preserve the original error.
    }
    throw error
  }
}

// Creates the main-process credential store that encrypts provider keys with Electron safeStorage.
function createCredentialStore({
  app,
  safeStorage,
  platform = process.platform,
}: CredentialStoreOptions = {}): CredentialStore {
  if (!app || !safeStorage) throw new Error('Credential store requires Electron app and safeStorage')

  const electronApp = app
  const electronSafeStorage = safeStorage
  const storePath = (): string => path.join(electronApp.getPath('userData'), STORE_FILENAME)

  // Reports whether the current operating-system encryption backend is safe enough for persistent
  // credentials.
  function status(): CredentialStoreStatus {
    if (!electronApp.isReady()) {
      return {
        available: false,
        persistent: false,
        backend: 'unavailable',
        reason: 'app-not-ready',
      }
    }
    if (!electronSafeStorage.isEncryptionAvailable()) {
      return {
        available: false,
        persistent: false,
        backend: 'unavailable',
        reason: 'os-encryption-unavailable',
      }
    }

    let backend = platform === 'linux' ? 'unknown' : 'os-protected'
    if (platform === 'linux' && typeof electronSafeStorage.getSelectedStorageBackend === 'function') {
      backend = String(electronSafeStorage.getSelectedStorageBackend() || 'unknown')
      if (backend === 'basic_text') {
        return {
          available: false,
          persistent: false,
          backend,
          reason: 'insecure-linux-basic-text-backend',
        }
      }
      if (backend === 'unknown') {
        return {
          available: false,
          persistent: false,
          backend,
          reason: 'linux-secret-store-unavailable',
        }
      }
    }

    return { available: true, persistent: true, backend, reason: '' }
  }

  // Stops credential operations when Electron cannot provide an approved OS-backed encryption
  // backend.
  function assertAvailable(): CredentialStoreStatus {
    const current = status()
    if (!current.available) {
      const error: CodedError = new Error(`Secure credential storage unavailable: ${current.reason}`)
      error.code = current.reason
      throw error
    }
    return current
  }

  // Loads the encrypted credential index while rejecting a symlinked store file.
  function readStore(): CredentialStoreData {
    const filePath = storePath()
    try {
      const fileStats = fs.lstatSync(filePath)
      if (fileStats.isSymbolicLink()) throw new Error('Credential store file must not be a symlink')
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
      const entries =
        parsed &&
        typeof parsed === 'object' &&
        'entries' in parsed &&
        parsed.entries &&
        typeof parsed.entries === 'object'
          ? (parsed.entries as Record<string, unknown>)
          : {}
      return { version: 1, entries: { ...entries } }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        return { version: 1, entries: {} }
      }
      throw error
    }
  }

  // Persists encrypted credential entries with atomic replacement and restrictive file permissions.
  function saveStore(store: CredentialStoreData | null | undefined): void {
    writeJsonAtomically(storePath(), {
      version: 1,
      entries: store && typeof store.entries === 'object' ? store.entries : {},
    })
  }

  // Encrypts and stores one provider credential, removing the entry when the supplied value is
  // empty.
  function set(idInput: unknown, valueInput: unknown): boolean {
    assertAvailable()
    const id = normalizeCredentialId(idInput)
    const value = String(valueInput || '').trim()
    if (!value) return remove(id)
    const store = readStore()
    store.entries[id] = electronSafeStorage.encryptString(value).toString('base64')
    saveStore(store)
    return true
  }

  // Decrypts one provider credential for an authorized renderer request.
  function get(idInput: unknown): string {
    assertAvailable()
    const id = normalizeCredentialId(idInput)
    const store = readStore()
    const encoded = store.entries[id]
    if (!encoded) return ''
    return electronSafeStorage.decryptString(Buffer.from(String(encoded), 'base64'))
  }

  // Deletes one provider credential from the encrypted store.
  function remove(idInput: unknown): boolean {
    assertAvailable()
    const id = normalizeCredentialId(idInput)
    const store = readStore()
    if (!Object.prototype.hasOwnProperty.call(store.entries, id)) return true
    delete store.entries[id]
    saveStore(store)
    return true
  }

  // Lists the provider IDs that currently have encrypted credentials.
  function list(): string[] {
    assertAvailable()
    return Object.keys(readStore().entries).sort()
  }

  return { get, list, remove, set, status, storePath }
}

// Registers the narrow synchronous IPC surface used by the renderer to manage provider credentials.
function registerCredentialIpc({ ipcMain, BrowserWindow, store }: CredentialIpcOptions): void {
  if (!ipcMain || !store) throw new Error('Credential IPC requires ipcMain and a store')

  // Confirms that a credential request originated from an application BrowserWindow.
  function rendererIsAuthorized(event: IpcMainEvent): boolean {
    try {
      return Boolean(BrowserWindow && BrowserWindow.fromWebContents(event.sender))
    } catch {
      return false
    }
  }

  // Writes a normalized credential IPC response without exposing encryption primitives to the
  // renderer.
  function respond(event: IpcMainEvent, operation: () => object): void {
    if (!rendererIsAuthorized(event)) {
      event.returnValue = {
        ok: false,
        error: 'credential-request-not-from-app-window',
      }
      return
    }
    try {
      event.returnValue = { ok: true, ...operation() }
    } catch (error: unknown) {
      const candidate = error as CodedError | null
      event.returnValue = {
        ok: false,
        error: String(candidate?.message || 'Credential operation failed'),
        code: String(candidate?.code || ''),
      }
    }
  }

  ipcMain.on('iris:credential-status', (event) => respond(event, () => store.status()))
  ipcMain.on('iris:credential-list', (event) => respond(event, () => ({ providers: store.list() })))
  ipcMain.on('iris:credential-get', (event, provider: unknown) =>
    respond(event, () => ({ value: store.get(provider) })),
  )
  ipcMain.on('iris:credential-set', (event, provider: unknown, value: unknown) =>
    respond(event, () => ({ saved: store.set(provider, value) })),
  )
  ipcMain.on('iris:credential-delete', (event, provider: unknown) =>
    respond(event, () => ({ deleted: store.remove(provider) })),
  )
}

export {
  CREDENTIAL_ID_PATTERN,
  STORE_FILENAME,
  createCredentialStore,
  normalizeCredentialId,
  registerCredentialIpc,
  writeJsonAtomically,
}
