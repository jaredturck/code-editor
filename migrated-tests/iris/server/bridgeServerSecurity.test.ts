/**
 * Exercises the packaged bridge's production boundary: startup requires a strong token,
 * Host must remain loopback, and CORS is emitted only for the renderer's exact opaque
 * origin. The tests use the real HTTP server so preflight and header behavior cannot drift
 * away from browser-visible behavior.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalBridgeServer } from '../../server/bridgeServer';

type BridgeHandle = Awaited<ReturnType<typeof startLocalBridgeServer>>;

interface BridgeHttpResponse {
  status: number | undefined;
  body: string;
  headers: { get: (name: string) => string | null };
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
}

const running: BridgeHandle[] = [];
const temporaryRoots: string[] = [];
const fixtureRoot = path.resolve('tests/fixtures/workspace');
const token = '0123456789abcdef0123456789abcdef';

// Sends one HTTP request to the packaged bridge fixture for security assertions.
async function requestBridge(
  url: string,
  { method = 'GET', headers = {}, body }: RequestOptions = {},
): Promise<BridgeHttpResponse> {
  const target = new URL(url);
  return new Promise<BridgeHttpResponse>((resolve, reject) => {
    const request = http.request(target, { method, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        const normalizedHeaders = new Map(
          Object.entries(response.headers).map(([name, value]) => [
            name.toLowerCase(),
            Array.isArray(value) ? value.join(', ') : value == null ? null : String(value),
          ]),
        );
        resolve({
          status: response.statusCode,
          body,
          headers: {
            get: (name: string) => normalizedHeaders.get(String(name).toLowerCase()) ?? null,
          },
        });
      });
    });
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

// Starts bridge and establishes the lifecycle state needed by the surrounding test scenario.
async function startBridge(initialPermissions: Record<string, boolean> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-bridge-security-'));
  temporaryRoots.push(root);
  const bridge = await startLocalBridgeServer({
    baseDir: fixtureRoot,
    token,
    databasePath: path.join(root, 'iris.sqlite3'),
    masterKey: randomBytes(32),
    initialPermissions,
  });
  running.push(bridge);
  return `http://${bridge.host}:${bridge.port}`;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(running.splice(0).map((bridge) => bridge.close()));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('packaged bridge security', () => {
  it('refuses to start without a production-strength per-launch token', async () => {
    await expect(startLocalBridgeServer({ baseDir: fixtureRoot, token: '' })).rejects.toThrow(
      'requires a per-launch token',
    );
    await expect(startLocalBridgeServer({ baseDir: fixtureRoot, token: 'short' })).rejects.toThrow(
      'at least 32 characters',
    );
  });

  it('rejects missing and incorrect bridge tokens', async () => {
    const origin = await startBridge();
    const missing = await requestBridge(`${origin}/api/local/health`);
    const incorrect = await requestBridge(`${origin}/api/local/health`, {
      headers: { 'x-iris-bridge-token': 'ffffffffffffffffffffffffffffffff' },
    });

    expect(missing.status).toBe(403);
    expect(incorrect.status).toBe(403);
  });

  it('serves the file renderer origin without using wildcard CORS', async () => {
    const origin = await startBridge();
    const response = await requestBridge(`${origin}/api/local/health`, {
      headers: {
        Origin: 'null',
        'x-iris-bridge-token': token,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('rejects unrecognized browser origins even when they know the token', async () => {
    const origin = await startBridge();
    const response = await requestBridge(`${origin}/api/local/health`, {
      headers: {
        Origin: 'https://attacker.example',
        'x-iris-bridge-token': token,
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects preflights that request headers outside the bridge allowlist', async () => {
    const origin = await startBridge();
    const response = await requestBridge(`${origin}/api/local/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Headers': 'content-type, x-unexpected-header',
      },
    });

    expect(response.status).toBe(403);
  });

  it('accepts the transcription preflight and forwards a local WAV upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/tags')) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: 'gabegoodhart/granite4.1-speech:2b' }],
            }),
          };
        }
        if (url.endsWith('/v1/audio/transcriptions')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ text: 'working transcript' }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const origin = await startBridge({ microphone: true });
    const requestedHeaders = [
      'content-type',
      'x-iris-bridge-token',
      'x-iris-audio-provider',
      'x-iris-audio-model',
      'x-iris-audio-key',
      'x-iris-audio-local-fallback',
    ].join(', ');
    const preflight = await requestBridge(`${origin}/api/local/audio/transcriptions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Headers': requestedHeaders,
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(
      'x-iris-audio-provider',
    );

    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(36, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(0, 40);

    const response = await requestBridge(`${origin}/api/local/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Origin: 'null',
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'x-iris-bridge-token': token,
        'x-iris-audio-provider': 'local',
        'x-iris-audio-model': 'gabegoodhart/granite4.1-speech:2b',
        'x-iris-audio-local-fallback': '1',
      },
      body: wav,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      text: 'working transcript',
    });
  });
});
