/**
 * Verifies that bridge filesystem routes cannot cross their configured working root through
 * traversal or symlinked path segments, while ordinary paths inside the root still work.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

interface TestRequest extends Readable {
  url?: string;
  method?: string;
  headers: Record<string, string>;
}

interface TestResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (value?: unknown) => void;
}

type TestMiddleware = (
  req: TestRequest,
  res: TestResponse,
  next: () => void,
) => void | Promise<void>;

interface TestPlugin {
  configureServer: (server: { middlewares: { use: (callback: TestMiddleware) => void } }) => void;
}

interface BridgeInvocation {
  status: number;
  json: Record<string, any>;
}
import { afterEach, describe, expect, it } from 'vitest';
import { desktopBridgePlugin } from '../../server/desktopBridgePlugin';
import {
  ensureInternalStorageDirectory,
  resolveExistingPathWithinRoots,
  resolveWritablePathWithinRoots,
} from '../../server/desktopBridge/shared/filesystemBoundary';

const temporaryRoots: string[] = [];

// Creates middleware with the state and dependencies required by the surrounding test scenario.
function createMiddleware(baseDir: string): TestMiddleware {
  let middleware: TestMiddleware | null = null;
  const plugin = desktopBridgePlugin({ baseDir }) as unknown as TestPlugin;
  plugin.configureServer({
    middlewares: {
      use(callback: TestMiddleware) {
        middleware = callback;
      },
    },
  });
  if (!middleware) throw new Error('Desktop bridge middleware was not registered');
  return middleware;
}

// Invokes bridge through the boundary owned by the surrounding test scenario.
async function invokeBridge(
  baseDir: string,
  url: string,
  body: Record<string, unknown>,
): Promise<BridgeInvocation> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as TestRequest;
  req.url = url;
  req.method = 'POST';
  req.headers = {};
  let responseBody = '';
  const res: TestResponse = {
    statusCode: 200,
    setHeader() {},
    end(value = '') {
      responseBody += String(value);
    },
  };
  await createMiddleware(baseDir)(req, res, () => {});
  return { status: res.statusCode, json: JSON.parse(responseBody) };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('filesystem boundary', () => {
  it('allows reads and atomic writes within the configured root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-boundary-root-'));
    temporaryRoots.push(root);
    await fs.writeFile(path.join(root, 'source.txt'), 'inside');

    const read = await invokeBridge(root, '/api/local/fs/read', {
      path: 'source.txt',
    });
    const write = await invokeBridge(root, '/api/local/fs/write', {
      path: 'nested/output.txt',
      content: 'saved',
    });

    expect(read.status).toBe(200);
    expect(read.json.content).toBe('inside');
    expect(write.status).toBe(200);
    await expect(fs.readFile(path.join(root, 'nested/output.txt'), 'utf8')).resolves.toBe('saved');
  });

  it('browses one directory and serves image previews inside the configured root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-browser-root-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'Pictures'));
    await fs.writeFile(path.join(root, 'photo.png'), Buffer.from('image payload'));

    const browse = await invokeBridge(root, '/api/local/fs/browse', {
      path: '.',
    });
    const thumbnail = await invokeBridge(root, '/api/local/fs/thumbnail', {
      path: 'photo.png',
      width: 96,
      height: 96,
    });

    expect(browse.status).toBe(200);
    expect(browse.json.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Pictures', type: 'directory' }),
        expect.objectContaining({ name: 'photo.png', isImage: true }),
      ]),
    );
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.json.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects lexical traversal outside the configured root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-boundary-parent-'));
    temporaryRoots.push(parent);
    const root = path.join(parent, 'root');
    await fs.mkdir(root);
    await fs.writeFile(path.join(parent, 'outside.txt'), 'outside');

    const response = await invokeBridge(root, '/api/local/fs/read', {
      path: '../outside.txt',
    });
    const browse = await invokeBridge(root, '/api/local/fs/browse', {
      path: '..',
    });
    const thumbnail = await invokeBridge(root, '/api/local/fs/thumbnail', {
      path: '../outside.txt',
    });
    expect(response.status).toBe(403);
    expect(browse.status).toBe(403);
    expect(thumbnail.status).toBe(403);
    expect(response.json.error).toMatch(/outside the allowed working root/i);
  });

  it('rejects a symlinked internal storage segment before creating content outside home', async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.homedir(), '.iris-storage-boundary-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-storage-outside-'));
    temporaryRoots.push(homeRoot, outside);
    await fs.symlink(outside, path.join(homeRoot, 'redirect'), 'dir');

    await expect(
      ensureInternalStorageDirectory(path.join(homeRoot, 'redirect', 'nested')),
    ).rejects.toThrow(/must not be a symlink/i);
    await expect(fs.access(path.join(outside, 'nested'))).rejects.toThrow();
  });

  it('rejects reads and writes through a symlink that leaves the root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-boundary-link-'));
    temporaryRoots.push(parent);
    const root = path.join(parent, 'root');
    const outside = path.join(parent, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(outside, path.join(root, 'escape'), 'dir');

    const read = await invokeBridge(root, '/api/local/fs/read', {
      path: 'escape/secret.txt',
    });
    const write = await invokeBridge(root, '/api/local/fs/write', {
      path: 'escape/new.txt',
      content: 'blocked',
    });

    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    await expect(fs.access(path.join(outside, 'new.txt'))).rejects.toThrow();
  });

  it('allows File Manager paths in a second explicit root without widening the primary root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-boundary-roots-'));
    temporaryRoots.push(parent);
    const homeRoot = path.join(parent, 'home');
    const driveRoot = path.join(parent, 'drive');
    const outside = path.join(parent, 'outside');
    await Promise.all([homeRoot, driveRoot, outside].map((root) => fs.mkdir(root)));
    await fs.writeFile(path.join(driveRoot, 'indexed.txt'), 'indexed');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(outside, path.join(driveRoot, 'escape'), 'dir');

    await expect(
      resolveExistingPathWithinRoots(
        path.join(driveRoot, 'indexed.txt'),
        [homeRoot, driveRoot],
        homeRoot,
      ),
    ).resolves.toBe(path.join(driveRoot, 'indexed.txt'));
    await expect(
      resolveWritablePathWithinRoots(
        path.join(driveRoot, 'new.txt'),
        [homeRoot, driveRoot],
        homeRoot,
      ),
    ).resolves.toBe(path.join(driveRoot, 'new.txt'));
    await expect(
      resolveExistingPathWithinRoots(
        path.join(driveRoot, 'escape', 'secret.txt'),
        [homeRoot, driveRoot],
        homeRoot,
      ),
    ).rejects.toThrow(/outside the allowed File Manager locations/i);
    await expect(
      resolveExistingPathWithinRoots(
        path.join(outside, 'secret.txt'),
        [homeRoot, driveRoot],
        homeRoot,
      ),
    ).rejects.toThrow(/outside the allowed File Manager locations/i);
  });
});
