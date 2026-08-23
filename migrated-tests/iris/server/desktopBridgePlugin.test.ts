/**
 * Exercises the observable desktop bridge plugin contract, with regression cases for
 * “registers the same middleware for development and preview servers” and “passes non-local
 * requests to the next middleware”. The suite documents caller-visible behavior so
 * implementation refactors cannot silently weaken those guarantees.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { desktopBridgePlugin } from '../../server/desktopBridgePlugin'
import {
  closeEncryptedDatabase,
  initializeEncryptedDatabase,
} from '../../server/desktopBridge/storage/encryptedDatabase'

const fixtureRoot = path.resolve('tests/fixtures/workspace')
const writtenFixture = path.join(fixtureRoot, 'written-by-test.txt')
const temporaryRoots: string[] = []

interface TestServer {
  middlewares: {
    use: (callback: Connect.NextHandleFunction) => void
  }
}

interface TestPlugin {
  name: string
  configureServer: (server: TestServer) => void
  configurePreviewServer: (server: TestServer) => void
}

interface BridgeTestJson {
  ok?: boolean
  session?: {
    cwd?: string
    platform?: string
  }
  rootPath?: string
  tree?: {
    name?: string
    type?: string
    children?: Array<{ name?: string; type?: string }>
  }
  content?: string
  startLine?: number
  endLine?: number
  hasMore?: boolean
  error?: string
}

interface BridgeTestResponse {
  status: number
  headers: Record<string, string | number | readonly string[]>
  nextCalled: boolean
  text: string
  json: BridgeTestJson | null
}

// Creates middleware with the state and dependencies required by the surrounding test scenario.
function createMiddleware(baseDir = fixtureRoot): Connect.NextHandleFunction {
  let middleware: Connect.NextHandleFunction | null = null
  const plugin = desktopBridgePlugin({ baseDir }) as TestPlugin
  plugin.configureServer({
    middlewares: {
      // Provides the use helper used by the surrounding test scenario.
      use(callback) {
        middleware = callback
      },
    },
  })
  return middleware as unknown as Connect.NextHandleFunction
}

// Invokes bridge through the boundary owned by the surrounding test scenario.
async function invokeBridge({
  url,
  method = 'GET',
  body,
  baseDir = fixtureRoot,
}: {
  url: string
  method?: string
  body?: unknown
  baseDir?: string
}): Promise<BridgeTestResponse> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload) as Readable & Partial<IncomingMessage>
  req.url = url
  req.method = method
  req.headers = {}

  const headers: Record<string, string | number | readonly string[]> = {}
  let responseBody = ''
  let nextCalled = false
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = value
      return this
    },
    end(value: string | Buffer = '') {
      responseBody += String(value)
      return this
    },
  }

  const middleware = createMiddleware(baseDir)
  await middleware(req as IncomingMessage, res as unknown as ServerResponse, () => {
    nextCalled = true
  })

  return {
    status: res.statusCode,
    headers,
    nextCalled,
    text: responseBody,
    json: responseBody ? (JSON.parse(responseBody) as BridgeTestJson) : null,
  }
}

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-plugin-storage-'))
  temporaryRoots.push(root)
  await initializeEncryptedDatabase({
    databasePath: path.join(root, 'iris.sqlite3'),
    masterKey: randomBytes(32),
  })
})

afterEach(async () => {
  await closeEncryptedDatabase()
  await fs.rm(writtenFixture, { force: true })
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('desktopBridgePlugin', () => {
  it('registers the same middleware for development and preview servers', () => {
    const callbacks: Connect.NextHandleFunction[] = []
    const plugin = desktopBridgePlugin({ baseDir: fixtureRoot }) as TestPlugin
    const server: TestServer = {
      middlewares: { use: (callback) => callbacks.push(callback) },
    }
    plugin.configureServer(server)
    plugin.configurePreviewServer(server)
    expect(plugin.name).toBe('orbit-desktop-bridge')
    expect(callbacks).toHaveLength(2)
    expect(callbacks[0]).toBe(callbacks[1])
  })

  it('passes non-local requests to the next middleware', async () => {
    const response = await invokeBridge({ url: '/ordinary-page' })
    expect(response.nextCalled).toBe(true)
    expect(response.text).toBe('')
  })

  it('serves local bridge health without external side effects', async () => {
    const response = await invokeBridge({ url: '/api/local/health' })
    expect(response.status).toBe(200)
    expect(String(response.headers['content-type'])).toContain('application/json')
    expect(response.json).toMatchObject({ ok: true })
  })

  it('returns local session information rooted at the configured fixture', async () => {
    const response = await invokeBridge({ url: '/api/local/session' })
    expect(response.status).toBe(200)
    expect(response.json?.session).toMatchObject({
      cwd: fixtureRoot,
      platform: expect.any(String),
    })
  })

  it('lists the deterministic fixture workspace', async () => {
    const response = await invokeBridge({
      url: '/api/local/fs/list',
      method: 'POST',
      body: { path: '.', depth: 2 },
    })
    expect(response.status).toBe(200)
    expect(response.json?.rootPath).toBe(fixtureRoot)
    expect(response.json?.tree).toMatchObject({
      name: 'workspace',
      type: 'dir',
      children: expect.arrayContaining([
        expect.objectContaining({ name: 'README.md', type: 'file' }),
        expect.objectContaining({ name: 'nested', type: 'dir' }),
      ]),
    })
  })

  it('reads a bounded range from a fixture text file', async () => {
    const response = await invokeBridge({
      url: '/api/local/fs/read',
      method: 'POST',
      body: { path: 'nested/example.txt', startLine: 2, lineCount: 1 },
    })
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({
      content: 'beta',
      startLine: 2,
      endLine: 2,
      hasMore: true,
    })
  })

  it('writes only inside the configured fixture workspace', async () => {
    const response = await invokeBridge({
      url: '/api/local/fs/write',
      method: 'POST',
      body: { path: 'written-by-test.txt', content: 'deterministic content' },
    })
    expect(response.status).toBe(200)
    expect(await fs.readFile(writtenFixture, 'utf8')).toBe('deterministic content')
  })

  it('returns a structured client error for missing required file paths', async () => {
    const response = await invokeBridge({
      url: '/api/local/fs/read',
      method: 'POST',
      body: {},
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.json?.error).toEqual(expect.any(String))
  })

  it('rejects malformed agent identifiers at the bridge boundary', async () => {
    const response = await invokeBridge({
      url: '/api/local/agent/register',
      method: 'POST',
      body: { agentId: 'bad agent!', capabilities: ['files.read'] },
    })
    expect(response.status).toBe(400)
    expect(response.json?.error).toContain('unsupported characters')
  })

  it('passes unknown local endpoints to the next middleware', async () => {
    const response = await invokeBridge({ url: '/api/local/not-a-route' })
    expect(response.nextCalled).toBe(true)
  })
})
