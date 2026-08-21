/**
 * Verifies the application-level AI proxy boundary rather than only its lower-level URL
 * helpers. Configured loopback model servers remain usable, while arbitrary providers,
 * private-network targets, and unapproved request headers are rejected before a socket is
 * opened.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyRemoteRequest } from '../../server/desktopBridge/services/bridgeServiceRuntime';

interface ProxyRequestOptions {
  url: string;
  method?: string;
  provider?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

const proxyRequest = proxyRemoteRequest as (
  options: ProxyRequestOptions,
) => Promise<Record<string, unknown>>;

const servers: http.Server[] = [];

// Starts server and establishes the lifecycle state needed by the surrounding test scenario.
async function startServer(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP');
  return (address as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('provider proxy boundary', () => {
  it('proxies a bounded request to an explicitly local model server', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    });

    const result = await proxyRequest({
      url: `http://127.0.0.1:${port}/v1/models`,
      method: 'GET',
      provider: 'local',
      headers: { Accept: 'application/json' },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { data: [{ id: 'local-model' }] },
      truncated: false,
    });
  });

  it('rejects an arbitrary public destination without a supported provider policy', async () => {
    await expect(
      proxyRequest({
        url: 'https://example.com/v1/models',
        method: 'GET',
      }),
    ).rejects.toThrow('not associated with a supported provider');
  });

  it('blocks private-network custom provider targets before connection', async () => {
    await expect(
      proxyRequest({
        url: 'http://10.0.0.5/v1/models',
        method: 'GET',
        provider: 'opencode',
      }),
    ).rejects.toThrow('private, link-local, or reserved');
  });

  it('rejects browser-supplied cookies and forwarding headers', async () => {
    await expect(
      proxyRequest({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        provider: 'openai',
        headers: { Cookie: 'session=secret' },
      }),
    ).rejects.toThrow('not allowed');
  });
});
