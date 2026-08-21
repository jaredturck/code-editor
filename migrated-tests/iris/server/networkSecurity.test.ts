/**
 * Verifies that outbound bridge requests resolve and classify destinations before opening a
 * socket, re-check every redirect, and stop reading once the configured byte ceiling is
 * reached. These cases protect the bridge from becoming a route into local or reserved
 * network services while retaining explicitly scoped loopback access for local AI servers.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveAndValidateRemoteUrl,
  safeRemoteRequestBuffer,
} from '../../server/desktopBridge/shared/networkSecurity';
import {
  createProviderProxyRequestPolicy,
  normalizeProviderProxyHeaders,
} from '../../server/desktopBridge/shared/providerProxyPolicy';

const servers: http.Server[] = [];

// Starts server and establishes the lifecycle state needed by the surrounding test scenario.
async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://pinned.test:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('network security boundary', () => {
  it('allows a public DNS answer and rejects private or mixed answers', async () => {
    const publicResult = await resolveAndValidateRemoteUrl('https://example.test/data', {
      // Resolves resolver from the available configuration and runtime context.
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    expect(publicResult.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);

    await expect(
      resolveAndValidateRemoteUrl('https://internal.test/data', {
        // Resolves resolver from the available configuration and runtime context.
        resolver: async () => [{ address: '10.0.0.8', family: 4 }],
      }),
    ).rejects.toThrow('private, link-local, or reserved');

    await expect(
      resolveAndValidateRemoteUrl('https://mixed.test/data', {
        // Resolves resolver from the available configuration and runtime context.
        resolver: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ],
      }),
    ).rejects.toThrow('private, link-local, or reserved');
  });

  it('permits loopback only when the caller selects the loopback policy', async () => {
    await expect(resolveAndValidateRemoteUrl('http://127.0.0.1:11434')).rejects.toThrow('loopback');

    const result = await resolveAndValidateRemoteUrl('http://localhost:11434', {
      addressMode: 'loopback',
    });
    expect(result.addresses.every((entry) => ['127.0.0.1', '::1'].includes(entry.address))).toBe(
      true,
    );
  });

  it('pins the socket to the validated DNS answer instead of resolving again', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pinned response');
    });

    const response = await safeRemoteRequestBuffer(`${baseUrl}/data`, {
      method: 'GET',
      policy: {
        addressMode: 'loopback',
        allowedProtocols: ['http:'],
        allowedMethods: ['GET'],
        // Resolves resolver from the available configuration and runtime context.
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      },
    });

    expect(response.status).toBe(200);
    expect(response.bytes.toString('utf8')).toBe('pinned response');
  });

  it('validates a redirect destination before following it', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(302, { Location: 'http://10.0.0.12/admin' });
      res.end();
    });

    await expect(
      safeRemoteRequestBuffer(`${baseUrl}/redirect`, {
        method: 'GET',
        policy: {
          addressMode: 'public-or-loopback',
          allowedProtocols: ['http:'],
          allowedMethods: ['GET'],
          // Resolves resolver from the available configuration and runtime context.
          resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        },
      }),
    ).rejects.toThrow('private, link-local, or reserved');
  });

  it('applies the total deadline while DNS resolution is still pending', async () => {
    await expect(
      safeRemoteRequestBuffer('http://never-resolves.test/data', {
        method: 'GET',
        policy: {
          addressMode: 'public',
          allowedProtocols: ['http:'],
          allowedMethods: ['GET'],
          timeoutMs: 1000,
          idleTimeoutMs: 5000,
          // Resolves resolver from the available configuration and runtime context.
          resolver: () => new Promise<Array<{ address: string; family: number }>>(() => {}),
        },
      }),
    ).rejects.toThrow('timed out');
  });

  it('stops an active request when the caller aborts it', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('started');
      setTimeout(() => res.end('late'), 2000);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(
      safeRemoteRequestBuffer(`${baseUrl}/cancel`, {
        method: 'GET',
        signal: controller.signal,
        policy: {
          addressMode: 'loopback',
          allowedProtocols: ['http:'],
          allowedMethods: ['GET'],
          timeoutMs: 5000,
          idleTimeoutMs: 5000,
          // Resolves resolver from the available configuration and runtime context.
          resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        },
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation cancelled',
    });
  });

  it('aborts a response that stalls beyond the idle timeout', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('started');
      setTimeout(() => res.end('late'), 1600);
    });

    await expect(
      safeRemoteRequestBuffer(`${baseUrl}/stall`, {
        method: 'GET',
        policy: {
          addressMode: 'loopback',
          allowedProtocols: ['http:'],
          allowedMethods: ['GET'],
          timeoutMs: 5000,
          idleTimeoutMs: 1000,
          // Resolves resolver from the available configuration and runtime context.
          resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        },
      }),
    ).rejects.toThrow('idle timeout');
  });

  it('truncates a remote body at the configured byte ceiling', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('0123456789');
    });

    const response = await safeRemoteRequestBuffer(`${baseUrl}/large`, {
      method: 'GET',
      policy: {
        addressMode: 'loopback',
        allowedProtocols: ['http:'],
        allowedMethods: ['GET'],
        maxResponseBytes: 5,
        // Resolves resolver from the available configuration and runtime context.
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      },
    });

    expect(response.truncated).toBe(true);
    expect(response.bytes.toString('utf8')).toBe('01234');
  });
});

describe('provider proxy policy', () => {
  it('allows only the canonical hosted-provider API destination and path', () => {
    const allowed = createProviderProxyRequestPolicy(
      'https://api.openai.com/v1/chat/completions',
      'openai',
    );
    expect(allowed.providerId).toBe('openai');

    expect(() =>
      createProviderProxyRequestPolicy('https://example.com/v1/chat/completions', 'openai'),
    ).toThrow('does not allow destination');
    expect(() =>
      createProviderProxyRequestPolicy('https://api.openai.com/admin', 'openai'),
    ).toThrow('does not allow this API path');
  });

  it('allows DeepSeek model discovery and chat requests only on its official host', () => {
    expect(
      createProviderProxyRequestPolicy('https://api.deepseek.com/v1/models', 'deepseek').providerId,
    ).toBe('deepseek');
    expect(
      createProviderProxyRequestPolicy('https://api.deepseek.com/v1/chat/completions', 'deepseek')
        .providerId,
    ).toBe('deepseek');
    expect(() =>
      createProviderProxyRequestPolicy('https://example.com/v1/chat/completions', 'deepseek'),
    ).toThrow('does not allow destination');
  });

  it('rejects headers outside the provider-specific allowlist', () => {
    expect(
      normalizeProviderProxyHeaders('openai', {
        Authorization: 'Bearer test',
        'Content-Type': 'application/json',
      }),
    ).toMatchObject({ Authorization: 'Bearer test' });

    expect(() =>
      normalizeProviderProxyHeaders('openai', {
        Cookie: 'session=secret',
      }),
    ).toThrow('not allowed');
  });
});
