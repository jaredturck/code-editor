/**
 * Exercises the observable command safety routes contract, with regression cases for
 * “requires explicit approval before a legacy shell launcher command can run” and “treats
 * metacharacters in structured find arguments as ordinary filename data”. The suite
 * documents caller-visible behavior so implementation refactors cannot silently weaken
 * those guarantees.
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

const temporaryRoots: string[] = [];

// Creates middleware with the state and dependencies required by the surrounding test scenario.
function createMiddleware(baseDir: string): TestMiddleware {
  let middleware: TestMiddleware | null = null;
  const plugin = desktopBridgePlugin({ baseDir }) as unknown as TestPlugin;
  plugin.configureServer({
    middlewares: {
      // Provides the use helper used by the surrounding test scenario.
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

describe('command safety routes', () => {
  it('requires explicit approval before a legacy shell launcher command can run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-'));
    temporaryRoots.push(root);
    const response = await invokeBridge(root, '/api/local/launcher/run', {
      command: 'echo safe && echo second',
      category: 'script',
      cwd: root,
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      approvalRequired: true,
      risk: 'legacy_shell',
    });
  });

  it('requires destructive one-time approval before clearing encrypted IRIS data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-clear-data-'));
    temporaryRoots.push(root);
    const response = await invokeBridge(root, '/api/local/launcher/clear-data', {});

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      approvalRequired: true,
      risk: 'destructive',
      command: 'Clear IRIS encrypted application data',
    });
  });

  it('treats metacharacters in structured find arguments as ordinary filename data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-find-'));
    temporaryRoots.push(root);
    await fs.writeFile(path.join(root, 'safe.txt'), 'content');
    const marker = path.join(root, 'should-not-exist');

    const response = await invokeBridge(root, '/api/local/power/find', {
      path: root,
      name: `*.txt;touch ${marker}`,
    });

    expect(response.status).toBe(200);
    await expect(fs.access(marker)).rejects.toThrow();
  });
});
