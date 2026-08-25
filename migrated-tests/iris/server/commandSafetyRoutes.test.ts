/** Route-level safety regression tests against the current bridge router. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { invokeBridgeRoute } from './bridgeRouteTestHarness'

const temporaryRoots: string[] = []

async function invokeBridge(baseDir: string, url: string, body: Record<string, unknown>) {
  const response = await invokeBridgeRoute({ baseDir, url, method: 'POST', body })
  return { status: response.status, json: response.json || {} }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('command safety routes', () => {
  it('requires explicit approval before a legacy shell launcher command can run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-'))
    temporaryRoots.push(root)
    const response = await invokeBridge(root, '/api/local/launcher/run', {
      command: 'echo safe && echo second',
      category: 'script',
      cwd: root,
    })

    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({
      approvalRequired: true,
      risk: 'legacy_shell',
    })
  })

  it('requires destructive one-time approval before clearing encrypted IRIS data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-clear-data-'))
    temporaryRoots.push(root)
    const response = await invokeBridge(root, '/api/local/launcher/clear-data', {})

    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({
      approvalRequired: true,
      risk: 'destructive',
      command: 'Clear IRIS encrypted application data',
    })
  })

  it('treats metacharacters in structured find arguments as ordinary filename data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-find-'))
    temporaryRoots.push(root)
    await fs.writeFile(path.join(root, 'safe.txt'), 'content')
    const marker = path.join(root, 'should-not-exist')

    const response = await invokeBridge(root, '/api/local/power/find', {
      path: root,
      name: `*.txt;touch ${marker}`,
    })

    expect(response.status).toBe(200)
    await expect(fs.access(marker)).rejects.toThrow()
  })
})
