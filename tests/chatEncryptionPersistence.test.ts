import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendEncryptedChatMessage,
  closeEncryptedDatabase,
  createEncryptedChat,
  getEncryptedChat,
  initializeEncryptedDatabase,
  readEncryptedChatMemory,
  readEncryptedStoreAll,
  saveEncryptedChatCompacted,
  writeEncryptedChatMemory,
  writeEncryptedStoreKey,
} from '../backend/desktopBridge/storage/encryptedDatabase'

const temporary_roots: string[] = []

afterEach(async () => {
  await closeEncryptedDatabase().catch(() => undefined)
  await Promise.all(temporary_roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function create_database() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-chat-encryption-'))
  temporary_roots.push(root)
  const database_path = path.join(root, 'iris.sqlite3')
  const master_key = randomBytes(32)
  await initializeEncryptedDatabase({ databasePath: database_path, masterKey: master_key })
  return { database_path, master_key }
}

async function expect_plaintext_absent(database_path: string, sentinel: string) {
  for (const file_path of [database_path, `${database_path}-wal`, `${database_path}-shm`]) {
    const bytes = await fs.readFile(file_path).catch(() => null)
    if (bytes) expect(bytes.includes(Buffer.from(sentinel, 'utf8'))).toBe(false)
  }
}

describe('chat and autonomous-run encryption at rest', () => {
  it('never writes chat/run plaintext to SQLite and restores it with the same OS-wrapped key', async () => {
    const sentinel = `IRIS_PRIVATE_${randomBytes(10).toString('hex')}`
    const { database_path, master_key } = await create_database()
    const chat = await createEncryptedChat({
      title: `title ${sentinel}`,
      provider: 'openai',
      model: 'test-model',
    })
    const chat_id = String(chat.id)
    const session_key = `iris_chat_session_${chat_id}`

    await appendEncryptedChatMessage(chat_id, {
      role: 'user',
      content: `message ${sentinel}`,
      attachments: [{ name: 'private.txt', content: `attachment ${sentinel}` }],
      meta: { privateRunNote: `timeline ${sentinel}` },
    })
    await writeEncryptedChatMemory(chat_id, `memory ${sentinel}`)
    await saveEncryptedChatCompacted(chat_id, `compacted ${sentinel}`)
    await writeEncryptedStoreKey(
      session_key,
      JSON.stringify({
        todos: [{ text: `todo ${sentinel}`, status: 'in_progress' }],
        projectRun: { goal: `goal ${sentinel}`, status: 'paused' },
      }),
    )

    await expect_plaintext_absent(database_path, sentinel)
    await closeEncryptedDatabase()
    await expect_plaintext_absent(database_path, sentinel)

    await initializeEncryptedDatabase({ databasePath: database_path, masterKey: master_key })
    const restored_chat = await getEncryptedChat(chat_id)
    const restored_store = await readEncryptedStoreAll()
    const restored_meta =
      restored_chat?.meta && typeof restored_chat.meta === 'object'
        ? (restored_chat.meta as Record<string, unknown>)
        : {}
    const restored_messages = Array.isArray(restored_chat?.messages)
      ? (restored_chat.messages as Array<Record<string, unknown>>)
      : []
    const first_message = restored_messages[0] || {}
    const restored_attachments = Array.isArray(first_message.attachments)
      ? (first_message.attachments as Array<Record<string, unknown>>)
      : []
    const restored_message_meta =
      first_message.meta && typeof first_message.meta === 'object'
        ? (first_message.meta as Record<string, unknown>)
        : {}

    expect(restored_meta.title).toBe(`title ${sentinel}`)
    expect(first_message.content).toBe(`message ${sentinel}`)
    expect(restored_attachments[0]?.content).toBe(`attachment ${sentinel}`)
    expect(restored_message_meta.privateRunNote).toBe(`timeline ${sentinel}`)
    expect(restored_chat?.compacted).toBe(`compacted ${sentinel}`)
    expect(await readEncryptedChatMemory(chat_id)).toBe(`memory ${sentinel}`)
    expect(restored_store[session_key]).toContain(`todo ${sentinel}`)
    expect(restored_store[session_key]).toContain(`goal ${sentinel}`)
  })
})
