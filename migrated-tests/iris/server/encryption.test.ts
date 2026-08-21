/**
 * Verifies IRIS's authenticated field-encryption contract independently of SQLite.
 * Sensitive values must round-trip only with the original key and row-bound AAD.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptBuffer,
  decryptJson,
  decryptText,
  encryptBuffer,
  encryptJson,
  encryptText,
} from '../../server/desktopBridge/storage/encryption';

describe('encrypted storage primitives', () => {
  it('round-trips text, JSON, and binary payloads', () => {
    const key = randomBytes(32);
    const text = encryptText(key, 'chat-message', 'chat-1:1', 'payload', 'private message');
    const json = encryptJson(key, 'chat-state', 'chat-1', 'state', {
      memory: 'private',
    });
    const binary = encryptBuffer(
      key,
      'artifact-chunk',
      'artifact-1:0',
      'content',
      Buffer.from([0, 1, 2, 255]),
    );

    expect(decryptText(key, 'chat-message', 'chat-1:1', 'payload', text)).toBe('private message');
    expect(decryptJson(key, 'chat-state', 'chat-1', 'state', json)).toEqual({
      memory: 'private',
    });
    expect(decryptBuffer(key, 'artifact-chunk', 'artifact-1:0', 'content', binary)).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
  });

  it('uses a fresh nonce for every encryption operation', () => {
    const key = randomBytes(32);
    const first = encryptText(key, 'store', 'setting', 'value', 'same plaintext');
    const second = encryptText(key, 'store', 'setting', 'value', 'same plaintext');

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it('rejects the wrong key and modified ciphertext or authentication tag', () => {
    const key = randomBytes(32);
    const encrypted = encryptText(key, 'chat-message', 'chat-1:1', 'payload', 'private message');

    expect(() =>
      decryptText(randomBytes(32), 'chat-message', 'chat-1:1', 'payload', encrypted),
    ).toThrow();

    const changedCiphertext = {
      ...encrypted,
      ciphertext: Buffer.from(encrypted.ciphertext),
    };
    changedCiphertext.ciphertext[0] ^= 1;
    expect(() =>
      decryptText(key, 'chat-message', 'chat-1:1', 'payload', changedCiphertext),
    ).toThrow();

    const changedTag = { ...encrypted, tag: Buffer.from(encrypted.tag) };
    changedTag.tag[0] ^= 1;
    expect(() => decryptText(key, 'chat-message', 'chat-1:1', 'payload', changedTag)).toThrow();
  });

  it('binds ciphertext to its domain, record id, and field through AAD', () => {
    const key = randomBytes(32);
    const encrypted = encryptText(key, 'chat-message', 'chat-1:1', 'payload', 'private message');

    expect(() => decryptText(key, 'chat-message', 'chat-1:2', 'payload', encrypted)).toThrow();
    expect(() => decryptText(key, 'chat-state', 'chat-1:1', 'payload', encrypted)).toThrow();
    expect(() => decryptText(key, 'chat-message', 'chat-1:1', 'other', encrypted)).toThrow();
  });

  it('rejects malformed nonces, tags, and unsupported versions', () => {
    const key = randomBytes(32);
    const encrypted = encryptText(key, 'store', 'setting', 'value', 'private');

    expect(() =>
      decryptText(key, 'store', 'setting', 'value', {
        ...encrypted,
        nonce: Buffer.alloc(1),
      }),
    ).toThrow('Invalid encrypted payload nonce');
    expect(() =>
      decryptText(key, 'store', 'setting', 'value', {
        ...encrypted,
        tag: Buffer.alloc(1),
      }),
    ).toThrow('Invalid encrypted payload authentication tag');
    expect(() =>
      decryptText(key, 'store', 'setting', 'value', {
        ...encrypted,
        cipherVersion: 2,
      }),
    ).toThrow('Unsupported encrypted payload version');
    expect(() =>
      decryptText(key, 'store', 'setting', 'value', {
        ...encrypted,
        keyVersion: 99,
      }),
    ).toThrow('Unsupported storage key version');
  });

  it('writes new payloads under the clean IRIS key version 1 and round-trips them', () => {
    const key = randomBytes(32);
    const payload = encryptText(key, 'chat-message', 'chat-1:1', 'payload', 'fresh IRIS secret');
    expect(payload.keyVersion).toBe(1);
    expect(decryptText(key, 'chat-message', 'chat-1:1', 'payload', payload)).toBe(
      'fresh IRIS secret',
    );
  });
});
