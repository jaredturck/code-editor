/**
 * Protects the durable filename and atomic-write contracts. Distinct logical keys must not
 * collide on disk, and failed or interrupted writes must not expose partial JSON records.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteJson } from '../../server/desktopBridge/shared/atomicFile';
import { storeKeyToFile } from '../../server/desktopBridge/services/bridgeServiceRuntime';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('durable storage primitives', () => {
  it('uses reversible collision-free filenames for ordinary keys', () => {
    const first = storeKeyToFile('feature:a/b');
    const second = storeKeyToFile('feature:a?b');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^k1-/);
    const encoded = first.slice(3, -5);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe('feature:a/b');
  });

  it('uses a stable bounded hash for very long keys', () => {
    const key = 'long-key:'.repeat(100);
    expect(storeKeyToFile(key)).toBe(storeKeyToFile(key));
    expect(storeKeyToFile(key)).toMatch(/^k1h-[a-f0-9]{64}\.json$/);
  });

  it('atomically replaces JSON without leaving temporary files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-atomic-'));
    temporaryRoots.push(root);
    const target = path.join(root, 'state.json');
    await atomicWriteJson(target, { version: 1 });
    await atomicWriteJson(target, { version: 2, complete: true });
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('{"version":2,"complete":true}');
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
