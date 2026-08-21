/** Blocks accidental paid or internet traffic while allowing loopback model and fixture servers. */

import http from 'node:http';
import https from 'node:https';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface BenchmarkNetworkGuard {
  readonly blockedAttempts: number;
  readonly blockedUrls: string[];
  restore: () => void;
}

/** Returns the requested hostname from Node's URL/string/options request overloads. */
function requestHostname(input: unknown): string {
  if (input instanceof URL) return input.hostname;
  if (typeof input === 'string') {
    try {
      return new URL(input).hostname;
    } catch {
      return '';
    }
  }
  if (!input || typeof input !== 'object') return '';
  const options = input as {
    hostname?: unknown;
    host?: unknown;
    socketPath?: unknown;
  };
  if (options.socketPath) return '';
  const value = String(options.hostname || options.host || '').trim();
  if (!value) return '';
  if (value.startsWith('[')) return value.split(']')[0] + ']';
  return value.includes(':') && !value.includes('::') ? value.split(':')[0] : value;
}

/** Installs fetch and Node HTTP guards that reject every non-loopback destination. */
export function installBenchmarkNetworkGuard(): BenchmarkNetworkGuard {
  const originalFetch = globalThis.fetch;
  const httpModule = http as typeof http & Record<string, any>;
  const httpsModule = https as typeof https & Record<string, any>;
  const originalHttpRequest = httpModule.request;
  const originalHttpGet = httpModule.get;
  const originalHttpsRequest = httpsModule.request;
  const originalHttpsGet = httpsModule.get;
  const state = {
    blockedAttempts: 0,
    blockedUrls: [] as string[],
  };

  const block = (destination: string): never => {
    state.blockedAttempts += 1;
    state.blockedUrls.push(destination);
    throw new Error(
      `Benchmark network guard blocked non-loopback request to ${destination}. ` +
        'Benchmarks never call paid or remote provider APIs.',
    );
  };

  const assertLoopbackRequest = (protocol: string, firstArgument: unknown): void => {
    const hostname = requestHostname(firstArgument);
    if (!hostname || LOOPBACK_HOSTS.has(hostname)) return;
    block(`${protocol}//${hostname}`);
  };

  httpModule.request = function guardedHttpRequest(...args: any[]) {
    assertLoopbackRequest('http:', args[0]);
    return originalHttpRequest.apply(this, args as any);
  };
  httpModule.get = function guardedHttpGet(...args: any[]) {
    assertLoopbackRequest('http:', args[0]);
    return originalHttpGet.apply(this, args as any);
  };
  httpsModule.request = function guardedHttpsRequest(...args: any[]) {
    assertLoopbackRequest('https:', args[0]);
    return originalHttpsRequest.apply(this, args as any);
  };
  httpsModule.get = function guardedHttpsGet(...args: any[]) {
    assertLoopbackRequest('https:', args[0]);
    return originalHttpsGet.apply(this, args as any);
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : String((input as Request).url || '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return block(raw || '<invalid URL>');
    }
    if (!['http:', 'https:'].includes(url.protocol) || LOOPBACK_HOSTS.has(url.hostname)) {
      return originalFetch(input, init);
    }
    return block(url.toString());
  }) as typeof fetch;

  return {
    get blockedAttempts() {
      return state.blockedAttempts;
    },
    get blockedUrls() {
      return [...state.blockedUrls];
    },
    restore: () => {
      globalThis.fetch = originalFetch;
      httpModule.request = originalHttpRequest;
      httpModule.get = originalHttpGet;
      httpsModule.request = originalHttpsRequest;
      httpsModule.get = originalHttpsGet;
    },
  };
}
