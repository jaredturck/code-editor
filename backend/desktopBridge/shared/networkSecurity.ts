/**
 * Performs outbound HTTP requests for bridge features that consume remote content or proxy
 * provider traffic. Every destination is resolved before connection, all resolved addresses
 * are checked against the selected public/loopback policy, and the connection is pinned to a
 * validated address so a second DNS answer cannot redirect the request into the local network.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

export type RemoteAddressMode = 'public' | 'loopback' | 'public-or-loopback'

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export interface RemoteRequestPolicy {
  addressMode?: RemoteAddressMode
  allowedProtocols?: readonly ('http:' | 'https:')[]
  allowedHosts?: readonly string[]
  allowedMethods?: readonly string[]
  allowCrossOriginRedirects?: boolean
  maxRedirects?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  timeoutMs?: number
  idleTimeoutMs?: number
  validateUrl?: (url: URL) => void
  resolver?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>
}

export interface SafeRemoteRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
  policy?: RemoteRequestPolicy
  signal?: AbortSignal
}

export interface SafeRemoteResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
  body: IncomingMessage
  cleanup: () => void
}

export interface SafeRemoteBufferResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
  bytes: Buffer
  truncated: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-goog-api-key',
])

const loopbackIpv4BlockList = new BlockList()
loopbackIpv4BlockList.addSubnet('127.0.0.0', 8, 'ipv4')
const loopbackIpv6BlockList = new BlockList()
loopbackIpv6BlockList.addAddress('::1', 'ipv6')

const blockedIpv4AddressList = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4AddressList.addSubnet(network, prefix, 'ipv4')
}
const blockedIpv6AddressList = new BlockList()

const publicIpv6AddressList = new BlockList()
publicIpv6AddressList.addSubnet('2000::', 3, 'ipv6')
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6AddressList.addSubnet(network, prefix, 'ipv6')
}

// Attaches a stable HTTP status to a network policy error for route handling.
function withStatus(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

// Normalizes hostnames before allowlist, loopback, and address-range comparisons.
function normalizedHostname(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

// Matches a hostname against an exact or wildcard host policy entry.
function hostMatches(hostname: string, pattern: string): boolean {
  const host = normalizedHostname(hostname)
  const candidate = normalizedHostname(pattern)
  if (!host || !candidate) return false
  if (candidate.startsWith('*.')) {
    const suffix = candidate.slice(2)
    return host !== suffix && host.endsWith(`.${suffix}`)
  }
  return host === candidate
}

/** Identifies addresses that refer back to the current machine. */
export function isLoopbackAddress(address: string, family?: number): boolean {
  const detected = family || isIP(address)
  if (detected !== 4 && detected !== 6) return false
  return detected === 4 ? loopbackIpv4BlockList.check(address, 'ipv4') : loopbackIpv6BlockList.check(address, 'ipv6')
}

/**
 * Identifies addresses that must not be reached by public web or hosted-provider requests.
 * Loopback is classified separately because local-model operations may opt into it explicitly.
 */
export function isBlockedRemoteAddress(address: string, family?: number): boolean {
  const detected = family || isIP(address)
  if (detected !== 4 && detected !== 6) return true
  if (isLoopbackAddress(address, detected)) return false
  if (detected === 4) return blockedIpv4AddressList.check(address, 'ipv4')
  return !publicIpv6AddressList.check(address, 'ipv6') || blockedIpv6AddressList.check(address, 'ipv6')
}

/**
 * Copies only headers approved for the selected remote API. Rejecting unknown headers keeps
 * browser-supplied cookies, forwarding metadata, and connection controls out of proxy calls.
 */
export function normalizeRemoteRequestHeaders(
  headers: Record<string, unknown> | undefined,
  allowedHeaderNames: readonly string[] = [],
): Record<string, string> {
  const allowed = new Set(allowedHeaderNames.map((name) => name.toLowerCase()))
  const output: Record<string, string> = {}

  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || '').trim()
    const lower = name.toLowerCase()
    if (!name || !allowed.has(lower)) {
      throw withStatus(`Request header is not allowed by the remote destination policy: ${name}`, 400)
    }
    if (/[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(name) || /[\r\n]/.test(name)) {
      throw withStatus('Remote request contains an invalid header name', 400)
    }

    const value = String(rawValue ?? '').trim()
    if (!value || value.length > 12_000 || /[\r\n]/.test(value)) {
      throw withStatus(`Remote request header has an invalid value: ${name}`, 400)
    }
    output[name] = value
  }

  return output
}

// Converts response headers into a plain bounded record returned by the bridge.
export function responseHeadersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) output[name.toLowerCase()] = value.join(', ')
    else if (value !== undefined) output[name.toLowerCase()] = String(value)
  }
  return output
}

/**
 * Parses and resolves one outbound destination, then verifies every returned address against
 * the caller's public or loopback policy. The returned addresses are later used by the socket
 * lookup callback, binding validation and connection to the same DNS result.
 */
export async function resolveAndValidateRemoteUrl(
  input: string | URL,
  policy: RemoteRequestPolicy = {},
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(String(input || ''))
  } catch {
    throw withStatus('Invalid remote URL', 400)
  }

  const allowedProtocols = policy.allowedProtocols || ['https:', 'http:']
  if (!allowedProtocols.includes(url.protocol as 'http:' | 'https:')) {
    throw withStatus(`Remote URL protocol is not allowed: ${url.protocol}`, 400)
  }
  if (url.username || url.password) {
    throw withStatus('Remote URLs must not contain embedded credentials', 400)
  }
  policy.validateUrl?.(url)

  const hostname = normalizedHostname(url.hostname)
  if (!hostname) throw withStatus('Remote URL is missing a hostname', 400)

  if (policy.allowedHosts?.length && !policy.allowedHosts.some((pattern) => hostMatches(hostname, pattern))) {
    throw withStatus(`Remote destination is not allowed: ${hostname}`, 403)
  }

  const literalFamily = isIP(hostname)
  let addresses: ResolvedAddress[]
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [{ address: hostname, family: literalFamily }]
  } else if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    addresses = [
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ]
  } else {
    const resolver =
      policy.resolver ||
      ((hostname: string, options: { all: true; verbatim: true }) =>
        dnsLookup(hostname, options) as Promise<Array<{ address: string; family: number }>>)
    let resolved: Array<{ address: string; family: number }>
    try {
      resolved = await resolver(hostname, { all: true, verbatim: true })
    } catch (error) {
      throw withStatus(
        `Remote destination could not be resolved: ${error instanceof Error ? error.message : 'DNS failure'}`,
        502,
      )
    }
    addresses = (Array.isArray(resolved) ? resolved : [resolved])
      .map((entry) => ({
        address: String(entry.address || ''),
        family: Number(entry.family) === 6 ? (6 as const) : (4 as const),
      }))
      .filter((entry) => Boolean(entry.address))
  }

  if (!addresses.length) {
    throw withStatus('Remote destination did not resolve to an address', 502)
  }

  const mode = policy.addressMode || 'public'
  for (const entry of addresses) {
    const loopback = isLoopbackAddress(entry.address, entry.family)
    const blocked = isBlockedRemoteAddress(entry.address, entry.family)

    if (mode === 'loopback' && !loopback) {
      throw withStatus('Remote destination must resolve to loopback for this operation', 403)
    }
    if (mode === 'public' && loopback) {
      throw withStatus('Remote destination resolves to loopback and is not allowed', 403)
    }
    if (blocked) {
      throw withStatus('Remote destination resolves to a private, link-local, or reserved address', 403)
    }
  }

  return { url, addresses }
}

// Pins socket lookup to the addresses already validated for the destination hostname.
function createPinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const familyOption = options?.family
    const requestedFamily = familyOption === 'IPv4' ? 4 : familyOption === 'IPv6' ? 6 : Number(familyOption || 0)
    const matching = addresses.filter((entry) => !requestedFamily || entry.family === requestedFamily)
    const candidates = matching.length ? matching : [...addresses]
    if (options?.all) {
      callback(
        null,
        candidates.map((entry) => ({ ...entry })),
      )
      return
    }
    const selected = candidates[0]
    callback(null, selected.address, selected.family)
  }
}

// Removes sensitive headers before a redirect crosses to a different origin.
function sanitizeRedirectHeaders(
  headers: Record<string, string>,
  currentUrl: URL,
  nextUrl: URL,
): Record<string, string> {
  if (currentUrl.origin === nextUrl.origin) return { ...headers }
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_REDIRECT_HEADERS.has(name.toLowerCase())),
  )
}

// Restricts remote requests to the HTTP methods supported by the bridge policy.
function normalizeMethod(value: string | undefined, policy: RemoteRequestPolicy): string {
  const method = String(value || 'GET')
    .trim()
    .toUpperCase()
  const allowed = (policy.allowedMethods || ['GET']).map((entry) => entry.toUpperCase())
  if (!allowed.includes(method)) {
    throw withStatus(`Remote request method is not allowed: ${method}`, 400)
  }
  return method
}

// Converts the optional request body into bytes for size enforcement and transmission.
function requestBodyBytes(body: string | Buffer | undefined): number {
  if (body === undefined) return 0
  return Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body, 'utf8')
}

// Creates a status-bearing network error with a stable bridge-facing message.
function remoteRequestError(message: string, cause?: unknown): Error & { statusCode: number } {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : ''
  return withStatus(`${message}${detail}`, 502)
}

/**
 * Opens a bounded remote response while manually handling redirects. Each redirect repeats
 * protocol, host, path, DNS, and address checks before a new connection is opened, and the
 * returned cleanup function owns the total deadline and active response lifecycle.
 */
export async function openSafeRemoteResponse(
  input: string | URL,
  options: SafeRemoteRequestOptions = {},
): Promise<SafeRemoteResponse> {
  const policy = options.policy || {}
  const controller = new AbortController()
  const externalSignal = options.signal
  let abortedByCaller = externalSignal?.aborted === true
  const abortFromCaller = () => {
    abortedByCaller = true
    controller.abort()
  }
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  if (abortedByCaller) controller.abort()
  const timeoutMs = Math.max(1_000, Number(policy.timeoutMs) || DEFAULT_TIMEOUT_MS)
  const idleTimeoutMs = Math.max(1_000, Number(policy.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS)
  const maxRedirects = Math.max(
    0,
    policy.maxRedirects === undefined ? DEFAULT_MAX_REDIRECTS : Number(policy.maxRedirects),
  )
  const maxRequestBytes = Math.max(
    0,
    policy.maxRequestBytes === undefined ? DEFAULT_MAX_REQUEST_BYTES : Number(policy.maxRequestBytes),
  )
  const totalTimer = setTimeout(() => controller.abort(), timeoutMs)
  let activeResponse: IncomingMessage | null = null

  // Releases request listeners and timers after the current remote request settles.
  const cleanup = () => {
    clearTimeout(totalTimer)
    externalSignal?.removeEventListener('abort', abortFromCaller)
    if (!controller.signal.aborted) controller.abort()
    activeResponse?.destroy()
  }

  const abortedError = () => {
    if (abortedByCaller) {
      const error = new Error('Operation cancelled')
      error.name = 'AbortError'
      return error
    }
    return withStatus(`Remote request timed out after ${Math.round(timeoutMs / 1000)}s`, 504)
  }

  // Completes URL resolution within the remaining request deadline.
  const resolveBeforeDeadline = async (target: string | URL) => {
    if (controller.signal.aborted) {
      throw abortedError()
    }
    return new Promise<Awaited<ReturnType<typeof resolveAndValidateRemoteUrl>>>((resolve, reject) => {
      const onAbort = () => {
        reject(abortedError())
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      resolveAndValidateRemoteUrl(target, policy).then(
        (value) => {
          controller.signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error) => {
          controller.signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  }

  // Performs the pinned HTTP request and bounds the response before returning it to the caller.
  const requestTarget = async (
    target: string | URL,
    methodInput: string | undefined,
    headersInput: Record<string, string>,
    bodyInput: string | Buffer | undefined,
    redirectCount: number,
  ): Promise<SafeRemoteResponse> => {
    const { url, addresses } = await resolveBeforeDeadline(target)
    const method = normalizeMethod(methodInput, policy)
    const bodySize = requestBodyBytes(bodyInput)
    if (bodySize > maxRequestBytes) {
      throw withStatus(`Remote request body exceeds ${maxRequestBytes} bytes`, 413)
    }

    const transport = url.protocol === 'https:' ? https : http
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method,
          headers: headersInput,
          lookup: createPinnedLookup(addresses),
          signal: controller.signal,
        },
        resolve,
      )
      request.setTimeout(idleTimeoutMs, () => {
        request.destroy(remoteRequestError('Remote request exceeded the idle timeout'))
      })
      request.once('error', (error) => {
        if (controller.signal.aborted) {
          reject(abortedError())
          return
        }
        reject(remoteRequestError('Remote request failed', error))
      })
      if (bodyInput !== undefined && method !== 'GET' && method !== 'HEAD') request.write(bodyInput)
      request.end()
    })

    activeResponse = response
    response.setTimeout(idleTimeoutMs, () => {
      response.destroy(remoteRequestError('Remote response exceeded the idle timeout'))
    })

    const status = Number(response.statusCode || 0)
    const location = response.headers.location
    if (REDIRECT_STATUSES.has(status) && location) {
      if (redirectCount >= maxRedirects) {
        response.destroy()
        throw withStatus(`Remote request exceeded ${maxRedirects} redirects`, 508)
      }

      const nextUrl = new URL(String(location), url)
      if (policy.allowCrossOriginRedirects === false && nextUrl.origin !== url.origin) {
        response.destroy()
        throw withStatus('Remote destination attempted a cross-origin redirect', 403)
      }

      let nextMethod = method
      let nextBody = bodyInput
      let nextHeaders = sanitizeRedirectHeaders(headersInput, url, nextUrl)
      if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
        nextMethod = 'GET'
        nextBody = undefined
        nextHeaders = Object.fromEntries(
          Object.entries(nextHeaders).filter(
            ([name]) => !['content-length', 'content-type'].includes(name.toLowerCase()),
          ),
        )
      }

      response.resume()
      return requestTarget(nextUrl, nextMethod, nextHeaders, nextBody, redirectCount + 1)
    }

    return {
      status,
      statusText: String(response.statusMessage || ''),
      headers: responseHeadersToRecord(response.headers),
      url: url.toString(),
      body: response,
      cleanup,
    }
  }

  try {
    return await requestTarget(input, options.method, options.headers || {}, options.body, 0)
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * Reads a validated remote response into a byte-limited buffer. Callers receive an explicit
 * truncation flag instead of allowing an unexpectedly large response to grow without bound.
 */
export async function safeRemoteRequestBuffer(
  input: string | URL,
  options: SafeRemoteRequestOptions = {},
): Promise<SafeRemoteBufferResponse> {
  const policy = options.policy || {}
  const maxResponseBytes = Math.max(1, Number(policy.maxResponseBytes) || DEFAULT_MAX_RESPONSE_BYTES)
  const response = await openSafeRemoteResponse(input, options)
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false

  try {
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const remaining = maxResponseBytes - total
      if (remaining <= 0) {
        truncated = true
        response.body.destroy()
        break
      }
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, remaining))
        total += remaining
        truncated = true
        response.body.destroy()
        break
      }
      chunks.push(chunk)
      total += chunk.byteLength
    }
  } catch (error) {
    if (options.signal?.aborted) {
      const abortError = new Error('Operation cancelled')
      abortError.name = 'AbortError'
      throw abortError
    }
    if (!truncated) throw remoteRequestError('Failed while reading the remote response', error)
  } finally {
    response.cleanup()
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url,
    bytes: Buffer.concat(chunks, total),
    truncated,
  }
}
