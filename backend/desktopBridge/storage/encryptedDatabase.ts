/**
 * Owns IRIS's encrypted SQLite schema and repository operations. Sensitive application
 * values are encrypted before insertion and decrypted only in memory for bounded reads,
 * while identifiers, timestamps, counts, and ciphertext sizes remain queryable metadata.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Database as SqliteDatabase } from 'sqlite3';
import {
  decryptBuffer,
  decryptJson,
  decryptText,
  encryptBuffer,
  encryptJson,
  encryptText,
} from './encryption.js';
import type { EncryptedPayload } from './encryption.js';
import {
  ENCRYPTED_DATABASE_COMPATIBILITY_INDEX_SQL,
  ENCRYPTED_DATABASE_SCHEMA_SQL,
  ENCRYPTED_DATABASE_SCHEMA_VERSION_SQL,
} from './encryptedDatabaseSchema.js';

const require = createRequire(import.meta.url);

interface SqliteRuntime {
  Database: new (filename: string) => SqliteDatabase;
  verbose: () => SqliteRuntime;
}

let sqliteRuntime: SqliteRuntime | null = null;

function loadSqliteRuntime(): SqliteRuntime {
  if (sqliteRuntime) return sqliteRuntime;
  const loaded = require('sqlite3') as SqliteRuntime;
  sqliteRuntime = loaded.verbose();
  return sqliteRuntime;
}
const DEFAULT_CHAT_MEMORY =
  '# Chat memory\n\n_(The agent maintains this memory: the original goal, evolving goals, and how they connect — so it never loses the plan.)_\n';
const MAX_CHAT_TITLE_CHARS = 200;
const MAX_CHAT_MESSAGE_CHARS = 200000;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_BASE64_CHARS = 16 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_TOTAL_CHARS = 32 * 1024 * 1024;
const MAX_CHAT_MEMORY_CHARS = 20000;
const MAX_ARTIFACT_CONTENT_CHARS = 24 * 1024 * 1024;
const ARTIFACT_PREVIEW_CHARS = 200000;
const MAX_ARTIFACTS_INDEXED = 500;
const MAX_SUBAGENT_OUTPUT_CHARS = 2 * 1024 * 1024;
const MAX_LAUNCHER_APPLICATIONS = 4000;
const MAX_LAUNCHER_EMBEDDING_DIMENSIONS = 4096;
const MAX_FILE_EMBEDDING_DIMENSIONS = 4096;
const MAX_WEB_SEARCH_SESSION_CHARS = 2 * 1024 * 1024;
const MAX_WEB_SEARCH_HISTORY = 200;

interface RunResult {
  lastID: number;
  changes: number;
}

interface EncryptedRow {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  // camelCase to match the EncryptedPayload shape the decrypt helpers read. The decrypt functions
  // key their namespace/AAD off `keyVersion`, so this MUST carry the row's stored version (mapping
  // it as snake_case here would silently default every read to v1 and break v2 round-trips).
  cipherVersion: number;
  keyVersion: number;
}

interface DatabaseOptions {
  databasePath: string;
  masterKey: Buffer;
}

class IrisEncryptedDatabase {
  db: SqliteDatabase;
  databasePath: string;
  masterKey: Buffer;
  transactionTail: Promise<unknown> = Promise.resolve();

  constructor(databasePath: string, masterKey: Buffer) {
    this.databasePath = databasePath;
    this.masterKey = Buffer.from(masterKey);
    this.db = new (loadSqliteRuntime().Database)(databasePath);
  }

  run(sql: string, params: unknown[] = []): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  /** Reuses one compiled SQLite statement for a bounded sequence of parameter sets. */
  runPreparedMany(sql: string, parameterSets: unknown[][]): Promise<void> {
    if (!parameterSets.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const statement = this.db.prepare(sql, (prepareError) => {
        if (prepareError) {
          reject(prepareError);
          return;
        }
        let index = 0;
        const finalize = (error?: Error | null) => {
          statement.finalize((finalizeError) => {
            if (error) reject(error);
            else if (finalizeError) reject(finalizeError);
            else resolve();
          });
        };
        const runNext = () => {
          if (index >= parameterSets.length) {
            finalize();
            return;
          }
          statement.run(parameterSets[index], (runError) => {
            if (runError) {
              finalize(runError);
              return;
            }
            index += 1;
            runNext();
          });
        };
        runNext();
      });
    });
  }

  get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row as T | undefined);
      });
    });
  }

  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve((rows || []) as T[]);
      });
    });
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.transactionTail.catch(() => undefined);
    await this.exec('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      this.db.close((error) => {
        this.masterKey.fill(0);
        if (error) reject(error);
        else resolve();
      });
    });
  }

  transaction<T>(operation: () => Promise<T>): Promise<T> {
    const transaction = this.transactionTail.then(async () => {
      await this.run('BEGIN IMMEDIATE');
      try {
        const result = await operation();
        await this.run('COMMIT');
        return result;
      } catch (error) {
        await this.run('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
    this.transactionTail = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  async ensureColumn(table: string, column: string, definition: string): Promise<void> {
    const columns = await this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((item) => item.name === column)) return;
    await this.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), {
      recursive: true,
      mode: 0o700,
    });
    await this.exec(ENCRYPTED_DATABASE_SCHEMA_SQL);
    await this.ensureColumn('filesystem_nodes', 'node_type', "TEXT NOT NULL DEFAULT 'file'");
    await this.ensureColumn('filesystem_nodes', 'content_kind', "TEXT NOT NULL DEFAULT 'binary'");
    await this.ensureColumn('filesystem_nodes', 'size_bytes', 'INTEGER NOT NULL DEFAULT 0');
    await this.ensureColumn('filesystem_nodes', 'modified_at', 'INTEGER NOT NULL DEFAULT 0');
    await this.ensureColumn('filesystem_nodes', 'indexed_at', 'INTEGER NOT NULL DEFAULT 0');
    await this.ensureColumn('filesystem_nodes', 'scan_order', 'INTEGER NOT NULL DEFAULT 0');
    await this.exec(ENCRYPTED_DATABASE_COMPATIBILITY_INDEX_SQL);
    await this.run(ENCRYPTED_DATABASE_SCHEMA_VERSION_SQL);
    try {
      await fs.chmod(this.databasePath, 0o600);
    } catch {
      // Windows and unusual filesystems may not support POSIX modes.
    }
  }

  payloadFromRow(row: Record<string, unknown>, prefix = ''): EncryptedRow {
    return {
      ciphertext: Buffer.from(row[`${prefix}ciphertext`] as Buffer),
      nonce: Buffer.from(row[`${prefix}nonce`] as Buffer),
      tag: Buffer.from(row[`${prefix}tag`] as Buffer),
      cipherVersion: Number(row[`${prefix}cipher_version`] || 1),
      keyVersion: Number(row[`${prefix}key_version`] || 1),
    };
  }
}

let database: IrisEncryptedDatabase | null = null;

function requireDatabase(): IrisEncryptedDatabase {
  if (!database) throw new Error('Encrypted storage is not initialized');
  return database;
}

export async function initializeEncryptedDatabase({
  databasePath,
  masterKey,
}: DatabaseOptions): Promise<void> {
  if (!databasePath) throw new Error('Encrypted storage database path is required');
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('Encrypted storage master key must be 32 bytes');
  }
  if (database) await closeEncryptedDatabase();
  const next = new IrisEncryptedDatabase(databasePath, masterKey);
  try {
    await next.initialize();
    database = next;
  } catch (error) {
    await next.close().catch(() => undefined);
    throw error;
  }
}

export async function closeEncryptedDatabase(): Promise<void> {
  const current = database;
  database = null;
  if (current) await current.close();
}

export function encryptedDatabasePath(): string {
  return requireDatabase().databasePath;
}

export async function writeEncryptedStoreKey(key: string, value: unknown): Promise<void> {
  const db = requireDatabase();
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) throw new Error('Storage key required');
  const payload = encryptText(db.masterKey, 'store', normalizedKey, 'value', value);
  await db.run(
    `INSERT INTO encrypted_store(
       key, ciphertext, nonce, tag, cipher_version, key_version, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       nonce = excluded.nonce,
       tag = excluded.tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       updated_at = excluded.updated_at`,
    [
      normalizedKey,
      payload.ciphertext,
      payload.nonce,
      payload.tag,
      payload.cipherVersion,
      payload.keyVersion,
      Date.now(),
    ],
  );
}

export async function deleteEncryptedStoreKey(key: string): Promise<void> {
  await requireDatabase().run('DELETE FROM encrypted_store WHERE key = ?', [String(key || '')]);
}

export async function readEncryptedStoreAll(): Promise<Record<string, string>> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT key, ciphertext, nonce, tag, cipher_version, key_version
     FROM encrypted_store`,
  );
  const values: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row.key || '');
    if (!key) continue;
    values[key] = decryptText(db.masterKey, 'store', key, 'value', db.payloadFromRow(row));
  }
  return values;
}

function newWebSearchSessionId(): string {
  return `w${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function sanitizeWebSearchSessionId(id: unknown): string {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

function normalizeWebSearchPayload(value: unknown): Record<string, unknown> {
  const payload =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_WEB_SEARCH_SESSION_CHARS) {
    throw new Error('Saved web search is too large');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function webSearchDisplayFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const query = String(payload.query || '')
    .trim()
    .slice(0, 600);
  const title = String(payload.title || query || 'Saved search')
    .trim()
    .slice(0, 160);
  const quick =
    payload.quick && typeof payload.quick === 'object'
      ? (payload.quick as Record<string, unknown>)
      : {};
  const detailed =
    payload.detailed && typeof payload.detailed === 'object'
      ? (payload.detailed as Record<string, unknown>)
      : {};
  return {
    query,
    title,
    quickStatus: String(quick.status || 'idle').slice(0, 32),
    detailedStatus: String(detailed.status || 'idle').slice(0, 32),
  };
}

export async function listEncryptedWebSearchSessions(
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const db = requireDatabase();
  const boundedLimit = Math.max(
    1,
    Math.min(MAX_WEB_SEARCH_HISTORY, Math.round(Number(limit) || 100)),
  );
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, display_ciphertext, display_nonce, display_tag,
            cipher_version AS display_cipher_version,
            key_version AS display_key_version, created_at, updated_at
     FROM web_search_sessions
     ORDER BY updated_at DESC
     LIMIT ?`,
    [boundedLimit],
  );
  return rows.map((row) => {
    const id = String(row.id || '');
    const display = decryptJson<Record<string, unknown>>(
      db.masterKey,
      'web-search-display',
      id,
      'display',
      db.payloadFromRow(row, 'display_'),
    );
    return {
      id,
      ...display,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  });
}

export async function createEncryptedWebSearchSession(
  value: unknown,
): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const payload = normalizeWebSearchPayload(value);
  const id = newWebSearchSessionId();
  const now = Date.now();
  const display = webSearchDisplayFromPayload(payload);
  const displayPayload = encryptJson(db.masterKey, 'web-search-display', id, 'display', display);
  const sessionPayload = encryptJson(db.masterKey, 'web-search-payload', id, 'payload', payload);
  await db.run(
    `INSERT INTO web_search_sessions(
       id, display_ciphertext, display_nonce, display_tag,
       payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      displayPayload.ciphertext,
      displayPayload.nonce,
      displayPayload.tag,
      sessionPayload.ciphertext,
      sessionPayload.nonce,
      sessionPayload.tag,
      sessionPayload.cipherVersion,
      sessionPayload.keyVersion,
      now,
      now,
    ],
  );
  await db.run(
    `DELETE FROM web_search_sessions
     WHERE id IN (
       SELECT id FROM web_search_sessions
       ORDER BY updated_at DESC, created_at DESC
       LIMIT -1 OFFSET ?
     )`,
    [MAX_WEB_SEARCH_HISTORY],
  );
  return { id, ...display, createdAt: now, updatedAt: now };
}

export async function getEncryptedWebSearchSession(
  id: unknown,
): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const sessionId = sanitizeWebSearchSessionId(id);
  if (!sessionId) throw new Error('web search session id required');
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext, payload_nonce AS nonce,
            payload_tag AS tag, cipher_version, key_version, created_at, updated_at
     FROM web_search_sessions WHERE id = ?`,
    [sessionId],
  );
  if (!row) return null;
  const payload = decryptJson<Record<string, unknown>>(
    db.masterKey,
    'web-search-payload',
    sessionId,
    'payload',
    db.payloadFromRow(row),
  );
  return {
    id: sessionId,
    ...payload,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

export async function upsertEncryptedWebSearchSession(
  id: unknown,
  value: unknown,
): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const sessionId = sanitizeWebSearchSessionId(id);
  if (!sessionId) throw new Error('web search session id required');
  const exists = await db.get<{ id: string }>('SELECT id FROM web_search_sessions WHERE id = ?', [
    sessionId,
  ]);
  if (!exists) throw new Error('web search session not found');
  const payload = normalizeWebSearchPayload(value);
  const display = webSearchDisplayFromPayload(payload);
  const displayPayload = encryptJson(
    db.masterKey,
    'web-search-display',
    sessionId,
    'display',
    display,
  );
  const sessionPayload = encryptJson(
    db.masterKey,
    'web-search-payload',
    sessionId,
    'payload',
    payload,
  );
  const updatedAt = Date.now();
  await db.run(
    `UPDATE web_search_sessions SET
       display_ciphertext = ?, display_nonce = ?, display_tag = ?,
       payload_ciphertext = ?, payload_nonce = ?, payload_tag = ?,
       cipher_version = ?, key_version = ?, updated_at = ?
     WHERE id = ?`,
    [
      displayPayload.ciphertext,
      displayPayload.nonce,
      displayPayload.tag,
      sessionPayload.ciphertext,
      sessionPayload.nonce,
      sessionPayload.tag,
      sessionPayload.cipherVersion,
      sessionPayload.keyVersion,
      updatedAt,
      sessionId,
    ],
  );
  return { id: sessionId, ...display, updatedAt };
}

export async function duplicateEncryptedWebSearchSession(
  id: unknown,
): Promise<Record<string, unknown>> {
  const original = await getEncryptedWebSearchSession(id);
  if (!original) throw new Error('web search session not found');
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = original;
  const query = String(payload.query || '').trim();
  return createEncryptedWebSearchSession({
    ...payload,
    title: `${String(payload.title || query || 'Saved search').replace(/ \(Copy\)$/i, '')} (Copy)`,
  });
}

export async function deleteEncryptedWebSearchSession(id: unknown): Promise<number> {
  const sessionId = sanitizeWebSearchSessionId(id);
  if (!sessionId) throw new Error('web search session id required');
  const result = await requireDatabase().run('DELETE FROM web_search_sessions WHERE id = ?', [
    sessionId,
  ]);
  return result.changes;
}

export async function clearEncryptedWebSearchSessions(): Promise<number> {
  const result = await requireDatabase().run('DELETE FROM web_search_sessions');
  return result.changes;
}

function newChatId(): string {
  return `c${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function newArtifactId(): string {
  return `a${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function sanitizeChatId(id: unknown): string {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

function sanitizeTaskId(id: unknown): string {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

function sanitizeArtifactFilename(name: unknown): string {
  const base = String(name || '')
    .replace(/^.*[\\/]/, '')
    .trim();
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || `artifact-${Date.now()}.txt`;
}

async function encryptedChatDisplay(
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const id = String(row.id || '');
  return decryptJson<Record<string, unknown>>(
    db.masterKey,
    'chat-display',
    id,
    'display',
    db.payloadFromRow(row, 'display_'),
  );
}

export async function listEncryptedChats(): Promise<Record<string, unknown>[]> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, display_ciphertext, display_nonce, display_tag,
            cipher_version AS display_cipher_version,
            key_version AS display_key_version,
            created_at, updated_at, message_count
     FROM chats
     ORDER BY updated_at DESC`,
  );
  const chats: Record<string, unknown>[] = [];
  for (const row of rows) {
    const display = await encryptedChatDisplay(row);
    chats.push({
      id: String(row.id || ''),
      title: String(display.title || 'New chat'),
      provider: String(display.provider || ''),
      model: String(display.model || ''),
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
      messageCount: Number(row.message_count || 0),
    });
  }
  return chats;
}

export async function createEncryptedChat({
  title,
  provider,
  model,
}: {
  title?: unknown;
  provider?: unknown;
  model?: unknown;
} = {}): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const id = newChatId();
  const now = Date.now();
  const display = {
    title: String(title || 'New chat').slice(0, MAX_CHAT_TITLE_CHARS),
    provider: String(provider || ''),
    model: String(model || ''),
  };
  const encryptedDisplay = encryptJson(db.masterKey, 'chat-display', id, 'display', display);
  const state = encryptJson(db.masterKey, 'chat-state', id, 'state', {
    memory: DEFAULT_CHAT_MEMORY,
    compacted: '',
  });
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO chats(
         id, display_ciphertext, display_nonce, display_tag,
         cipher_version, key_version, created_at, updated_at, message_count
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        encryptedDisplay.ciphertext,
        encryptedDisplay.nonce,
        encryptedDisplay.tag,
        encryptedDisplay.cipherVersion,
        encryptedDisplay.keyVersion,
        now,
        now,
      ],
    );
    await db.run(
      `INSERT INTO chat_state(
         chat_id, payload_ciphertext, payload_nonce, payload_tag,
         cipher_version, key_version, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [id, state.ciphertext, state.nonce, state.tag, state.cipherVersion, state.keyVersion, now],
    );
  });
  return { id, ...display, createdAt: now, updatedAt: now, messageCount: 0 };
}

async function chatExists(id: string): Promise<boolean> {
  const row = await requireDatabase().get<{ id: string }>('SELECT id FROM chats WHERE id = ?', [
    id,
  ]);
  return Boolean(row?.id);
}

function sanitizeChatAttachments(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const output: Array<Record<string, unknown>> = [];
  let totalChars = 0;
  for (const raw of value.slice(0, MAX_CHAT_ATTACHMENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as Record<string, unknown>;
    const name = String(input.name || '').slice(0, 240);
    const type = String(input.type || '').toLowerCase();
    const content = String(input.content || '');
    if (!name || !content || !type.startsWith('image/')) continue;
    if (content.length > MAX_CHAT_ATTACHMENT_BASE64_CHARS) continue;
    if (totalChars + content.length > MAX_CHAT_ATTACHMENT_TOTAL_CHARS) break;
    totalChars += content.length;
    output.push({
      id: String(input.id || '').slice(0, 240),
      name,
      type,
      content,
      width: Math.max(0, Math.min(10000, Number(input.width) || 0)) || undefined,
      height: Math.max(0, Math.min(10000, Number(input.height) || 0)) || undefined,
      size: Math.max(0, Number(input.size) || 0) || undefined,
    });
  }
  return output;
}

export async function appendEncryptedChatMessage(id: unknown, message: unknown): Promise<void> {
  const db = requireDatabase();
  const chatId = sanitizeChatId(id);
  if (!chatId) throw new Error('chat id required');
  if (!(await chatExists(chatId))) throw new Error('chat not found');
  const input = message && typeof message === 'object' ? (message as Record<string, unknown>) : {};
  const payloadValue: Record<string, unknown> = {
    role: String(input.role || 'user'),
    content: String(input.content ?? '').slice(0, MAX_CHAT_MESSAGE_CHARS),
    ts: Date.now(),
  };
  // Persist the message's presentation metadata (the run timeline, model attribution, notice,
  // artifacts) so previous timelines survive a reload. Callers bound the timeline size before
  // sending; the whole payload is encrypted at rest.
  if (input.meta && typeof input.meta === 'object') {
    payloadValue.meta = input.meta;
  }
  const attachments = sanitizeChatAttachments(input.attachments);
  if (attachments.length) payloadValue.attachments = attachments;
  await db.transaction(async () => {
    const sequenceRow = await db.get<{ next_sequence: number }>(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM chat_messages WHERE chat_id = ?',
      [chatId],
    );
    const sequence = Number(sequenceRow?.next_sequence || 1);
    const recordId = `${chatId}:${sequence}`;
    const encrypted = encryptJson(db.masterKey, 'chat-message', recordId, 'payload', payloadValue);
    await db.run(
      `INSERT INTO chat_messages(
         chat_id, sequence, created_at,
         payload_ciphertext, payload_nonce, payload_tag,
         cipher_version, key_version
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chatId,
        sequence,
        payloadValue.ts,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.tag,
        encrypted.cipherVersion,
        encrypted.keyVersion,
      ],
    );
    await db.run(
      `UPDATE chats
       SET updated_at = ?, message_count = message_count + 1
       WHERE id = ?`,
      [Date.now(), chatId],
    );
  });
}

async function readChatState(chatId: string): Promise<{ memory: string; compacted: string }> {
  const db = requireDatabase();
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM chat_state WHERE chat_id = ?`,
    [chatId],
  );
  if (!row) return { memory: DEFAULT_CHAT_MEMORY, compacted: '' };
  const value = decryptJson<Record<string, unknown>>(
    db.masterKey,
    'chat-state',
    chatId,
    'state',
    db.payloadFromRow(row),
  );
  return {
    memory: String(value.memory || ''),
    compacted: String(value.compacted || ''),
  };
}

async function writeChatState(
  chatId: string,
  value: { memory: string; compacted: string },
): Promise<void> {
  const db = requireDatabase();
  const encrypted = encryptJson(db.masterKey, 'chat-state', chatId, 'state', value);
  await db.run(
    `INSERT INTO chat_state(
       chat_id, payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       payload_ciphertext = excluded.payload_ciphertext,
       payload_nonce = excluded.payload_nonce,
       payload_tag = excluded.payload_tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       updated_at = excluded.updated_at`,
    [
      chatId,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      Date.now(),
    ],
  );
}

export async function getEncryptedChat(id: unknown): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const chatId = sanitizeChatId(id);
  if (!chatId) throw new Error('chat id required');
  const meta = (await listEncryptedChats()).find((chat) => chat.id === chatId) || null;
  if (!meta) return null;
  const rows = await db.all<Record<string, unknown>>(
    `SELECT sequence,
            payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM chat_messages
     WHERE chat_id = ?
     ORDER BY sequence ASC`,
    [chatId],
  );
  const messages = rows.map((row) =>
    decryptJson<Record<string, unknown>>(
      db.masterKey,
      'chat-message',
      `${chatId}:${Number(row.sequence || 0)}`,
      'payload',
      db.payloadFromRow(row),
    ),
  );
  const state = await readChatState(chatId);
  return { meta, messages, compacted: state.compacted, paths: {} };
}

export async function saveEncryptedChatCompacted(id: unknown, content: unknown): Promise<void> {
  const chatId = sanitizeChatId(id);
  if (!chatId || !(await chatExists(chatId))) throw new Error('chat not found');
  const state = await readChatState(chatId);
  state.compacted = String(content ?? '');
  await writeChatState(chatId, state);
}

export async function setEncryptedChatTitle(id: unknown, title: unknown): Promise<string> {
  const db = requireDatabase();
  const chatId = sanitizeChatId(id);
  if (!chatId) throw new Error('chat id required');
  const row = await db.get<Record<string, unknown>>(
    `SELECT id, display_ciphertext, display_nonce, display_tag,
            cipher_version AS display_cipher_version,
            key_version AS display_key_version
     FROM chats WHERE id = ?`,
    [chatId],
  );
  if (!row) throw new Error('chat not found');
  const display = await encryptedChatDisplay(row);
  display.title = String(title || '').slice(0, MAX_CHAT_TITLE_CHARS) || display.title;
  const encrypted = encryptJson(db.masterKey, 'chat-display', chatId, 'display', display);
  await db.run(
    `UPDATE chats SET
       display_ciphertext = ?, display_nonce = ?, display_tag = ?,
       cipher_version = ?, key_version = ?, updated_at = ?
     WHERE id = ?`,
    [
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      Date.now(),
      chatId,
    ],
  );
  return String(display.title || 'New chat');
}

export async function deleteEncryptedChat(id: unknown): Promise<number> {
  const chatId = sanitizeChatId(id);
  if (!chatId) throw new Error('chat id required');
  const result = await requireDatabase().run('DELETE FROM chats WHERE id = ?', [chatId]);
  return result.changes;
}

export async function readEncryptedChatMemory(id: unknown): Promise<string> {
  const chatId = sanitizeChatId(id);
  if (!chatId || !(await chatExists(chatId))) return '';
  return (await readChatState(chatId)).memory;
}

export async function writeEncryptedChatMemory(
  id: unknown,
  content: unknown,
  { append = false }: { append?: boolean } = {},
): Promise<void> {
  const chatId = sanitizeChatId(id);
  if (!chatId || !(await chatExists(chatId))) throw new Error('chat not found');
  const state = await readChatState(chatId);
  const next = String(content ?? '').slice(0, MAX_CHAT_MEMORY_CHARS);
  state.memory = append
    ? `${state.memory}${next.endsWith('\n') ? next : `${next}\n`}`.slice(-MAX_CHAT_MEMORY_CHARS)
    : next;
  await writeChatState(chatId, state);
}

export async function readEncryptedChatRecall(id: unknown, scope = 'compacted'): Promise<string> {
  const chatId = sanitizeChatId(id);
  if (!chatId || !(await chatExists(chatId))) return '';
  if (scope !== 'full') return (await readChatState(chatId)).compacted;
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT sequence,
            payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM chat_messages
     WHERE chat_id = ?
     ORDER BY sequence DESC
     LIMIT 40`,
    [chatId],
  );
  return rows
    .reverse()
    .map((row) => {
      const message = decryptJson<Record<string, unknown>>(
        db.masterKey,
        'chat-message',
        `${chatId}:${Number(row.sequence || 0)}`,
        'payload',
        db.payloadFromRow(row),
      );
      return `${String(message.role || '')}: ${String(message.content || '')}`;
    })
    .join('\n')
    .slice(-MAX_CHAT_MEMORY_CHARS);
}

async function readArtifactContent(id: string): Promise<string> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT chunk_index,
            payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM artifact_chunks
     WHERE artifact_id = ?
     ORDER BY chunk_index ASC`,
    [id],
  );
  return rows
    .map((row) =>
      decryptText(
        db.masterKey,
        'artifact-chunk',
        `${id}:${Number(row.chunk_index || 0)}`,
        'content',
        db.payloadFromRow(row),
      ),
    )
    .join('');
}

async function artifactDescriptor(
  row: Record<string, unknown>,
  includePreview: boolean,
): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const id = String(row.id || '');
  const metadata = decryptJson<Record<string, unknown>>(
    db.masterKey,
    'artifact-metadata',
    id,
    'metadata',
    db.payloadFromRow(row, 'metadata_'),
  );
  const descriptor: Record<string, unknown> = {
    id,
    ...metadata,
    path: `iris-artifact:${id}`,
    bytes: Number(row.byte_length || 0),
    createdAt: Number(row.updated_at || row.created_at || 0),
  };
  if (includePreview) {
    descriptor.preview = (await readArtifactContent(id)).slice(0, ARTIFACT_PREVIEW_CHARS);
  }
  return descriptor;
}

export async function saveEncryptedArtifact({
  filename,
  content,
  summary,
  type,
  chatId,
  append,
}: {
  filename?: unknown;
  content?: unknown;
  summary?: unknown;
  type?: unknown;
  chatId?: unknown;
  append?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const db = requireDatabase();
  const safeName = sanitizeArtifactFilename(filename);
  const text = String(content ?? '');
  const normalizedChatId = sanitizeChatId(chatId);
  let row: Record<string, unknown> | undefined;
  if (append) {
    const rows = await db.all<Record<string, unknown>>(
      `SELECT id, metadata_ciphertext, metadata_nonce, metadata_tag,
              cipher_version AS metadata_cipher_version,
              key_version AS metadata_key_version,
              byte_length, chunk_count, created_at, updated_at
       FROM artifacts
       WHERE (? = '' OR chat_id = ?)
       ORDER BY updated_at DESC`,
      [normalizedChatId, normalizedChatId],
    );
    for (const candidate of rows) {
      const descriptor = await artifactDescriptor(candidate, false);
      if (descriptor.filename === safeName) {
        row = candidate;
        break;
      }
    }
  }

  if (row) {
    const id = String(row.id || '');
    const before = Number(row.byte_length || 0);
    const room = Math.max(0, MAX_ARTIFACT_CONTENT_CHARS - before);
    const chunk = room > 0 ? text.slice(0, room) : '';
    if (chunk) {
      const chunkIndex = Number(row.chunk_count || 0);
      const encryptedChunk = encryptText(
        db.masterKey,
        'artifact-chunk',
        `${id}:${chunkIndex}`,
        'content',
        chunk,
      );
      const metadata = await artifactDescriptor(row, false);
      metadata.summary = summary ? String(summary).slice(0, 200) : metadata.summary;
      delete metadata.id;
      delete metadata.path;
      delete metadata.bytes;
      delete metadata.createdAt;
      const encryptedMetadata = encryptJson(
        db.masterKey,
        'artifact-metadata',
        id,
        'metadata',
        metadata,
      );
      await db.transaction(async () => {
        await db.run(
          `INSERT INTO artifact_chunks(
             artifact_id, chunk_index, payload_ciphertext, payload_nonce, payload_tag,
             cipher_version, key_version
           ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            chunkIndex,
            encryptedChunk.ciphertext,
            encryptedChunk.nonce,
            encryptedChunk.tag,
            encryptedChunk.cipherVersion,
            encryptedChunk.keyVersion,
          ],
        );
        await db.run(
          `UPDATE artifacts SET
             metadata_ciphertext = ?, metadata_nonce = ?, metadata_tag = ?,
             cipher_version = ?, key_version = ?, byte_length = ?,
             chunk_count = chunk_count + 1, updated_at = ?
           WHERE id = ?`,
          [
            encryptedMetadata.ciphertext,
            encryptedMetadata.nonce,
            encryptedMetadata.tag,
            encryptedMetadata.cipherVersion,
            encryptedMetadata.keyVersion,
            before + Buffer.byteLength(chunk, 'utf8'),
            Date.now(),
            id,
          ],
        );
      });
    }
    const updated = await db.get<Record<string, unknown>>(
      `SELECT id, metadata_ciphertext, metadata_nonce, metadata_tag,
              cipher_version AS metadata_cipher_version,
              key_version AS metadata_key_version,
              byte_length, chunk_count, created_at, updated_at
       FROM artifacts WHERE id = ?`,
      [id],
    );
    return {
      ...(await artifactDescriptor(updated || row, true)),
      appended: true,
      capReached: room <= 0,
    };
  }

  const id = newArtifactId();
  const capped = text.slice(0, MAX_ARTIFACT_CONTENT_CHARS);
  const now = Date.now();
  const ext = (safeName.split('.').pop() || 'txt').toLowerCase();
  const metadata = {
    filename: safeName,
    type: String(type || ext).toLowerCase(),
    summary: String(summary || '').slice(0, 200),
    chatId: normalizedChatId,
  };
  const encryptedMetadata = encryptJson(
    db.masterKey,
    'artifact-metadata',
    id,
    'metadata',
    metadata,
  );
  const encryptedChunk = encryptText(db.masterKey, 'artifact-chunk', `${id}:0`, 'content', capped);
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO artifacts(
         id, chat_id, metadata_ciphertext, metadata_nonce, metadata_tag,
         cipher_version, key_version, byte_length, chunk_count, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        normalizedChatId || null,
        encryptedMetadata.ciphertext,
        encryptedMetadata.nonce,
        encryptedMetadata.tag,
        encryptedMetadata.cipherVersion,
        encryptedMetadata.keyVersion,
        Buffer.byteLength(capped, 'utf8'),
        now,
        now,
      ],
    );
    await db.run(
      `INSERT INTO artifact_chunks(
         artifact_id, chunk_index, payload_ciphertext, payload_nonce, payload_tag,
         cipher_version, key_version
       ) VALUES(?, 0, ?, ?, ?, ?, ?)`,
      [
        id,
        encryptedChunk.ciphertext,
        encryptedChunk.nonce,
        encryptedChunk.tag,
        encryptedChunk.cipherVersion,
        encryptedChunk.keyVersion,
      ],
    );
  });
  const rowCreated = await db.get<Record<string, unknown>>(
    `SELECT id, metadata_ciphertext, metadata_nonce, metadata_tag,
            cipher_version AS metadata_cipher_version,
            key_version AS metadata_key_version,
            byte_length, chunk_count, created_at, updated_at
     FROM artifacts WHERE id = ?`,
    [id],
  );
  return artifactDescriptor(rowCreated || { id }, true);
}

export async function listEncryptedArtifacts({
  limit,
  chatId,
}: { limit?: unknown; chatId?: unknown } = {}): Promise<Record<string, unknown>[]> {
  const db = requireDatabase();
  const cap = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(MAX_ARTIFACTS_INDEXED, Number(limit)))
    : 200;
  const normalizedChatId = sanitizeChatId(chatId);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, metadata_ciphertext, metadata_nonce, metadata_tag,
            cipher_version AS metadata_cipher_version,
            key_version AS metadata_key_version,
            byte_length, chunk_count, created_at, updated_at
     FROM artifacts
     WHERE (? = '' OR chat_id = ?)
     ORDER BY updated_at DESC
     LIMIT ?`,
    [normalizedChatId, normalizedChatId, cap],
  );
  const result: Record<string, unknown>[] = [];
  for (const row of rows) result.push(await artifactDescriptor(row, false));
  return result;
}

export async function readEncryptedArtifact(id: unknown): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const artifactId = String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  if (!artifactId) return null;
  const row = await db.get<Record<string, unknown>>(
    `SELECT id, metadata_ciphertext, metadata_nonce, metadata_tag,
            cipher_version AS metadata_cipher_version,
            key_version AS metadata_key_version,
            byte_length, chunk_count, created_at, updated_at
     FROM artifacts WHERE id = ?`,
    [artifactId],
  );
  if (!row) return null;
  return {
    ...(await artifactDescriptor(row, false)),
    content: await readArtifactContent(artifactId),
  };
}

export async function writeEncryptedSubagentOutput(
  taskId: unknown,
  content: unknown,
): Promise<string> {
  const db = requireDatabase();
  const id = sanitizeTaskId(taskId);
  if (!id) throw new Error('task id required');
  const encrypted = encryptText(
    db.masterKey,
    'subagent-output',
    id,
    'content',
    String(content ?? '').slice(0, MAX_SUBAGENT_OUTPUT_CHARS),
  );
  await db.run(
    `INSERT INTO subagent_outputs(
       task_id, payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, created_at, expires_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET
       payload_ciphertext = excluded.payload_ciphertext,
       payload_nonce = excluded.payload_nonce,
       payload_tag = excluded.payload_tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
    [
      id,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      Date.now(),
      Date.now() + 24 * 60 * 60 * 1000,
    ],
  );
  return id;
}

export async function readEncryptedSubagentOutput(taskId: unknown): Promise<string> {
  const db = requireDatabase();
  const id = sanitizeTaskId(taskId);
  if (!id) return '';
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM subagent_outputs WHERE task_id = ?`,
    [id],
  );
  if (!row) return '';
  return decryptText(db.masterKey, 'subagent-output', id, 'content', db.payloadFromRow(row));
}

export async function listEncryptedUserSkills(profile: string): Promise<Record<string, unknown>[]> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT skill_id,
            payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM user_skills WHERE profile = ?`,
    [profile],
  );
  return rows.map((row) =>
    decryptJson<Record<string, unknown>>(
      db.masterKey,
      'user-skill',
      `${profile}:${String(row.skill_id || '')}`,
      'payload',
      db.payloadFromRow(row),
    ),
  );
}

export async function listEncryptedSkillProfiles(): Promise<string[]> {
  const rows = await requireDatabase().all<{ profile: string }>(
    'SELECT DISTINCT profile FROM user_skills ORDER BY profile ASC',
  );
  return rows.map((row) => String(row.profile || '')).filter(Boolean);
}

export async function upsertEncryptedUserSkill(
  profile: string,
  skillId: string,
  payloadValue: Record<string, unknown>,
): Promise<void> {
  const db = requireDatabase();
  const recordId = `${profile}:${skillId}`;
  const encrypted = encryptJson(db.masterKey, 'user-skill', recordId, 'payload', payloadValue);
  const now = Date.now();
  await db.run(
    `INSERT INTO user_skills(
       profile, skill_id, payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile, skill_id) DO UPDATE SET
       payload_ciphertext = excluded.payload_ciphertext,
       payload_nonce = excluded.payload_nonce,
       payload_tag = excluded.payload_tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       updated_at = excluded.updated_at`,
    [
      profile,
      skillId,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      now,
      now,
    ],
  );
}

export async function deleteEncryptedUserSkill(profile: string, skillId: string): Promise<void> {
  await requireDatabase().run('DELETE FROM user_skills WHERE profile = ? AND skill_id = ?', [
    profile,
    skillId,
  ]);
}

export type EncryptedFilesystemContentKind =
  | 'directory'
  | 'text'
  | 'document'
  | 'pdf'
  | 'image'
  | 'video'
  | 'binary';

export interface EncryptedFilesystemNodeInput {
  id: string;
  parentId: string | null;
  nodeType: 'file' | 'directory';
  contentKind: EncryptedFilesystemContentKind;
  sizeBytes: number;
  modifiedAt: number;
  indexedAt: number;
  scanOrder?: number;
  metadata: Record<string, unknown>;
}

export interface EncryptedFilesystemNodeRecord extends EncryptedFilesystemNodeInput {}

export interface EncryptedFilesystemNodePageOptions {
  contentKind: Exclude<EncryptedFilesystemContentKind, 'directory'>;
  indexedAt?: number;
  minSizeBytes?: number;
  afterId?: string;
  afterScanOrder?: number;
  orderByScan?: boolean;
  limit: number;
  orderBySize?: boolean;
}

export interface EncryptedFileSemanticInput {
  fileId: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export interface EncryptedFileSemanticRecord extends EncryptedFileSemanticInput {}

export interface PreparedEncryptedFileSemanticRecord {
  fileId: string;
  embeddingBuffer: Buffer;
  encryptedMetadata: EncryptedPayload;
  encryptedEmbedding: EncryptedPayload;
}

export interface EncryptedVideoFrameSemanticInput {
  semanticId: string;
  fileId: string;
  timestampMs: number;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export interface EncryptedVideoFrameSemanticRecord extends EncryptedVideoFrameSemanticInput {}

export type EncryptedFileConceptEmbeddingSpace = 'minilm' | 'clip';

export interface EncryptedFileConceptVectorRecord {
  sourceSemanticId: string;
  fileId: string;
  timestampMs?: number;
  embedding: Float32Array;
}

export interface EncryptedFileConceptVectorPageOptions {
  embeddingSpace: EncryptedFileConceptEmbeddingSpace;
  source: 'file' | 'video';
  rootNodeId: string;
  afterId?: string;
  afterScanOrder?: number;
  orderByScan?: boolean;
  limit: number;
}

export interface EncryptedFileConceptSourceStats {
  vectorCount: number;
  fileCount: number;
}

export interface EncryptedFileConceptInput {
  id: string;
  generation: string;
  embeddingSpace: EncryptedFileConceptEmbeddingSpace;
  metadata: Record<string, unknown>;
  centroid: Float32Array;
  memberCount?: number;
  cohesion?: number;
}

export interface EncryptedFileConceptRecord extends EncryptedFileConceptInput {
  memberCount: number;
  cohesion: number;
}

export interface EncryptedFileConceptMembershipInput {
  conceptId: string;
  generation: string;
  fileId: string;
  sourceSemanticId: string;
  timestampMs?: number;
  similarity: number;
}

export interface EncryptedFileConceptMembershipRecord extends EncryptedFileConceptMembershipInput {}

/** Encodes one bounded embedding as the little-endian float buffer stored by SQLite. */
export function encodeFileEmbedding(values: ArrayLike<number>): Buffer {
  const length = Math.min(
    MAX_FILE_EMBEDDING_DIMENSIONS,
    Math.max(0, Math.floor(Number(values.length) || 0)),
  );
  if (!length) throw new Error('File embedding is required');
  const buffer = Buffer.allocUnsafe(length * 4);
  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index]);
    buffer.writeFloatLE(Number.isFinite(value) ? value : 0, index * 4);
  }
  return buffer;
}

function fileEmbeddingValues(buffer: Buffer, dimension: number): number[] {
  return Array.from(fileEmbeddingFloat32Values(buffer, dimension));
}

function fileEmbeddingFloat32Values(buffer: Buffer, dimension: number): Float32Array {
  const boundedDimension = Math.max(
    0,
    Math.min(MAX_FILE_EMBEDDING_DIMENSIONS, Math.floor(Number(dimension) || 0)),
  );
  if (!boundedDimension || buffer.length !== boundedDimension * 4) {
    throw new Error('File embedding is malformed');
  }
  const values = new Float32Array(boundedDimension);
  for (let index = 0; index < boundedDimension; index += 1) {
    values[index] = buffer.readFloatLE(index * 4);
  }
  return values;
}

async function upsertEncryptedFileIndexMeta(
  db: IrisEncryptedDatabase,
  meta: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const encrypted = encryptJson(db.masterKey, 'file-index-meta', '1', 'payload', meta);
  await db.run(
    `INSERT INTO file_index_meta(
       id, payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, updated_at
     ) VALUES(1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload_ciphertext = excluded.payload_ciphertext,
       payload_nonce = excluded.payload_nonce,
       payload_tag = excluded.payload_tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       updated_at = excluded.updated_at`,
    [
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      now,
    ],
  );
}

/** Clears an old file index and records the encrypted metadata for a new build. */
export async function beginEncryptedFileIndex(meta: Record<string, unknown>): Promise<void> {
  const db = requireDatabase();
  await db.transaction(async () => {
    await db.run('DELETE FROM file_concepts');
    await db.run('DELETE FROM video_frame_semantics');
    await db.run('DELETE FROM file_semantics');
    await db.run('DELETE FROM filesystem_nodes');
    await db.run('DELETE FROM file_index_meta');
    await upsertEncryptedFileIndexMeta(db, meta);
  });
}

/** Updates the encrypted status and completion metadata for the filesystem index. */
export async function writeEncryptedFileIndexMeta(meta: Record<string, unknown>): Promise<void> {
  const db = requireDatabase();
  await db.transaction(async () => upsertEncryptedFileIndexMeta(db, meta));
}

/** Reads decrypted file-index metadata, or null when no index has been started. */
export async function readEncryptedFileIndexMeta(): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM file_index_meta WHERE id = 1`,
  );
  if (!row) return null;
  return decryptJson<Record<string, unknown>>(
    db.masterKey,
    'file-index-meta',
    '1',
    'payload',
    db.payloadFromRow(row),
  );
}

/** Inserts or updates encrypted filesystem tree nodes in parent-before-child order. */
export async function writeEncryptedFilesystemNodes(
  nodes: EncryptedFilesystemNodeInput[],
): Promise<void> {
  if (!nodes.length) return;
  const db = requireDatabase();
  const now = Date.now();
  await db.transaction(async () => {
    for (const node of nodes) {
      const id = String(node.id || '')
        .trim()
        .slice(0, 96);
      const parentId = node.parentId ? String(node.parentId).trim().slice(0, 96) : null;
      if (!id) continue;
      const encrypted = encryptJson(db.masterKey, 'filesystem-node', id, 'payload', node.metadata);
      await db.run(
        `INSERT INTO filesystem_nodes(
           id, parent_id, node_type, content_kind, size_bytes, modified_at, indexed_at, scan_order,
           payload_ciphertext, payload_nonce, payload_tag,
           payload_cipher_version, payload_key_version, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           parent_id = excluded.parent_id,
           node_type = excluded.node_type,
           content_kind = excluded.content_kind,
           size_bytes = excluded.size_bytes,
           modified_at = excluded.modified_at,
           indexed_at = excluded.indexed_at,
           scan_order = excluded.scan_order,
           payload_ciphertext = excluded.payload_ciphertext,
           payload_nonce = excluded.payload_nonce,
           payload_tag = excluded.payload_tag,
           payload_cipher_version = excluded.payload_cipher_version,
           payload_key_version = excluded.payload_key_version,
           updated_at = excluded.updated_at`,
        [
          id,
          parentId,
          node.nodeType,
          node.contentKind,
          Math.max(0, Math.floor(Number(node.sizeBytes) || 0)),
          Math.max(0, Number(node.modifiedAt) || 0),
          Math.max(0, Number(node.indexedAt) || 0),
          Math.max(0, Math.floor(Number(node.scanOrder) || 0)),
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.tag,
          encrypted.cipherVersion,
          encrypted.keyVersion,
          now,
          now,
        ],
      );
    }
  });
}

/** Decrypts the complete filesystem tree for path reconstruction and lightweight rescans. */
export async function readEncryptedFilesystemNodes(): Promise<EncryptedFilesystemNodeRecord[]> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, parent_id, node_type, content_kind, size_bytes, modified_at, indexed_at, scan_order,
            payload_ciphertext, payload_nonce, payload_tag,
            payload_cipher_version,
            payload_key_version
     FROM filesystem_nodes
     ORDER BY created_at ASC, id ASC`,
  );
  return rows.map((row) => filesystemNodeFromRow(db, row));
}

function filesystemNodeFromRow(
  db: IrisEncryptedDatabase,
  row: Record<string, unknown>,
): EncryptedFilesystemNodeRecord {
  const id = String(row.id || '');
  const nodeType = row.node_type === 'directory' ? 'directory' : 'file';
  const rawContentKind = String(row.content_kind || '');
  const contentKind: EncryptedFilesystemContentKind =
    rawContentKind === 'directory' ||
    rawContentKind === 'text' ||
    rawContentKind === 'document' ||
    rawContentKind === 'pdf' ||
    rawContentKind === 'image' ||
    rawContentKind === 'binary'
      ? rawContentKind
      : nodeType === 'directory'
        ? 'directory'
        : 'binary';
  return {
    id,
    parentId: row.parent_id ? String(row.parent_id) : null,
    nodeType,
    contentKind,
    sizeBytes: Math.max(0, Number(row.size_bytes) || 0),
    modifiedAt: Math.max(0, Number(row.modified_at) || 0),
    indexedAt: Math.max(0, Number(row.indexed_at) || 0),
    scanOrder: Math.max(0, Number(row.scan_order) || 0),
    metadata: decryptJson<Record<string, unknown>>(
      db.masterKey,
      'filesystem-node',
      id,
      'payload',
      db.payloadFromRow(row, 'payload_'),
    ),
  };
}

/** Reads one bounded page selected by stored content kind and scan metadata. */
export async function readEncryptedFilesystemNodePage(
  options: EncryptedFilesystemNodePageOptions,
): Promise<EncryptedFilesystemNodeRecord[]> {
  const db = requireDatabase();
  const clauses = ["node_type = 'file'", 'content_kind = ?', 'size_bytes >= ?'];
  const params: unknown[] = [options.contentKind, Math.max(0, Number(options.minSizeBytes) || 0)];
  if (typeof options.indexedAt === 'number') {
    clauses.push('indexed_at = ?');
    params.push(Math.max(0, Number(options.indexedAt) || 0));
  }
  if (options.afterId && !options.orderBySize) {
    if (options.orderByScan) {
      const afterScanOrder = Math.max(0, Math.floor(Number(options.afterScanOrder) || 0));
      clauses.push('(scan_order > ? OR (scan_order = ? AND id > ?))');
      params.push(afterScanOrder, afterScanOrder, String(options.afterId));
    } else {
      clauses.push('id > ?');
      params.push(String(options.afterId));
    }
  }
  params.push(Math.max(1, Math.min(5000, Math.floor(Number(options.limit) || 1))));
  const order = options.orderBySize
    ? 'size_bytes DESC, id ASC'
    : options.orderByScan
      ? 'scan_order ASC, id ASC'
      : 'id ASC';
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, parent_id, node_type, content_kind, size_bytes, modified_at, indexed_at, scan_order,
            payload_ciphertext, payload_nonce, payload_tag,
            payload_cipher_version,
            payload_key_version
     FROM filesystem_nodes
     WHERE ${clauses.join(' AND ')}
     ORDER BY ${order}
     LIMIT ?`,
    params,
  );
  return rows.map((row) => filesystemNodeFromRow(db, row));
}

/** Counts file nodes selected for one content-processing stage. */
export async function countEncryptedFilesystemNodes(options: {
  contentKind: Exclude<EncryptedFilesystemContentKind, 'directory'>;
  indexedAt?: number;
}): Promise<number> {
  const db = requireDatabase();
  const clauses = ["node_type = 'file'", 'content_kind = ?'];
  const params: unknown[] = [options.contentKind];
  if (typeof options.indexedAt === 'number') {
    clauses.push('indexed_at = ?');
    params.push(Math.max(0, Number(options.indexedAt) || 0));
  }
  const row = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM filesystem_nodes WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return Math.max(0, Number(row?.count) || 0);
}

/** Saves the encrypted runtime-calibrated embedding batch profile. */
export async function writeEncryptedFileEmbeddingProfile(
  profile: Record<string, unknown>,
): Promise<void> {
  const db = requireDatabase();
  const now = Date.now();
  const encrypted = encryptJson(db.masterKey, 'file-embedding-profile', '1', 'payload', profile);
  await db.run(
    `INSERT INTO file_embedding_profile(
       id, payload_ciphertext, payload_nonce, payload_tag,
       cipher_version, key_version, updated_at
     ) VALUES(1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload_ciphertext = excluded.payload_ciphertext,
       payload_nonce = excluded.payload_nonce,
       payload_tag = excluded.payload_tag,
       cipher_version = excluded.cipher_version,
       key_version = excluded.key_version,
       updated_at = excluded.updated_at`,
    [
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      encrypted.cipherVersion,
      encrypted.keyVersion,
      now,
    ],
  );
}

/** Reads the saved embedding batch profile, if one has been calibrated. */
export async function readEncryptedFileEmbeddingProfile(): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM file_embedding_profile WHERE id = 1`,
  );
  if (!row) return null;
  return decryptJson<Record<string, unknown>>(
    db.masterKey,
    'file-embedding-profile',
    '1',
    'payload',
    db.payloadFromRow(row),
  );
}

/** Encrypts one file-semantic record before any of its sensitive values reach SQLite. */
export function prepareEncryptedFileSemanticRecord(
  masterKey: Buffer,
  record: EncryptedFileSemanticInput,
): PreparedEncryptedFileSemanticRecord | null {
  const fileId = String(record.fileId || '')
    .trim()
    .slice(0, 96);
  if (!fileId) return null;
  const embeddingBuffer = encodeFileEmbedding(record.embedding);
  return {
    fileId,
    embeddingBuffer,
    encryptedMetadata: encryptJson(masterKey, 'file-semantic', fileId, 'payload', record.metadata),
    encryptedEmbedding: encryptBuffer(
      masterKey,
      'file-semantic',
      fileId,
      'embedding',
      embeddingBuffer,
    ),
  };
}

/** Builds the stable SQLite parameter list for one prepared semantic upsert. */
export function fileSemanticUpsertParameters(
  prepared: PreparedEncryptedFileSemanticRecord,
  now: number,
): unknown[] {
  return [
    prepared.fileId,
    prepared.encryptedMetadata.ciphertext,
    prepared.encryptedMetadata.nonce,
    prepared.encryptedMetadata.tag,
    prepared.encryptedEmbedding.ciphertext,
    prepared.encryptedEmbedding.nonce,
    prepared.encryptedEmbedding.tag,
    prepared.embeddingBuffer.length / 4,
    prepared.encryptedMetadata.cipherVersion,
    prepared.encryptedMetadata.keyVersion,
    prepared.encryptedEmbedding.cipherVersion,
    prepared.encryptedEmbedding.keyVersion,
    now,
    now,
  ];
}

const FILE_SEMANTIC_UPSERT_SQL = `INSERT INTO file_semantics(
  file_id, payload_ciphertext, payload_nonce, payload_tag,
  embedding_ciphertext, embedding_nonce, embedding_tag,
  embedding_dimension,
  payload_cipher_version, payload_key_version,
  embedding_cipher_version, embedding_key_version,
  created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(file_id) DO UPDATE SET
  payload_ciphertext = excluded.payload_ciphertext,
  payload_nonce = excluded.payload_nonce,
  payload_tag = excluded.payload_tag,
  embedding_ciphertext = excluded.embedding_ciphertext,
  embedding_nonce = excluded.embedding_nonce,
  embedding_tag = excluded.embedding_tag,
  embedding_dimension = excluded.embedding_dimension,
  payload_cipher_version = excluded.payload_cipher_version,
  payload_key_version = excluded.payload_key_version,
  embedding_cipher_version = excluded.embedding_cipher_version,
  embedding_key_version = excluded.embedding_key_version,
  updated_at = excluded.updated_at`;

/** Inserts or updates encrypted descriptions and vectors for indexed files. */
export async function writeEncryptedFileSemantics(
  records: EncryptedFileSemanticInput[],
): Promise<void> {
  if (!records.length) return;
  const db = requireDatabase();
  const now = Date.now();
  const preparedRecords = records
    .map((record) => prepareEncryptedFileSemanticRecord(db.masterKey, record))
    .filter((record): record is PreparedEncryptedFileSemanticRecord => Boolean(record));
  if (!preparedRecords.length) return;
  const parameterSets = preparedRecords.map((prepared) =>
    fileSemanticUpsertParameters(prepared, now),
  );
  await db.transaction(() => db.runPreparedMany(FILE_SEMANTIC_UPSERT_SQL, parameterSets));
}

/** Decrypts the shared text/image semantic vector set for in-memory search. */
export async function readEncryptedFileSemantics(): Promise<EncryptedFileSemanticRecord[]> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT file_id,
            payload_ciphertext, payload_nonce, payload_tag,
            embedding_ciphertext, embedding_nonce, embedding_tag,
            embedding_dimension,
            payload_cipher_version,
            payload_key_version,
            embedding_cipher_version,
            embedding_key_version
     FROM file_semantics
     ORDER BY file_id ASC`,
  );
  return rows.map((row) => {
    const fileId = String(row.file_id || '');
    const metadata = decryptJson<Record<string, unknown>>(
      db.masterKey,
      'file-semantic',
      fileId,
      'payload',
      db.payloadFromRow(row, 'payload_'),
    );
    const embeddingBuffer = decryptBuffer(
      db.masterKey,
      'file-semantic',
      fileId,
      'embedding',
      db.payloadFromRow(row, 'embedding_'),
    );
    return {
      fileId,
      metadata,
      embedding: fileEmbeddingValues(embeddingBuffer, Number(row.embedding_dimension)),
    };
  });
}

/** Inserts or updates encrypted CLIP vectors for independently searchable video frames. */
export async function writeEncryptedVideoFrameSemantics(
  records: EncryptedVideoFrameSemanticInput[],
): Promise<void> {
  if (!records.length) return;
  const db = requireDatabase();
  const now = Date.now();
  await db.transaction(async () => {
    for (const record of records) {
      const semanticId = String(record.semanticId || '')
        .trim()
        .slice(0, 160);
      const fileId = String(record.fileId || '')
        .trim()
        .slice(0, 96);
      if (!semanticId || !fileId) continue;
      const embeddingBuffer = encodeFileEmbedding(record.embedding);
      const encryptedMetadata = encryptJson(
        db.masterKey,
        'video-frame-semantic',
        semanticId,
        'payload',
        record.metadata,
      );
      const encryptedEmbedding = encryptBuffer(
        db.masterKey,
        'video-frame-semantic',
        semanticId,
        'embedding',
        embeddingBuffer,
      );
      await db.run(
        `INSERT INTO video_frame_semantics(
           semantic_id, file_id, timestamp_ms,
           payload_ciphertext, payload_nonce, payload_tag,
           embedding_ciphertext, embedding_nonce, embedding_tag,
           embedding_dimension,
           payload_cipher_version, payload_key_version,
           embedding_cipher_version, embedding_key_version,
           created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(semantic_id) DO UPDATE SET
           file_id = excluded.file_id,
           timestamp_ms = excluded.timestamp_ms,
           payload_ciphertext = excluded.payload_ciphertext,
           payload_nonce = excluded.payload_nonce,
           payload_tag = excluded.payload_tag,
           embedding_ciphertext = excluded.embedding_ciphertext,
           embedding_nonce = excluded.embedding_nonce,
           embedding_tag = excluded.embedding_tag,
           embedding_dimension = excluded.embedding_dimension,
           payload_cipher_version = excluded.payload_cipher_version,
           payload_key_version = excluded.payload_key_version,
           embedding_cipher_version = excluded.embedding_cipher_version,
           embedding_key_version = excluded.embedding_key_version,
           updated_at = excluded.updated_at`,
        [
          semanticId,
          fileId,
          Math.max(0, Math.floor(Number(record.timestampMs) || 0)),
          encryptedMetadata.ciphertext,
          encryptedMetadata.nonce,
          encryptedMetadata.tag,
          encryptedEmbedding.ciphertext,
          encryptedEmbedding.nonce,
          encryptedEmbedding.tag,
          embeddingBuffer.length / 4,
          encryptedMetadata.cipherVersion,
          encryptedMetadata.keyVersion,
          encryptedEmbedding.cipherVersion,
          encryptedEmbedding.keyVersion,
          now,
          now,
        ],
      );
    }
  });
}

/** Decrypts all independently searchable video-frame vectors for in-memory search. */
export async function readEncryptedVideoFrameSemantics(): Promise<
  EncryptedVideoFrameSemanticRecord[]
> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT semantic_id, file_id, timestamp_ms,
            payload_ciphertext, payload_nonce, payload_tag,
            embedding_ciphertext, embedding_nonce, embedding_tag,
            embedding_dimension,
            payload_cipher_version,
            payload_key_version,
            embedding_cipher_version,
            embedding_key_version
     FROM video_frame_semantics
     ORDER BY file_id ASC, timestamp_ms ASC`,
  );
  return rows.map((row) => {
    const semanticId = String(row.semantic_id || '');
    const metadata = decryptJson<Record<string, unknown>>(
      db.masterKey,
      'video-frame-semantic',
      semanticId,
      'payload',
      db.payloadFromRow(row, 'payload_'),
    );
    const embeddingBuffer = decryptBuffer(
      db.masterKey,
      'video-frame-semantic',
      semanticId,
      'embedding',
      db.payloadFromRow(row, 'embedding_'),
    );
    return {
      semanticId,
      fileId: String(row.file_id || ''),
      timestampMs: Math.max(0, Number(row.timestamp_ms) || 0),
      metadata,
      embedding: fileEmbeddingValues(embeddingBuffer, Number(row.embedding_dimension)),
    };
  });
}

/** Counts source vectors and unique files for one independently clustered embedding space. */
export async function countEncryptedFileConceptSources(
  embeddingSpace: EncryptedFileConceptEmbeddingSpace,
  rootNodeId: string,
): Promise<EncryptedFileConceptSourceStats> {
  const db = requireDatabase();
  const normalizedRootNodeId = String(rootNodeId || '')
    .trim()
    .slice(0, 96);
  if (!normalizedRootNodeId) return { vectorCount: 0, fileCount: 0 };
  if (embeddingSpace === 'minilm') {
    const row = await db.get<{ vector_count: number; file_count: number }>(
      `WITH RECURSIVE active_nodes(id) AS (
         SELECT id FROM filesystem_nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id FROM filesystem_nodes AS nodes
         INNER JOIN active_nodes ON nodes.parent_id = active_nodes.id
       )
       SELECT COUNT(*) AS vector_count, COUNT(DISTINCT semantics.file_id) AS file_count
       FROM file_semantics AS semantics
       INNER JOIN filesystem_nodes AS nodes ON nodes.id = semantics.file_id
       INNER JOIN active_nodes ON active_nodes.id = semantics.file_id
       WHERE nodes.content_kind IN ('text', 'document', 'pdf')`,
      [normalizedRootNodeId],
    );
    return {
      vectorCount: Math.max(0, Number(row?.vector_count || 0)),
      fileCount: Math.max(0, Number(row?.file_count || 0)),
    };
  }

  const [imageRow, videoRow] = await Promise.all([
    db.get<{ vector_count: number; file_count: number }>(
      `WITH RECURSIVE active_nodes(id) AS (
         SELECT id FROM filesystem_nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id FROM filesystem_nodes AS nodes
         INNER JOIN active_nodes ON nodes.parent_id = active_nodes.id
       )
       SELECT COUNT(*) AS vector_count, COUNT(DISTINCT semantics.file_id) AS file_count
       FROM file_semantics AS semantics
       INNER JOIN filesystem_nodes AS nodes ON nodes.id = semantics.file_id
       INNER JOIN active_nodes ON active_nodes.id = semantics.file_id
       WHERE nodes.content_kind = 'image'`,
      [normalizedRootNodeId],
    ),
    db.get<{ vector_count: number; file_count: number }>(
      `WITH RECURSIVE active_nodes(id) AS (
         SELECT id FROM filesystem_nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id FROM filesystem_nodes AS nodes
         INNER JOIN active_nodes ON nodes.parent_id = active_nodes.id
       )
       SELECT COUNT(*) AS vector_count, COUNT(DISTINCT semantics.file_id) AS file_count
       FROM video_frame_semantics AS semantics
       INNER JOIN active_nodes ON active_nodes.id = semantics.file_id`,
      [normalizedRootNodeId],
    ),
  ]);
  return {
    vectorCount:
      Math.max(0, Number(imageRow?.vector_count || 0)) +
      Math.max(0, Number(videoRow?.vector_count || 0)),
    fileCount:
      Math.max(0, Number(imageRow?.file_count || 0)) +
      Math.max(0, Number(videoRow?.file_count || 0)),
  };
}

/** Streams only encrypted vector payloads needed by the concept stage. */
export async function readEncryptedFileConceptVectorPage(
  options: EncryptedFileConceptVectorPageOptions,
): Promise<EncryptedFileConceptVectorRecord[]> {
  const db = requireDatabase();
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(options.limit) || 1000)));
  const afterId = String(options.afterId || '');
  const rootNodeId = String(options.rootNodeId || '')
    .trim()
    .slice(0, 96);
  if (!rootNodeId) return [];
  let rows: Record<string, unknown>[];

  if (options.source === 'video') {
    if (options.embeddingSpace !== 'clip') return [];
    rows = await db.all<Record<string, unknown>>(
      `WITH RECURSIVE active_nodes(id) AS (
         SELECT id FROM filesystem_nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id FROM filesystem_nodes AS nodes
         INNER JOIN active_nodes ON nodes.parent_id = active_nodes.id
       )
       SELECT semantics.semantic_id AS source_semantic_id,
              semantics.file_id, semantics.timestamp_ms,
              semantics.embedding_ciphertext, semantics.embedding_nonce,
              semantics.embedding_tag, semantics.embedding_dimension,
              semantics.embedding_cipher_version, semantics.embedding_key_version
       FROM video_frame_semantics AS semantics
       INNER JOIN active_nodes ON active_nodes.id = semantics.file_id
       WHERE semantics.semantic_id > ?
       ORDER BY semantics.semantic_id ASC
       LIMIT ?`,
      [rootNodeId, afterId, limit],
    );
  } else {
    const kinds = options.embeddingSpace === 'minilm' ? "('text', 'document', 'pdf')" : "('image')";
    rows = await db.all<Record<string, unknown>>(
      `WITH RECURSIVE active_nodes(id) AS (
         SELECT id FROM filesystem_nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id FROM filesystem_nodes AS nodes
         INNER JOIN active_nodes ON nodes.parent_id = active_nodes.id
       )
       SELECT semantics.file_id AS source_semantic_id, semantics.file_id,
              semantics.embedding_ciphertext, semantics.embedding_nonce,
              semantics.embedding_tag, semantics.embedding_dimension,
              semantics.embedding_cipher_version, semantics.embedding_key_version
       FROM file_semantics AS semantics
       INNER JOIN filesystem_nodes AS nodes ON nodes.id = semantics.file_id
       INNER JOIN active_nodes ON active_nodes.id = semantics.file_id
       WHERE semantics.file_id > ? AND nodes.content_kind IN ${kinds}
       ORDER BY semantics.file_id ASC
       LIMIT ?`,
      [rootNodeId, afterId, limit],
    );
  }

  return rows.map((row) => {
    const sourceSemanticId = String(row.source_semantic_id || '');
    const entity = options.source === 'video' ? 'video-frame-semantic' : 'file-semantic';
    const embeddingBuffer = decryptBuffer(
      db.masterKey,
      entity,
      sourceSemanticId,
      'embedding',
      db.payloadFromRow(row, 'embedding_'),
    );
    return {
      sourceSemanticId,
      fileId: String(row.file_id || ''),
      ...(options.source === 'video'
        ? { timestampMs: Math.max(0, Number(row.timestamp_ms) || 0) }
        : {}),
      embedding: fileEmbeddingFloat32Values(embeddingBuffer, Number(row.embedding_dimension)),
    };
  });
}

/** Writes one generation of encrypted concept centroids without exposing their labels. */
export async function writeEncryptedFileConcepts(
  concepts: EncryptedFileConceptInput[],
): Promise<void> {
  if (!concepts.length) return;
  const db = requireDatabase();
  const now = Date.now();
  await db.transaction(async () => {
    for (const concept of concepts) {
      const conceptId = String(concept.id || '')
        .trim()
        .slice(0, 196);
      const generation = String(concept.generation || '')
        .trim()
        .slice(0, 96);
      if (!conceptId || !generation) continue;
      const centroidBuffer = encodeFileEmbedding(concept.centroid);
      const encryptedMetadata = encryptJson(
        db.masterKey,
        'file-concept',
        conceptId,
        'payload',
        concept.metadata,
      );
      const encryptedCentroid = encryptBuffer(
        db.masterKey,
        'file-concept',
        conceptId,
        'centroid',
        centroidBuffer,
      );
      await db.run(
        `INSERT INTO file_concepts(
           concept_id, generation, embedding_space,
           payload_ciphertext, payload_nonce, payload_tag,
           centroid_ciphertext, centroid_nonce, centroid_tag, centroid_dimension,
           member_count, cohesion,
           payload_cipher_version, payload_key_version,
           centroid_cipher_version, centroid_key_version,
           created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(concept_id) DO UPDATE SET
           generation = excluded.generation,
           embedding_space = excluded.embedding_space,
           payload_ciphertext = excluded.payload_ciphertext,
           payload_nonce = excluded.payload_nonce,
           payload_tag = excluded.payload_tag,
           centroid_ciphertext = excluded.centroid_ciphertext,
           centroid_nonce = excluded.centroid_nonce,
           centroid_tag = excluded.centroid_tag,
           centroid_dimension = excluded.centroid_dimension,
           member_count = excluded.member_count,
           cohesion = excluded.cohesion,
           payload_cipher_version = excluded.payload_cipher_version,
           payload_key_version = excluded.payload_key_version,
           centroid_cipher_version = excluded.centroid_cipher_version,
           centroid_key_version = excluded.centroid_key_version,
           updated_at = excluded.updated_at`,
        [
          conceptId,
          generation,
          concept.embeddingSpace,
          encryptedMetadata.ciphertext,
          encryptedMetadata.nonce,
          encryptedMetadata.tag,
          encryptedCentroid.ciphertext,
          encryptedCentroid.nonce,
          encryptedCentroid.tag,
          centroidBuffer.length / 4,
          Math.max(0, Math.floor(Number(concept.memberCount) || 0)),
          Number.isFinite(Number(concept.cohesion)) ? Number(concept.cohesion) : 0,
          encryptedMetadata.cipherVersion,
          encryptedMetadata.keyVersion,
          encryptedCentroid.cipherVersion,
          encryptedCentroid.keyVersion,
          now,
          now,
        ],
      );
    }
  });
}

/** Upserts many-to-many file membership rows, retaining the strongest video frame per file. */
export async function writeEncryptedFileConceptMemberships(
  memberships: EncryptedFileConceptMembershipInput[],
): Promise<void> {
  if (!memberships.length) return;
  const db = requireDatabase();
  const now = Date.now();
  const normalized = memberships
    .map((membership) => ({
      conceptId: String(membership.conceptId || '')
        .trim()
        .slice(0, 196),
      generation: String(membership.generation || '')
        .trim()
        .slice(0, 96),
      fileId: String(membership.fileId || '')
        .trim()
        .slice(0, 96),
      sourceSemanticId: String(membership.sourceSemanticId || '')
        .trim()
        .slice(0, 196),
      timestampMs: Math.max(0, Math.floor(Number(membership.timestampMs) || 0)),
      similarity: Number(membership.similarity),
    }))
    .filter(
      (membership) =>
        membership.conceptId &&
        membership.generation &&
        membership.fileId &&
        membership.sourceSemanticId &&
        Number.isFinite(membership.similarity),
    );
  if (!normalized.length) return;

  await db.transaction(async () => {
    for (let start = 0; start < normalized.length; start += 100) {
      const batch = normalized.slice(start, start + 100);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = batch.flatMap((membership) => [
        membership.conceptId,
        membership.generation,
        membership.fileId,
        membership.sourceSemanticId,
        membership.timestampMs,
        membership.similarity,
        now,
        now,
      ]);
      await db.run(
        `INSERT INTO file_concept_memberships(
           concept_id, generation, file_id, source_semantic_id,
           timestamp_ms, similarity, created_at, updated_at
         ) VALUES ${placeholders}
         ON CONFLICT(concept_id, file_id) DO UPDATE SET
           source_semantic_id = excluded.source_semantic_id,
           timestamp_ms = excluded.timestamp_ms,
           similarity = excluded.similarity,
           updated_at = excluded.updated_at
         WHERE excluded.similarity > file_concept_memberships.similarity`,
        params,
      );
    }
  });
}

/** Finalizes member counts/cohesion and removes unusably small concept groups. */
export async function finalizeEncryptedFileConceptGeneration(generation: string): Promise<number> {
  const normalizedGeneration = String(generation || '')
    .trim()
    .slice(0, 96);
  if (!normalizedGeneration) return 0;
  const db = requireDatabase();
  await db.transaction(async () => {
    await db.run(
      `UPDATE file_concepts
       SET member_count = (
             SELECT COUNT(*) FROM file_concept_memberships AS memberships
             WHERE memberships.concept_id = file_concepts.concept_id
           ),
           cohesion = COALESCE((
             SELECT AVG(similarity) FROM file_concept_memberships AS memberships
             WHERE memberships.concept_id = file_concepts.concept_id
           ), 0),
           updated_at = ?
       WHERE generation = ?`,
      [Date.now(), normalizedGeneration],
    );
    await db.run('DELETE FROM file_concepts WHERE generation = ? AND member_count < 2', [
      normalizedGeneration,
    ]);
  });
  const row = await db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM file_concepts WHERE generation = ?',
    [normalizedGeneration],
  );
  return Math.max(0, Number(row?.count || 0));
}

/** Reads active encrypted centroids for query-to-concept ranking. */
export async function readEncryptedFileConcepts(
  generation: string,
): Promise<EncryptedFileConceptRecord[]> {
  const normalizedGeneration = String(generation || '')
    .trim()
    .slice(0, 96);
  if (!normalizedGeneration) return [];
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT concept_id, generation, embedding_space, member_count, cohesion,
            payload_ciphertext, payload_nonce, payload_tag,
            centroid_ciphertext, centroid_nonce, centroid_tag, centroid_dimension,
            payload_cipher_version, payload_key_version,
            centroid_cipher_version, centroid_key_version
     FROM file_concepts
     WHERE generation = ?
     ORDER BY embedding_space ASC, member_count DESC, cohesion DESC, concept_id ASC`,
    [normalizedGeneration],
  );
  return rows.map((row) => {
    const conceptId = String(row.concept_id || '');
    const metadata = decryptJson<Record<string, unknown>>(
      db.masterKey,
      'file-concept',
      conceptId,
      'payload',
      db.payloadFromRow(row, 'payload_'),
    );
    const centroidBuffer = decryptBuffer(
      db.masterKey,
      'file-concept',
      conceptId,
      'centroid',
      db.payloadFromRow(row, 'centroid_'),
    );
    return {
      id: conceptId,
      generation: String(row.generation || ''),
      embeddingSpace: row.embedding_space === 'clip' ? 'clip' : 'minilm',
      metadata,
      centroid: fileEmbeddingFloat32Values(centroidBuffer, Number(row.centroid_dimension)),
      memberCount: Math.max(0, Number(row.member_count) || 0),
      cohesion: Number.isFinite(Number(row.cohesion)) ? Number(row.cohesion) : 0,
    };
  });
}

/** Reads the strongest members for each requested concept without decrypting unrelated rows. */
export async function readEncryptedFileConceptMemberships(
  conceptIds: string[],
  limitPerConcept: number,
): Promise<EncryptedFileConceptMembershipRecord[]> {
  const normalizedIds = [
    ...new Set(conceptIds.map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (!normalizedIds.length) return [];
  const db = requireDatabase();
  const limit = Math.max(1, Math.min(100, Math.floor(Number(limitPerConcept) || 12)));
  const result: EncryptedFileConceptMembershipRecord[] = [];
  for (const conceptId of normalizedIds) {
    const rows = await db.all<Record<string, unknown>>(
      `SELECT concept_id, generation, file_id, source_semantic_id, timestamp_ms, similarity
       FROM file_concept_memberships
       WHERE concept_id = ?
       ORDER BY similarity DESC, file_id ASC
       LIMIT ?`,
      [conceptId, limit],
    );
    for (const row of rows) {
      result.push({
        conceptId: String(row.concept_id || ''),
        generation: String(row.generation || ''),
        fileId: String(row.file_id || ''),
        sourceSemanticId: String(row.source_semantic_id || ''),
        timestampMs: Math.max(0, Number(row.timestamp_ms) || 0),
        similarity: Number(row.similarity) || 0,
      });
    }
  }
  return result;
}

/** Removes inactive concept generations after file-index metadata has switched atomically. */
export async function deleteEncryptedFileConceptGenerationsExcept(
  activeGeneration: string,
): Promise<void> {
  const normalizedGeneration = String(activeGeneration || '')
    .trim()
    .slice(0, 96);
  const db = requireDatabase();
  if (!normalizedGeneration) {
    await db.run('DELETE FROM file_concepts');
    return;
  }
  await db.run('DELETE FROM file_concepts WHERE generation <> ?', [normalizedGeneration]);
}

async function deleteRowsByIds(
  db: IrisEncryptedDatabase,
  table: 'filesystem_nodes' | 'file_semantics' | 'video_frame_semantics',
  column: 'id' | 'file_id',
  ids: string[],
): Promise<void> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  for (let start = 0; start < uniqueIds.length; start += 400) {
    const batch = uniqueIds.slice(start, start + 400);
    const placeholders = batch.map(() => '?').join(', ');
    await db.run(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, batch);
  }
}

/** Removes selected semantic records without deleting their filesystem nodes. */
export async function deleteEncryptedFileSemantics(fileIds: string[]): Promise<void> {
  if (!fileIds.length) return;
  const db = requireDatabase();
  await db.transaction(async () => {
    const uniqueIds = [...new Set(fileIds.map((id) => String(id || '').trim()).filter(Boolean))];
    for (let start = 0; start < uniqueIds.length; start += 400) {
      const batch = uniqueIds.slice(start, start + 400);
      const placeholders = batch.map(() => '?').join(', ');
      await db.run(
        `DELETE FROM file_concept_memberships WHERE file_id IN (${placeholders})`,
        batch,
      );
    }
    await deleteRowsByIds(db, 'video_frame_semantics', 'file_id', fileIds);
    await deleteRowsByIds(db, 'file_semantics', 'file_id', fileIds);
  });
}

/** Deletes selected tree nodes; descendants and semantic records cascade automatically. */
export async function deleteEncryptedFilesystemNodes(nodeIds: string[]): Promise<void> {
  if (!nodeIds.length) return;
  const db = requireDatabase();
  await db.transaction(async () => deleteRowsByIds(db, 'filesystem_nodes', 'id', nodeIds));
}

/** Removes only the encrypted filesystem semantic index. */
export async function clearEncryptedFileIndex(): Promise<void> {
  const db = requireDatabase();
  await db.transaction(async () => {
    await db.run('DELETE FROM file_concepts');
    await db.run('DELETE FROM video_frame_semantics');
    await db.run('DELETE FROM file_semantics');
    await db.run('DELETE FROM filesystem_nodes');
    await db.run('DELETE FROM file_index_meta');
  });
}

export interface EncryptedLauncherApplicationInput {
  id: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export interface EncryptedLauncherApplicationRecord extends EncryptedLauncherApplicationInput {}

function launcherEmbeddingBuffer(values: number[]): Buffer {
  const bounded = values
    .slice(0, MAX_LAUNCHER_EMBEDDING_DIMENSIONS)
    .map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0));
  if (!bounded.length) throw new Error('Launcher application embedding is required');
  const buffer = Buffer.allocUnsafe(bounded.length * 4);
  bounded.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function launcherEmbeddingValues(buffer: Buffer, dimension: number): number[] {
  const boundedDimension = Math.max(
    0,
    Math.min(MAX_LAUNCHER_EMBEDDING_DIMENSIONS, Math.floor(Number(dimension) || 0)),
  );
  if (!boundedDimension || buffer.length !== boundedDimension * 4) {
    throw new Error('Launcher application embedding is malformed');
  }
  const values: number[] = [];
  for (let index = 0; index < boundedDimension; index += 1) {
    values.push(buffer.readFloatLE(index * 4));
  }
  return values;
}

/** Replaces the complete encrypted launcher application index in one transaction. */
export async function saveEncryptedLauncherIndex(
  meta: Record<string, unknown>,
  applications: EncryptedLauncherApplicationInput[],
): Promise<void> {
  const db = requireDatabase();
  const boundedApplications = applications.slice(0, MAX_LAUNCHER_APPLICATIONS);
  const now = Date.now();
  const encryptedMeta = encryptJson(db.masterKey, 'launcher-index-meta', '1', 'payload', meta);

  await db.transaction(async () => {
    await db.run('DELETE FROM launcher_applications');
    await db.run('DELETE FROM launcher_index_meta');

    for (const application of boundedApplications) {
      const id = String(application.id || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 96);
      if (!id) continue;
      const embeddingBuffer = launcherEmbeddingBuffer(application.embedding);
      const encryptedMetadata = encryptJson(
        db.masterKey,
        'launcher-application',
        id,
        'metadata',
        application.metadata,
      );
      const encryptedEmbedding = encryptBuffer(
        db.masterKey,
        'launcher-application',
        id,
        'embedding',
        embeddingBuffer,
      );
      await db.run(
        `INSERT INTO launcher_applications(
           id, metadata_ciphertext, metadata_nonce, metadata_tag,
           embedding_ciphertext, embedding_nonce, embedding_tag,
           embedding_dimension, cipher_version, key_version, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          encryptedMetadata.ciphertext,
          encryptedMetadata.nonce,
          encryptedMetadata.tag,
          encryptedEmbedding.ciphertext,
          encryptedEmbedding.nonce,
          encryptedEmbedding.tag,
          embeddingBuffer.length / 4,
          encryptedMetadata.cipherVersion,
          encryptedMetadata.keyVersion,
          now,
          now,
        ],
      );
    }

    await db.run(
      `INSERT INTO launcher_index_meta(
         id, payload_ciphertext, payload_nonce, payload_tag,
         cipher_version, key_version, updated_at
       ) VALUES(1, ?, ?, ?, ?, ?, ?)`,
      [
        encryptedMeta.ciphertext,
        encryptedMeta.nonce,
        encryptedMeta.tag,
        encryptedMeta.cipherVersion,
        encryptedMeta.keyVersion,
        now,
      ],
    );
  });
}

/** Reads the encrypted launcher index metadata, or null when no complete index exists. */
export async function readEncryptedLauncherIndexMeta(): Promise<Record<string, unknown> | null> {
  const db = requireDatabase();
  const row = await db.get<Record<string, unknown>>(
    `SELECT payload_ciphertext AS ciphertext,
            payload_nonce AS nonce,
            payload_tag AS tag,
            cipher_version,
            key_version
     FROM launcher_index_meta WHERE id = 1`,
  );
  if (!row) return null;
  return decryptJson<Record<string, unknown>>(
    db.masterKey,
    'launcher-index-meta',
    '1',
    'payload',
    db.payloadFromRow(row),
  );
}

/** Decrypts the complete launcher application vector set for bounded in-memory search. */
export async function readEncryptedLauncherApplications(): Promise<
  EncryptedLauncherApplicationRecord[]
> {
  const db = requireDatabase();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id,
            metadata_ciphertext, metadata_nonce, metadata_tag,
            embedding_ciphertext, embedding_nonce, embedding_tag,
            embedding_dimension,
            cipher_version AS metadata_cipher_version,
            key_version AS metadata_key_version,
            cipher_version AS embedding_cipher_version,
            key_version AS embedding_key_version
     FROM launcher_applications
     ORDER BY id ASC
     LIMIT ?`,
    [MAX_LAUNCHER_APPLICATIONS],
  );

  return rows.map((row) => {
    const id = String(row.id || '');
    const metadata = decryptJson<Record<string, unknown>>(
      db.masterKey,
      'launcher-application',
      id,
      'metadata',
      db.payloadFromRow(row, 'metadata_'),
    );
    const embeddingBuffer = decryptBuffer(
      db.masterKey,
      'launcher-application',
      id,
      'embedding',
      db.payloadFromRow(row, 'embedding_'),
    );
    return {
      id,
      metadata,
      embedding: launcherEmbeddingValues(embeddingBuffer, Number(row.embedding_dimension)),
    };
  });
}

/** Removes only the semantic launcher index while leaving other encrypted data intact. */
export async function clearEncryptedLauncherIndex(): Promise<void> {
  const db = requireDatabase();
  await db.transaction(async () => {
    await db.run('DELETE FROM launcher_applications');
    await db.run('DELETE FROM launcher_index_meta');
  });
}

export async function purgeExpiredEncryptedState(): Promise<void> {
  await requireDatabase().run(
    'DELETE FROM subagent_outputs WHERE expires_at IS NOT NULL AND expires_at < ?',
    [Date.now()],
  );
}

/**
 * Deletes every encrypted user-data record while preserving the wrapped storage key and
 * schema metadata required to keep the current database usable after the renderer reloads.
 */
export async function clearEncryptedApplicationData(): Promise<void> {
  const db = requireDatabase();
  await db.transaction(async () => {
    await db.run('DELETE FROM artifact_chunks');
    await db.run('DELETE FROM artifacts');
    await db.run('DELETE FROM chat_messages');
    await db.run('DELETE FROM chat_state');
    await db.run('DELETE FROM chats');
    await db.run('DELETE FROM web_search_sessions');
    await db.run('DELETE FROM subagent_outputs');
    await db.run('DELETE FROM user_skills');
    await db.run('DELETE FROM launcher_applications');
    await db.run('DELETE FROM launcher_index_meta');
    await db.run('DELETE FROM file_concepts');
    await db.run('DELETE FROM video_frame_semantics');
    await db.run('DELETE FROM file_semantics');
    await db.run('DELETE FROM filesystem_nodes');
    await db.run('DELETE FROM file_index_meta');
    await db.run('DELETE FROM file_embedding_profile');
    await db.run('DELETE FROM encrypted_store');
  });
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await db.exec('VACUUM');
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

export function createRandomStorageKey(): Buffer {
  return randomBytes(32);
}
