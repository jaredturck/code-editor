/**
 * Owns IRIS's application-storage master key. The plaintext key exists only in the
 * Electron main process and the in-process bridge; SQLite stores only safeStorage ciphertext.
 */

import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import sqlite3 = require('sqlite3');
import type { App, SafeStorage } from 'electron';

const MASTER_KEY_ID = 'master-v1';
const MASTER_KEY_BYTES = 32;
const DATABASE_FILENAME = 'iris.sqlite3';
const STORAGE_DIRECTORY = '.iris-ai';

interface StorageKeyOptions {
  app: Pick<App, 'getPath' | 'isReady'>;
  safeStorage: Pick<
    SafeStorage,
    'decryptString' | 'encryptString' | 'getSelectedStorageBackend' | 'isEncryptionAvailable'
  >;
  platform?: NodeJS.Platform;
}

const LEGACY_RENDERER_STORAGE_DIRECTORIES = ['Local Storage', 'Session Storage', 'IndexedDB'];

export interface StorageKeyContext {
  databasePath: string;
  masterKey: Buffer;
  backend: string;
}

/**
 * Removes Chromium persistence used by older renderer builds. The desktop application no
 * longer uses Web Storage or IndexedDB for application state, so retaining these directories
 * would leave obsolete plaintext copies behind after the encrypted database cutover.
 */
export function removeLegacyRendererStorage(app: Pick<App, 'getPath'>): void {
  const roots = new Set<string>();
  roots.add(app.getPath('userData'));
  try {
    roots.add(app.getPath('sessionData'));
  } catch {
    // Older Electron releases may not expose a distinct sessionData path.
  }

  for (const root of roots) {
    for (const name of LEGACY_RENDERER_STORAGE_DIRECTORIES) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
}

interface StorageKeyRow {
  wrapped_key: Buffer;
  version: number;
}

function openDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(databasePath, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function exec(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function get<T>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row as T | undefined);
    });
  });
}

function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function close(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function assertSecureStorage(
  app: StorageKeyOptions['app'],
  safeStorage: StorageKeyOptions['safeStorage'],
  platform: NodeJS.Platform,
): string {
  if (!app.isReady()) throw new Error('Application storage cannot initialize before app ready');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Operating-system encryption is unavailable');
  }

  if (platform !== 'linux') return 'os-protected';
  const backend = String(safeStorage.getSelectedStorageBackend?.() || 'unknown');
  if (backend === 'basic_text') {
    throw new Error('Refusing insecure Linux safeStorage basic_text backend');
  }
  if (backend === 'unknown') {
    throw new Error('Linux secret storage backend is unavailable');
  }
  return backend;
}

function assertDatabasePath(databasePath: string): void {
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const stats = fs.lstatSync(databasePath);
    if (stats.isSymbolicLink()) throw new Error('IRIS database must not be a symlink');
    if (!stats.isFile()) throw new Error('IRIS database path is not a regular file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function loadOrCreateStorageKey({
  app,
  safeStorage,
  platform = process.platform,
}: StorageKeyOptions): Promise<StorageKeyContext> {
  const backend = assertSecureStorage(app, safeStorage, platform);
  const databasePath = path.join(app.getPath('home'), STORAGE_DIRECTORY, DATABASE_FILENAME);
  assertDatabasePath(databasePath);

  const databaseExisted = fs.existsSync(databasePath);
  const db = await openDatabase(databasePath);
  try {
    await exec(
      db,
      `PRAGMA trusted_schema = OFF;
       PRAGMA busy_timeout = 5000;
       CREATE TABLE IF NOT EXISTS storage_keys (
         id TEXT PRIMARY KEY,
         wrapped_key BLOB NOT NULL,
         created_at INTEGER NOT NULL,
         version INTEGER NOT NULL
       );`,
    );

    const row = await get<StorageKeyRow>(
      db,
      'SELECT wrapped_key, version FROM storage_keys WHERE id = ?',
      [MASTER_KEY_ID],
    );

    if (row) {
      if (Number(row.version) !== 1) throw new Error('Unsupported storage key version');
      const encoded = safeStorage.decryptString(Buffer.from(row.wrapped_key));
      const masterKey = Buffer.from(encoded, 'base64');
      if (masterKey.length !== MASTER_KEY_BYTES) throw new Error('Stored master key is invalid');
      return { databasePath, masterKey, backend };
    }

    const existingTables = await get<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> 'storage_keys'`,
    );
    if (databaseExisted && Number(existingTables?.count || 0) > 0) {
      throw new Error('Existing encrypted database has no recoverable master key');
    }

    const masterKey = crypto.randomBytes(MASTER_KEY_BYTES);
    const wrappedKey = safeStorage.encryptString(masterKey.toString('base64'));
    await run(
      db,
      `INSERT INTO storage_keys(id, wrapped_key, created_at, version)
       VALUES(?, ?, ?, 1)`,
      [MASTER_KEY_ID, wrappedKey, Date.now()],
    );
    return { databasePath, masterKey, backend };
  } finally {
    await close(db);
    try {
      fs.chmodSync(databasePath, 0o600);
    } catch {
      // Windows and unusual filesystems may not support POSIX modes.
    }
  }
}

export {
  DATABASE_FILENAME,
  LEGACY_RENDERER_STORAGE_DIRECTORIES,
  MASTER_KEY_BYTES,
  MASTER_KEY_ID,
  STORAGE_DIRECTORY,
};
