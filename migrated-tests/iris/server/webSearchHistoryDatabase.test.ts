/** Verifies encrypted saved-search lifecycle without repeating web or model work. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearEncryptedWebSearchSessions,
  closeEncryptedDatabase,
  createEncryptedWebSearchSession,
  deleteEncryptedWebSearchSession,
  duplicateEncryptedWebSearchSession,
  getEncryptedWebSearchSession,
  initializeEncryptedDatabase,
  listEncryptedWebSearchSessions,
  upsertEncryptedWebSearchSession,
} from '../../server/desktopBridge/storage/encryptedDatabase'

const roots: string[] = []

afterEach(async () => {
  await closeEncryptedDatabase().catch(() => undefined)
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function createDatabase() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-web-history-'))
  roots.push(root)
  const databasePath = path.join(root, 'iris.sqlite3')
  await initializeEncryptedDatabase({
    databasePath,
    masterKey: randomBytes(32),
  })
  return databasePath
}

describe('encrypted web search history', () => {
  it('creates, restores, duplicates, updates, and deletes complete research sessions', async () => {
    const databasePath = await createDatabase()
    const sentinel = `PRIVATE_SEARCH_${randomBytes(8).toString('hex')}`
    const payload = {
      query: `what is ${sentinel}`,
      title: 'What is a cat?',
      effectiveQuery: 'cat definition',
      quick: {
        status: 'complete',
        result: {
          summary: `**Answer:** ${sentinel}`,
          sources: [{ title: 'Source', url: 'https://example.test', snippet: sentinel }],
        },
      },
      detailed: { status: 'idle', result: null },
      followUps: [],
    }

    const created = await createEncryptedWebSearchSession(payload)
    const id = String(created.id)
    expect(await listEncryptedWebSearchSessions()).toEqual([
      expect.objectContaining({
        id,
        title: 'What is a cat?',
        quickStatus: 'complete',
      }),
    ])
    expect(await getEncryptedWebSearchSession(id)).toMatchObject(payload)

    const databaseBytes = await fs.readFile(databasePath)
    expect(databaseBytes.includes(Buffer.from(sentinel))).toBe(false)

    await upsertEncryptedWebSearchSession(id, {
      ...payload,
      detailed: {
        status: 'complete',
        result: { summary: `Detailed ${sentinel}` },
      },
    })
    expect(await getEncryptedWebSearchSession(id)).toMatchObject({
      detailed: {
        status: 'complete',
        result: { summary: `Detailed ${sentinel}` },
      },
    })

    const duplicate = await duplicateEncryptedWebSearchSession(id)
    expect(duplicate).toMatchObject({ title: 'What is a cat? (Copy)' })
    expect(String(duplicate.id)).not.toBe(id)
    expect(await getEncryptedWebSearchSession(String(duplicate.id))).toMatchObject({
      quick: payload.quick,
    })

    expect(await deleteEncryptedWebSearchSession(id)).toBe(1)
    expect(await getEncryptedWebSearchSession(id)).toBeNull()
    expect(await clearEncryptedWebSearchSessions()).toBe(1)
    expect(await listEncryptedWebSearchSessions()).toEqual([])
  })
})
