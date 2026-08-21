/**
 * Defines which remote AI endpoints the bridge may contact on behalf of provider adapters.
 * Hosted providers are restricted to their canonical API hosts, while the two configurable
 * provider types retain their intended flexibility under stricter path and address rules.
 */

import type { RemoteRequestPolicy } from './networkSecurity.js';
import { normalizeRemoteRequestHeaders } from './networkSecurity.js';

export type ProviderProxyId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'opencode'
  | 'local';

interface ProviderDestinationRule {
  hosts?: readonly string[];
  protocols: readonly ('http:' | 'https:')[];
  path: RegExp;
  methods: readonly string[];
  headers: readonly string[];
  addressMode: RemoteRequestPolicy['addressMode'];
  allowCustomHost?: boolean;
}

const COMMON_JSON_HEADERS = ['accept', 'content-type'];
const AUTHORIZATION_HEADERS = ['authorization', 'openai-organization', 'openai-project'];

const RULES: Record<ProviderProxyId, ProviderDestinationRule> = {
  anthropic: {
    hosts: ['api.anthropic.com'],
    protocols: ['https:'],
    path: /^\/v1\/(?:messages|models)(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, 'x-api-key', 'anthropic-version', 'anthropic-beta'],
    addressMode: 'public',
  },
  openai: {
    hosts: ['api.openai.com'],
    protocols: ['https:'],
    path: /^\/v1\/(?:chat\/completions|responses|models)(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, ...AUTHORIZATION_HEADERS],
    addressMode: 'public',
  },
  gemini: {
    hosts: ['generativelanguage.googleapis.com'],
    protocols: ['https:'],
    path: /^\/v1beta\/models(?:\/|$|:)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, 'x-goog-api-key'],
    addressMode: 'public',
  },
  deepseek: {
    hosts: ['api.deepseek.com'],
    protocols: ['https:'],
    path: /^\/v1\/(?:chat\/completions|models)(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, ...AUTHORIZATION_HEADERS],
    addressMode: 'public',
  },
  openrouter: {
    hosts: ['openrouter.ai'],
    protocols: ['https:'],
    path: /^\/api\/v1\/(?:chat\/completions|models)(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, ...AUTHORIZATION_HEADERS, 'http-referer', 'x-title'],
    addressMode: 'public',
  },
  // opencode is both a hosted service and self-hostable, so a user-configured custom host is
  // intentionally permitted. This is the broadest provider rule, so its residual exposure is
  // bounded deliberately: private/link-local/metadata addresses are still rejected by the
  // network layer (isBlockedRemoteAddress), the path is restricted to the v1 chat/models API,
  // only the allowlisted headers are forwarded, and cross-origin redirects are disabled. The
  // accepted residual is that a user who points ai_opencode_url at an attacker-controlled
  // *public* host would send their opencode key there — a configuration the user must set.
  opencode: {
    hosts: ['opencode.ai', 'api.opencode.ai'],
    protocols: ['https:', 'http:'],
    path: /(?:^|\/)v1\/(?:chat\/completions|models)(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, ...AUTHORIZATION_HEADERS],
    addressMode: 'public-or-loopback',
    allowCustomHost: true,
  },
  local: {
    protocols: ['http:', 'https:'],
    path: /(?:^|\/)(?:api\/(?:chat|generate|tags)|v1\/(?:chat\/completions|models))(?:\/|$)/,
    methods: ['GET', 'POST'],
    headers: [...COMMON_JSON_HEADERS, ...AUTHORIZATION_HEADERS],
    addressMode: 'loopback',
    allowCustomHost: true,
  },
};

// Attaches a stable HTTP status to a provider proxy policy error.
function withStatus(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

// Normalizes provider aliases before selecting the matching proxy policy.
function normalizeProviderId(value: unknown): ProviderProxyId | '' {
  const id = String(value || '')
    .trim()
    .toLowerCase();
  return id in RULES ? (id as ProviderProxyId) : '';
}

// Rejects provider URLs whose scheme, host, port, or path falls outside the selected provider
// policy.
function assertProviderUrlAllowed(
  providerId: ProviderProxyId,
  rule: ProviderDestinationRule,
  url: URL,
): void {
  if (!rule.protocols.includes(url.protocol as 'http:' | 'https:')) {
    throw withStatus(`The ${providerId} proxy does not allow ${url.protocol} destinations`, 403);
  }
  if (!rule.path.test(url.pathname)) {
    throw withStatus(`The ${providerId} proxy does not allow this API path`, 403);
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (rule.hosts?.length && !rule.hosts.includes(hostname) && !rule.allowCustomHost) {
    throw withStatus(`The ${providerId} proxy does not allow destination ${url.hostname}`, 403);
  }
}

// Infers the configured provider family from a known provider endpoint.
function inferProviderFromUrl(url: URL): ProviderProxyId | '' {
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'api.anthropic.com') return 'anthropic';
  if (host === 'api.openai.com') return 'openai';
  if (host === 'generativelanguage.googleapis.com') return 'gemini';
  if (host === 'api.deepseek.com') return 'deepseek';
  if (host === 'openrouter.ai') return 'openrouter';
  if (host === 'opencode.ai' || host === 'api.opencode.ai') return 'opencode';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    return 'local';
  }
  return '';
}

/**
 * Selects the destination contract for one provider request. The provider identity narrows
 * the remote host, API path, methods, headers, and address class before the network helper is
 * allowed to resolve or connect to the target.
 */
export function createProviderProxyRequestPolicy(
  target: string | URL,
  providerInput?: unknown,
): {
  providerId: ProviderProxyId;
  url: URL;
  policy: RemoteRequestPolicy;
} {
  let url: URL;
  try {
    url = target instanceof URL ? new URL(target.toString()) : new URL(String(target || ''));
  } catch {
    throw withStatus('Invalid target URL for AI proxy request', 400);
  }

  const providerId = normalizeProviderId(providerInput) || inferProviderFromUrl(url);
  if (!providerId) {
    throw withStatus('AI proxy destination is not associated with a supported provider', 403);
  }

  const rule = RULES[providerId];
  assertProviderUrlAllowed(providerId, rule, url);

  return {
    providerId,
    url,
    policy: {
      addressMode: rule.addressMode,
      allowedProtocols: rule.protocols,
      allowedHosts: rule.allowCustomHost ? undefined : rule.hosts,
      allowedMethods: rule.methods,
      allowCrossOriginRedirects: false,
      maxRedirects: 2,
      // Validates a redirect destination against the same provider policy as the original request.
      validateUrl: (candidate) => assertProviderUrlAllowed(providerId, rule, candidate),
    },
  };
}

/** Applies the selected provider's header allowlist to a renderer-supplied request. */
export function normalizeProviderProxyHeaders(
  providerId: ProviderProxyId,
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  return normalizeRemoteRequestHeaders(headers, RULES[providerId].headers);
}
