/** Route contract tests migrated from the removed Vite bridge compatibility plugin. */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeEncryptedDatabase,
  initializeEncryptedDatabase,
} from '../../server/desktopBridge/storage/encryptedDatabase'
import { invokeBridgeRoute } from './bridgeRouteTestHarness'

const fixtureRoot = path.resolve('tests/fixtures/workspace')
const writtenFixture = path.join(fixtureRoot, 'written-by-test.txt')
const temporaryRoots: string[] = []

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-route-storage-'))
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

describe('desktop bridge routes', () => {
  it('serves local bridge health without external side effects', async () => {
    const response = await invokeBridgeRoute({ baseDir: fixtureRoot, url: '/api/local/health' })
    expect(response.status).toBe(200)
    expect(String(response.headers['content-type'])).toContain('application/json')
    expect(response.json).toMatchObject({ ok: true })
  })

  it('returns local session information rooted at the configured fixture', async () => {
    const response = await invokeBridgeRoute({ baseDir: fixtureRoot, url: '/api/local/session' })
    expect(response.status).toBe(200)
    expect(response.json?.session).toMatchObject({
      cwd: fixtureRoot,
      platform: expect.any(String),
    })
  })

  it('lists the deterministic fixture workspace', async () => {
    const response = await invokeBridgeRoute({
      baseDir: fixtureRoot,
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
    const response = await invokeBridgeRoute({
      baseDir: fixtureRoot,
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
    const response = await invokeBridgeRoute({
      baseDir: fixtureRoot,
      url: '/api/local/fs/write',
      method: 'POST',
      body: { path: 'written-by-test.txt', content: 'deterministic content' },
    })
    expect(response.status).toBe(200)
    expect(await fs.readFile(writtenFixture, 'utf8')).toBe('deterministic content')
  })

  it('returns a structured client error for missing required file paths', async () => {
    const response = await invokeBridgeRoute({
      baseDir: fixtureRoot,
      url: '/api/local/fs/read',
      method: 'POST',
      body: {},
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.json?.error).toEqual(expect.any(String))
  })

  it('rejects malformed agent identifiers at the bridge boundary', async () => {
    const response = await invokeBridgeRoute({
      baseDir: fixtureRoot,
      url: '/api/local/agent/register',
      method: 'POST',
      body: { agentId: 'bad agent!', capabilities: ['files.read'] },
    })
    expect(response.status).toBe(400)
    expect(response.json?.error).toContain('unsupported characters')
  })

  it('passes unknown local endpoints to the next middleware', async () => {
    const response = await invokeBridgeRoute({ baseDir: fixtureRoot, url: '/api/local/not-a-route' })
    expect(response.handled).toBe(false)
  })
})
