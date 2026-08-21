/**
 * Encrypts and authenticates IRIS persistence payloads before they reach SQLite.
 * Domain-derived keys and record-bound associated data keep ciphertext scoped to its
 * intended table, record, and field while plaintext exists only during active operations.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const CIPHER_VERSION = 1;
const KEY_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const STORAGE_NAMESPACE = 'iris-storage';
const APP_AAD = 'iris-ai';

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  cipherVersion: number;
  keyVersion: number;
}

function deriveDomainKey(masterKey: Buffer, domain: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.alloc(0),
      Buffer.from(`${STORAGE_NAMESPACE}:${domain}:v${KEY_VERSION}`, 'utf8'),
      32,
    ),
  );
}

function aadFor(domain: string, recordId: string, field: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      app: APP_AAD,
      cipherVersion: CIPHER_VERSION,
      keyVersion: KEY_VERSION,
      domain,
      recordId,
      field,
    }),
    'utf8',
  );
}

export function encryptBuffer(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  value: Buffer,
): EncryptedPayload {
  const key = deriveDomainKey(masterKey, domain);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aadFor(domain, recordId, field));
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext,
      nonce,
      tag,
      cipherVersion: CIPHER_VERSION,
      keyVersion: KEY_VERSION,
    };
  } finally {
    key.fill(0);
  }
}

export function decryptBuffer(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  payload: {
    ciphertext: Buffer;
    nonce: Buffer;
    tag: Buffer;
    cipherVersion?: number;
    keyVersion?: number;
  },
): Buffer {
  if (Number(payload.cipherVersion || CIPHER_VERSION) !== CIPHER_VERSION) {
    throw new Error('Unsupported encrypted payload version');
  }
  const keyVersion = Number(payload.keyVersion || KEY_VERSION);
  if (keyVersion !== KEY_VERSION) throw new Error('Unsupported storage key version');
  if (!Buffer.isBuffer(payload.nonce) || payload.nonce.length !== NONCE_BYTES) {
    throw new Error('Invalid encrypted payload nonce');
  }
  if (!Buffer.isBuffer(payload.tag) || payload.tag.length !== TAG_BYTES) {
    throw new Error('Invalid encrypted payload authentication tag');
  }

  const key = deriveDomainKey(masterKey, domain);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, payload.nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aadFor(domain, recordId, field));
    decipher.setAuthTag(payload.tag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  } finally {
    key.fill(0);
  }
}

export function encryptText(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  value: unknown,
): EncryptedPayload {
  return encryptBuffer(
    masterKey,
    domain,
    recordId,
    field,
    Buffer.from(String(value ?? ''), 'utf8'),
  );
}

export function decryptText(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  payload: {
    ciphertext: Buffer;
    nonce: Buffer;
    tag: Buffer;
    cipherVersion?: number;
    keyVersion?: number;
  },
): string {
  return decryptBuffer(masterKey, domain, recordId, field, payload).toString('utf8');
}

export function encryptJson(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  value: unknown,
): EncryptedPayload {
  return encryptText(masterKey, domain, recordId, field, JSON.stringify(value ?? null));
}

export function decryptJson<T>(
  masterKey: Buffer,
  domain: string,
  recordId: string,
  field: string,
  payload: {
    ciphertext: Buffer;
    nonce: Buffer;
    tag: Buffer;
    cipherVersion?: number;
    keyVersion?: number;
  },
): T {
  return JSON.parse(decryptText(masterKey, domain, recordId, field, payload)) as T;
}

export { CIPHER_VERSION, KEY_VERSION, NONCE_BYTES, TAG_BYTES };
