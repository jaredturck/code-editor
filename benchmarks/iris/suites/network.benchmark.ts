/** Benchmarks request-policy, authorization, launcher-safety, and HTTP transport boundaries. */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import {
  DEFAULT_BRIDGE_PERMISSIONS,
  normalizeBridgePermissions,
  requireBridgePermission,
} from '../../../backend/desktopBridge/shared/bridgeAuthorization.js'
import {
  classifyLauncherRequest,
  consumeLauncherApproval,
  createLauncherApproval,
  normalizeLauncherRequest,
} from '../../../backend/desktopBridge/shared/launcherSafety.js'
import {
  normalizeRemoteRequestHeaders,
  safeRemoteRequestBuffer,
} from '../../../backend/desktopBridge/shared/networkSecurity.js'
import {
  createProviderProxyRequestPolicy,
  normalizeProviderProxyHeaders,
} from '../../../backend/desktopBridge/shared/providerProxyPolicy.js'
import type { BenchmarkDefinition } from '../core/types.js'

interface LoopbackApiContext {
  server: Server
  baseUrl: string
}

/** Starts a deterministic loopback API so transport measurements never depend on the internet. */
async function createLoopbackApiContext(): Promise<LoopbackApiContext> {
  const smallPayload = JSON.stringify({
    status: 'ok',
    values: Array.from({ length: 64 }, (_, index) => index),
  })
  const largePayload = JSON.stringify({
    status: 'ok',
    content: 'iris-network-benchmark '.repeat(10_000),
  })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/large') {
      response.end(largePayload)
      return
    }
    if (request.url === '/chunks') {
      let index = 0
      const writeNext = (): void => {
        if (index >= 100) {
          response.end()
          return
        }
        response.write(Buffer.alloc(1024, index % 251))
        index += 1
        setImmediate(writeNext)
      }
      writeNext()
      return
    }
    response.end(smallPayload)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

/** Stops the isolated loopback API after its benchmark case completes. */
async function closeLoopbackApiContext(context: LoopbackApiContext): Promise<void> {
  context.server.close()
  await once(context.server, 'close')
}

/** Fetches one loopback response through IRIS's DNS, address, timeout, and size policy. */
function requestLoopbackBuffer(context: LoopbackApiContext, pathname: string, maximumBytes: number) {
  return safeRemoteRequestBuffer(`${context.baseUrl}${pathname}`, {
    policy: {
      addressMode: 'loopback',
      allowedProtocols: ['http:'],
      allowedHosts: ['127.0.0.1'],
      allowedMethods: ['GET'],
      maxResponseBytes: maximumBytes,
      timeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    },
  })
}

/** Exercises the high-frequency policy work performed before network or operating-system effects. */
export const networkBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'network.loopback-api.small-json',
    suite: 'Network and safety',
    name: 'Validated loopback API request · small JSON',
    description:
      "Runs a real HTTP request through IRIS's production address validation, pinned connection, timeout, header, and bounded-buffer path.",
    iterations: 12,
    warmupIterations: 3,
    setup: createLoopbackApiContext,
    run: (context) => requestLoopbackBuffer(context, '/small', 64 * 1024),
    teardown: closeLoopbackApiContext,
  },
  {
    id: 'network.loopback-api.large-json',
    suite: 'Network and safety',
    name: 'Validated loopback API request · large JSON',
    description:
      'Measures the complete safe request and bounded response-buffer path for a representative 260 KiB API payload.',
    iterations: 10,
    warmupIterations: 2,
    bytesPerOperation: 260 * 1024,
    setup: createLoopbackApiContext,
    run: (context) => requestLoopbackBuffer(context, '/large', 512 * 1024),
    teardown: closeLoopbackApiContext,
  },
  {
    id: 'network.loopback-api.chunked-response',
    suite: 'Network and safety',
    name: 'Validated loopback API request · 100 chunks',
    description: 'Consumes a deliberately chunked response through the production async iterator and cleanup path.',
    iterations: 8,
    warmupIterations: 2,
    bytesPerOperation: 100 * 1024,
    setup: createLoopbackApiContext,
    run: (context) => requestLoopbackBuffer(context, '/chunks', 128 * 1024),
    teardown: closeLoopbackApiContext,
  },
  {
    id: 'network.provider-policy.resolve',
    suite: 'Network and safety',
    name: 'Provider proxy policy resolution',
    description: 'Validates provider identity, protocol, host, path, method, redirect, and address-class policy.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 5000,
    setup: () => ({
      urls: [
        ['https://api.openai.com/v1/chat/completions', 'openai'],
        ['https://api.anthropic.com/v1/messages', 'anthropic'],
        ['https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent', 'gemini'],
        ['http://127.0.0.1:11434/api/chat', 'local'],
      ],
    }),
    run: (context) => {
      let result: unknown
      for (let index = 0; index < 5000; index += 1) {
        const [url, provider] = context.urls[index % context.urls.length]
        result = createProviderProxyRequestPolicy(url, provider)
      }
      return result
    },
  },
  {
    id: 'network.headers.normalize',
    suite: 'Network and safety',
    name: 'Remote and provider header normalization',
    description: 'Filters renderer-supplied headers through the generic and provider-specific allowlists.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 5000,
    setup: () => ({
      openAIHeaders: {
        authorization: 'Bearer benchmark',
        'content-type': 'application/json',
      },
      anthropicHeaders: {
        'content-type': 'application/json',
        'x-api-key': 'benchmark',
        'anthropic-version': '2023-06-01',
      },
    }),
    run: (context) => {
      let result: unknown
      for (let index = 0; index < 5000; index += 1) {
        const openAI = index % 2 === 1
        const headers = openAI ? context.openAIHeaders : context.anthropicHeaders
        result = {
          remote: normalizeRemoteRequestHeaders(headers, [
            'authorization',
            'content-type',
            'x-api-key',
            'anthropic-version',
          ]),
          provider: normalizeProviderProxyHeaders(openAI ? 'openai' : 'anthropic', headers),
        }
      }
      return result
    },
  },
  {
    id: 'security.bridge-permissions',
    suite: 'Network and safety',
    name: 'Bridge permission normalization and enforcement',
    description: 'Normalizes partial permission state and enforces the final route-owned capability check.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 10000,
    run: () => {
      let result: unknown
      for (let index = 0; index < 10000; index += 1) {
        const permissions = normalizeBridgePermissions(
          { fileRead: true, fileWrite: index % 2 === 0, terminal: true },
          DEFAULT_BRIDGE_PERMISSIONS,
        )
        requireBridgePermission({ permissions }, 'fileRead')
        result = permissions
      }
      return result
    },
  },
  {
    id: 'security.launcher-classification',
    suite: 'Network and safety',
    name: 'Launcher normalization and risk classification',
    description:
      'Parses structured and legacy commands, renders review text, and detects destructive or elevated actions.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 5000,
    setup: () => ({
      requests: [
        { executable: 'code', args: ['.'], category: 'application' },
        { command: 'git status --short', category: 'command' },
        {
          executable: 'rm',
          args: ['-rf', '/tmp/example'],
          category: 'command',
        },
        { command: 'npm test | tee result.log', category: 'script' },
      ],
    }),
    run: (context) => {
      let result: unknown
      for (let index = 0; index < 5000; index += 1) {
        const request = normalizeLauncherRequest(context.requests[index % context.requests.length], '/tmp')
        result = { request, risk: classifyLauncherRequest(request) }
      }
      return result
    },
  },
  {
    id: 'security.launcher-approval',
    suite: 'Network and safety',
    name: 'One-time launcher approval lifecycle',
    description: 'Creates, signs, validates, and consumes command-bound approval records.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 1000,
    setup: () => ({
      request: normalizeLauncherRequest(
        { executable: 'git', args: ['clean', '-fdx'], category: 'command' },
        '/tmp/project',
      ),
    }),
    run: (context) => {
      let accepted = false
      for (let index = 0; index < 1000; index += 1) {
        const approval = createLauncherApproval(context.request)
        accepted = consumeLauncherApproval(approval, context.request)
      }
      return accepted
    },
  },
]
