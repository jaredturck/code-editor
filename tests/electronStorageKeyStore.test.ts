/**
 * Verifies that IRIS stores only an OS-wrapped master key, refuses insecure Linux
 * backends, and clears obsolete Chromium plaintext persistence before desktop startup.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import sqlite3 from 'sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateStorageKey, removeLegacyRendererStorage } from '../electron/platform/storageKeyStore.cts'

const temporaryRoots: string[] = []
const wrappingKey = Buffer.alloc(32, 0x4a)

function fakeSafeStorage(backend = 'kwallet6') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
    },
    decryptString: (value: Buffer) => {
      const nonce = value.subarray(0, 12)
      const tag = value.subarray(12, 28)
      const ciphertext = value.subarray(28)
      const decipher = createDecipheriv('aes-256-gcm', wrappingKey, nonce)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    },
  }
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'iris-storage-key-'))
  temporaryRoots.push(root)
  const paths: Record<string, string> = {
    home: root,
    userData: path.join(root, 'user-data'),
    sessionData: path.join(root, 'session-data'),
  }
  const app = {
    isReady: () => true,
    getPath: (name: string) => paths[name] || root,
  }
  return { root, app }
}

function execSql(databasePath: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(databasePath)
    db.exec(sql, (error) => {
      db.close(() => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

// Builds a pre-rename data home (~/.orbital-ai) with a safeStorage-wrapped master key and an extra
// non-database file, mimicking what an existing install would have on disk before the IRIS rename.
function seedLegacyDataHome(homePath: string, masterKey: Buffer): Promise<void> {
  const legacyDir = path.join(homePath, '.orbital-ai')
  fs.mkdirSync(path.join(legacyDir, 'chats'), { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'chats', 'marker.txt'), 'legacy chat')
  const dbPath = path.join(legacyDir, 'orbital.sqlite3')
  const wrapped = fakeSafeStorage().encryptString(masterKey.toString('base64'))
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath)
    db.serialize(() => {
      db.exec(
        `CREATE TABLE storage_keys (
           id TEXT PRIMARY KEY,
           wrapped_key BLOB NOT NULL,
           created_at INTEGER NOT NULL,
           version INTEGER NOT NULL
         );`,
        (error) => {
          if (error) {
            db.close(() => reject(error))
          }
        },
      )
      db.run(
        'INSERT INTO storage_keys(id, wrapped_key, created_at, version) VALUES(?, ?, ?, 1)',
        ['master-v1', wrapped, Date.now()],
        (error) => {
          db.close(() => (error ? reject(error) : resolve()))
        },
      )
    })
  })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })))
})

describe('Electron application storage key', () => {
  it('persists only safeStorage ciphertext and restores the same master key', async () => {
    const { app } = await fixture()
    const first = await loadOrCreateStorageKey({
      app: app as never,
      safeStorage: fakeSafeStorage() as never,
      platform: 'linux',
    })
    const firstKey = Buffer.from(first.masterKey)
    const databaseBytes = await fsp.readFile(first.databasePath)
    expect(databaseBytes.includes(Buffer.from(firstKey.toString('base64'), 'utf8'))).toBe(false)
    first.masterKey.fill(0)

    const second = await loadOrCreateStorageKey({
      app: app as never,
      safeStorage: fakeSafeStorage() as never,
      platform: 'linux',
    })
    expect(second.masterKey.equals(firstKey)).toBe(true)
    second.masterKey.fill(0)
  })

  it('fails closed when Linux safeStorage selects basic_text', async () => {
    const { app } = await fixture()
    await expect(
      loadOrCreateStorageKey({
        app: app as never,
        safeStorage: fakeSafeStorage('basic_text') as never,
        platform: 'linux',
      }),
    ).rejects.toThrow(/basic_text/i)
  })

  it('does not replace a missing key for an existing encrypted database', async () => {
    const { app } = await fixture()
    const first = await loadOrCreateStorageKey({
      app: app as never,
      safeStorage: fakeSafeStorage() as never,
      platform: 'linux',
    })
    first.masterKey.fill(0)
    await execSql(first.databasePath, 'CREATE TABLE encrypted_store(key TEXT PRIMARY KEY); DELETE FROM storage_keys;')

    await expect(
      loadOrCreateStorageKey({
        app: app as never,
        safeStorage: fakeSafeStorage() as never,
        platform: 'linux',
      }),
    ).rejects.toThrow(/no recoverable master key/i)
  })

  it('migrates the legacy data home to .iris-ai on first run and keeps the original as backup', async () => {
    const { root, app } = await fixture()
    const knownKey = randomBytes(32)
    await seedLegacyDataHome(root, knownKey)

    const ctx = await loadOrCreateStorageKey({
      app: app as never,
      safeStorage: fakeSafeStorage() as never,
      platform: 'linux',
    })

    expect(ctx.databasePath).toBe(path.join(root, '.iris-ai', 'iris.sqlite3'))
    expect(Buffer.from(ctx.masterKey).equals(knownKey)).toBe(true)
    ctx.masterKey.fill(0)

    expect(fs.existsSync(path.join(root, '.iris-ai', 'chats', 'marker.txt'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.orbital-ai', 'orbital.sqlite3'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.iris-ai.migrating'))).toBe(false)
  })

  it('removes obsolete Chromium storage directories before renderer startup', async () => {
    const { app } = await fixture()
    for (const root of [app.getPath('userData'), app.getPath('sessionData')]) {
      for (const name of ['Local Storage', 'Session Storage', 'IndexedDB']) {
        const target = path.join(root, name)
        fs.mkdirSync(target, { recursive: true })
        fs.writeFileSync(path.join(target, 'legacy.txt'), 'plaintext conversation')
      }
    }

    removeLegacyRendererStorage(app as never)

    for (const root of [app.getPath('userData'), app.getPath('sessionData')]) {
      for (const name of ['Local Storage', 'Session Storage', 'IndexedDB']) {
        expect(fs.existsSync(path.join(root, name))).toBe(false)
      }
    }
  })
})
