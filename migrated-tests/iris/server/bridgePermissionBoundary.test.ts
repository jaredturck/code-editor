/**
 * Exercises permissions at the packaged bridge itself rather than through renderer helpers.
 * A caller that knows the HTTP route and token must still be unable to grant itself file,
 * terminal, launcher, or automation capabilities through request-body fields.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLocalBridgeServer } from '../../server/bridgeServer'

type BridgeHandle = Awaited<ReturnType<typeof startLocalBridgeServer>>

interface BridgeJsonResponse {
  status: number | undefined
  json: Record<string, any>
}

const running: BridgeHandle[] = []
const temporaryDirectories: string[] = []
const fixtureRoot = path.resolve('tests/fixtures/workspace')
const token = '0123456789abcdef0123456789abcdef'

// Sends one request through the bridge middleware for permission-boundary assertions.
async function requestBridge(
  origin: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<BridgeJsonResponse> {
  const payload = JSON.stringify(body ?? {})
  return new Promise<BridgeJsonResponse>((resolve, reject) => {
    const request = http.request(
      new URL(pathname, origin),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-iris-bridge-token': token,
        },
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          text += chunk
        })
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            json: text ? JSON.parse(text) : null,
          })
        })
      },
    )
    request.once('error', reject)
    request.end(payload)
  })
}

// Starts bridge and establishes the lifecycle state needed by the surrounding test scenario.
async function startBridge() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-bridge-permissions-'))
  temporaryDirectories.push(directory)
  const bridge = await startLocalBridgeServer({
    baseDir: fixtureRoot,
    token,
    databasePath: path.join(directory, 'iris.sqlite3'),
    masterKey: crypto.randomBytes(32),
    initialPermissions: {
      fileRead: false,
      fileWrite: false,
      terminal: false,
      launcher: false,
      automation: false,
      microphone: false,
    },
  })
  running.push(bridge)
  return { bridge, origin: `http://${bridge.host}:${bridge.port}` }
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((bridge) => bridge.close()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('packaged bridge permission enforcement', () => {
  it('rejects direct file and terminal calls even when the request claims permission', async () => {
    const { origin } = await startBridge()

    const read = await requestBridge(origin, '/api/local/fs/read', {
      path: 'README.md',
      permissions: { fileRead: true },
    })
    const semanticIndex = await requestBridge(origin, '/api/local/fs/index/status', {
      permissions: { fileRead: true },
    })
    const semanticPreflight = await requestBridge(origin, '/api/local/fs/index/preflight', {
      permissions: { fileRead: true },
    })
    const analysis = await requestBridge(origin, '/api/local/fs/analyze', {
      path: 'README.md',
      permissions: { fileRead: true },
    })
    const concepts = await requestBridge(origin, '/api/local/fs/semantic/concepts', {
      query: 'fixture',
      permissions: { fileRead: true },
    })
    const terminal = await requestBridge(origin, '/api/local/terminal/execute', {
      command: 'printf bypassed',
      permissions: { terminal: true },
    })

    expect(read).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
    expect(semanticIndex).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
    expect(semanticPreflight).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
    expect(analysis).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
    expect(concepts).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
    expect(terminal).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
  })

  it('rejects direct audio transcription while microphone permission is disabled', async () => {
    const { origin } = await startBridge()

    const transcription = await requestBridge(origin, '/api/local/audio/transcriptions', {
      permissions: { microphone: true },
    })

    expect(transcription).toMatchObject({
      status: 403,
      json: { code: 'bridge_permission_denied' },
    })
  })

  it('allows the route only after Electron-owned permission state is updated', async () => {
    const { bridge, origin } = await startBridge()
    bridge.updatePermissions({ fileRead: true })

    const read = await requestBridge(origin, '/api/local/fs/read', {
      path: 'README.md',
      permissions: { fileRead: false },
    })

    expect(read.status).toBe(200)
    expect(read.json.content).toContain('Fixture Workspace')
  })
})
