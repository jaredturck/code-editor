/** Benchmarks the exact AES-GCM and JSON encryption helpers used before SQLite persistence. */

import { randomBytes } from 'node:crypto';
import {
  decryptBuffer,
  decryptJson,
  encryptBuffer,
  encryptJson,
} from '../../../backend/desktopBridge/storage/encryption.js';
import type { BenchmarkDefinition } from '../core/types.js';

interface CryptoContext {
  masterKey: Buffer;
  payload: Buffer;
  jsonValue: Record<string, unknown>;
}

/** Creates deterministic plaintext while retaining a random master key for realistic HKDF work. */
function cryptoContext(size: number): CryptoContext {
  return {
    masterKey: randomBytes(32),
    payload: Buffer.alloc(size, 0x5a),
    jsonValue: {
      title: 'IRIS benchmark payload',
      tags: ['filesystem', 'semantic', 'encrypted'],
      content: 'Benchmark JSON content. '.repeat(Math.max(1, Math.floor(size / 24))),
    },
  };
}

/** Runs repeated buffer encrypt/decrypt cycles so timer cost does not dominate small payloads. */
function roundTripBuffer(context: CryptoContext, operations: number): Uint8Array {
  let output: Uint8Array = new Uint8Array();
  for (let index = 0; index < operations; index += 1) {
    const encrypted = encryptBuffer(
      context.masterKey,
      'benchmark-buffer',
      `record-${index}`,
      'payload',
      context.payload,
    );
    output = decryptBuffer(
      context.masterKey,
      'benchmark-buffer',
      `record-${index}`,
      'payload',
      encrypted,
    );
  }
  return output;
}

/** Exposes encryption throughput across metadata-sized and embedding-sized payloads. */
export const cryptoBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'crypto.aes-gcm.roundtrip.1kib',
    suite: 'Cryptography',
    name: 'AES-GCM round trip · 1 KiB',
    description:
      'Derives the domain key, encrypts, authenticates, decrypts, and verifies a 1 KiB buffer.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 200,
    bytesPerOperation: 1024,
    setup: () => cryptoContext(1024),
    run: (context) => roundTripBuffer(context, 200),
  },
  {
    id: 'crypto.aes-gcm.roundtrip.64kib',
    suite: 'Cryptography',
    name: 'AES-GCM round trip · 64 KiB',
    description:
      'Measures encrypted artifact and larger state payloads with the production domain-key derivation.',
    iterations: 10,
    warmupIterations: 2,
    operationsPerIteration: 25,
    bytesPerOperation: 64 * 1024,
    setup: () => cryptoContext(64 * 1024),
    run: (context) => roundTripBuffer(context, 25),
  },
  {
    id: 'crypto.aes-gcm.roundtrip.1mib',
    suite: 'Cryptography',
    name: 'AES-GCM round trip · 1 MiB',
    description:
      'Measures large encrypted payload throughput without involving SQLite or filesystem I/O.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 3,
    bytesPerOperation: 1024 * 1024,
    setup: () => cryptoContext(1024 * 1024),
    run: (context) => roundTripBuffer(context, 3),
  },
  {
    id: 'crypto.json.roundtrip.16kib',
    suite: 'Cryptography',
    name: 'Encrypted JSON round trip',
    description:
      'Serializes, encrypts, decrypts, and parses a representative structured persistence payload.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 50,
    setup: () => cryptoContext(16 * 1024),
    run: (context) => {
      let output: Record<string, unknown> = {};
      for (let index = 0; index < 50; index += 1) {
        const encrypted = encryptJson(
          context.masterKey,
          'benchmark-json',
          `record-${index}`,
          'payload',
          context.jsonValue,
        );
        output = decryptJson<Record<string, unknown>>(
          context.masterKey,
          'benchmark-json',
          `record-${index}`,
          'payload',
          encrypted,
        );
      }
      return output;
    },
  },
];
