/**
 * Verifies IRIS's encrypted SQLite persistence across every sensitive storage domain.
 * Sentinel plaintext must remain absent from the database and its SQLite sidecars.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendEncryptedChatMessage,
  beginEncryptedFileIndex,
  clearEncryptedApplicationData,
  countEncryptedFilesystemNodes,
  closeEncryptedDatabase,
  createEncryptedChat,
  deleteEncryptedChat,
  getEncryptedChat,
  initializeEncryptedDatabase,
  listEncryptedChats,
  listEncryptedUserSkills,
  readEncryptedArtifact,
  readEncryptedChatMemory,
  readEncryptedFileEmbeddingProfile,
  readEncryptedFileConceptMemberships,
  readEncryptedFileConcepts,
  readEncryptedFileIndexMeta,
  readEncryptedFileSemantics,
  readEncryptedVideoFrameSemantics,
  readEncryptedFilesystemNodePage,
  readEncryptedFilesystemNodes,
  readEncryptedLauncherApplications,
  readEncryptedLauncherIndexMeta,
  readEncryptedStoreAll,
  readEncryptedSubagentOutput,
  saveEncryptedArtifact,
  saveEncryptedChatCompacted,
  saveEncryptedLauncherIndex,
  upsertEncryptedUserSkill,
  writeEncryptedChatMemory,
  writeEncryptedFileEmbeddingProfile,
  writeEncryptedFileConceptMemberships,
  writeEncryptedFileConcepts,
  writeEncryptedFileIndexMeta,
  writeEncryptedFileSemantics,
  writeEncryptedVideoFrameSemantics,
  writeEncryptedFilesystemNodes,
  writeEncryptedStoreKey,
  writeEncryptedSubagentOutput,
} from '../../server/desktopBridge/storage/encryptedDatabase'

const temporaryRoots: string[] = []

afterEach(async () => {
  await closeEncryptedDatabase().catch(() => undefined)
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function createDatabase() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-encrypted-db-'))
  temporaryRoots.push(root)
  const databasePath = path.join(root, 'iris.sqlite3')
  const masterKey = randomBytes(32)
  await initializeEncryptedDatabase({ databasePath, masterKey })
  return { databasePath, masterKey }
}

async function expectSentinelAbsent(databasePath: string, sentinel: string) {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    const bytes = await fs.readFile(filePath).catch(() => null)
    if (bytes) expect(bytes.includes(Buffer.from(sentinel, 'utf8'))).toBe(false)
  }
}

async function expectBytesAbsent(databasePath: string, sentinel: Buffer) {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    const bytes = await fs.readFile(filePath).catch(() => null)
    if (bytes) expect(bytes.includes(sentinel)).toBe(false)
  }
}

describe('encrypted SQLite persistence', () => {
  it('encrypts sensitive values before SQLite receives them and restores them after restart', async () => {
    const sentinel = `IRIS_SECRET_${randomBytes(10).toString('hex')}`
    const { databasePath, masterKey } = await createDatabase()

    await writeEncryptedStoreKey('iris_settings', JSON.stringify({ privateValue: sentinel }))
    const chat = await createEncryptedChat({
      title: `title ${sentinel}`,
      provider: 'openai',
      model: 'test-model',
    })
    const chatId = String(chat.id)
    const imageSentinel = Buffer.from(`image ${sentinel}`, 'utf8').toString('base64')
    await appendEncryptedChatMessage(chatId, {
      role: 'user',
      content: `message ${sentinel}`,
      attachments: [
        {
          id: 'private-image',
          name: 'private.png',
          type: 'image/png',
          content: imageSentinel,
          width: 32,
          height: 24,
        },
      ],
    })
    await writeEncryptedChatMemory(chatId, `memory ${sentinel}`)
    await saveEncryptedChatCompacted(chatId, `summary ${sentinel}`)

    const artifact = await saveEncryptedArtifact({
      filename: 'private.txt',
      content: `artifact ${sentinel}`,
      summary: `summary ${sentinel}`,
      chatId,
    })
    await writeEncryptedSubagentOutput('task-private', `subagent ${sentinel}`)
    await upsertEncryptedUserSkill('default-model', 'private-skill', {
      id: 'private-skill',
      title: `skill ${sentinel}`,
      instructions: `instructions ${sentinel}`,
      enabled: true,
    })
    await saveEncryptedLauncherIndex(
      {
        schemaVersion: 1,
        model: 'qwen3-embedding:0.6b',
        applicationCount: 1,
        generatedAt: Date.now(),
        description: `index ${sentinel}`,
      },
      [
        {
          id: 'private-launcher-app',
          metadata: {
            name: `Launcher ${sentinel}`,
            executable: '/usr/bin/private-app',
          },
          embedding: [0.25, 0.5, 0.75],
        },
      ],
    )
    await beginEncryptedFileIndex({
      schemaVersion: 1,
      status: 'building',
      rootPath: `/home/${sentinel}`,
      rootNodeId: 'root-node',
    })
    await writeEncryptedFilesystemNodes([
      {
        id: 'root-node',
        parentId: null,
        nodeType: 'directory',
        contentKind: 'directory',
        sizeBytes: 0,
        modifiedAt: 1,
        indexedAt: 1,
        metadata: {
          name: `home-${sentinel}`,
          nodeType: 'directory',
          contentKind: 'directory',
          size: 0,
          modifiedAt: 1,
          indexedAt: 1,
        },
      },
      {
        id: 'file-node',
        parentId: 'root-node',
        nodeType: 'file',
        contentKind: 'text',
        sizeBytes: 12,
        modifiedAt: 2,
        indexedAt: 2,
        metadata: {
          name: `private-${sentinel}.txt`,
          nodeType: 'file',
          contentKind: 'text',
          size: 12,
          modifiedAt: 2,
          indexedAt: 2,
        },
      },
    ])
    await writeEncryptedFileEmbeddingProfile({
      schemaVersion: 1,
      model: 'qwen3-embedding:0.6b',
      sampleBytes: 8192,
      inputFormatVersion: 1,
      batchSize: 24,
      calibratedAt: 123,
      confirmationRuns: 3,
      sentinel,
    })
    const fileEmbedding = [0.1234567, -0.2345678, 0.3456789]
    const fileEmbeddingBytes = Buffer.allocUnsafe(fileEmbedding.length * 4)
    fileEmbedding.forEach((value, index) => fileEmbeddingBytes.writeFloatLE(value, index * 4))
    await writeEncryptedFileSemantics([
      {
        fileId: 'file-node',
        metadata: {
          summary: `file summary ${sentinel}`,
          semanticType: 'text',
        },
        embedding: fileEmbedding,
      },
    ])
    const videoEmbedding = [-0.456789, 0.567891, 0.678912]
    const videoEmbeddingBytes = Buffer.allocUnsafe(videoEmbedding.length * 4)
    videoEmbedding.forEach((value, index) => videoEmbeddingBytes.writeFloatLE(value, index * 4))
    await writeEncryptedVideoFrameSemantics([
      {
        semanticId: 'file-node:12500:0',
        fileId: 'file-node',
        timestampMs: 12500,
        metadata: {
          summary: `video frame ${sentinel}`,
          semanticType: 'video',
        },
        embedding: videoEmbedding,
      },
    ])
    const conceptCentroid = new Float32Array([0.111111, -0.222222, 0.333333])
    const conceptCentroidBytes = Buffer.allocUnsafe(conceptCentroid.length * 4)
    conceptCentroid.forEach((value, index) => conceptCentroidBytes.writeFloatLE(value, index * 4))
    await writeEncryptedFileConcepts([
      {
        id: 'concept-private',
        generation: 'generation-private',
        embeddingSpace: 'minilm',
        metadata: { labelHint: `concept ${sentinel}` },
        centroid: conceptCentroid,
        memberCount: 1,
        cohesion: 0.9,
      },
    ])
    await writeEncryptedFileConceptMemberships([
      {
        conceptId: 'concept-private',
        generation: 'generation-private',
        fileId: 'file-node',
        sourceSemanticId: 'file-node',
        similarity: 0.91,
      },
    ])
    await writeEncryptedFileIndexMeta({
      schemaVersion: 1,
      status: 'complete',
      rootPath: `/home/${sentinel}`,
      rootNodeId: 'root-node',
      semanticCount: 1,
    })

    await expectSentinelAbsent(databasePath, sentinel)
    await expectBytesAbsent(databasePath, fileEmbeddingBytes)
    await expectBytesAbsent(databasePath, videoEmbeddingBytes)
    await expectBytesAbsent(databasePath, conceptCentroidBytes)

    expect(await readEncryptedStoreAll()).toMatchObject({
      iris_settings: JSON.stringify({ privateValue: sentinel }),
    })
    expect(await listEncryptedChats()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: chatId, title: `title ${sentinel}` })]),
    )
    expect(await getEncryptedChat(chatId)).toMatchObject({
      messages: [expect.objectContaining({ content: `message ${sentinel}` })],
      compacted: `summary ${sentinel}`,
    })
    expect(await readEncryptedChatMemory(chatId)).toBe(`memory ${sentinel}`)
    expect(await getEncryptedChat(chatId)).toMatchObject({
      messages: [
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              name: 'private.png',
              type: 'image/png',
              content: imageSentinel,
              width: 32,
              height: 24,
            }),
          ],
        }),
      ],
    })
    expect(await readEncryptedArtifact(String(artifact.id))).toMatchObject({
      content: `artifact ${sentinel}`,
    })
    expect(await readEncryptedSubagentOutput('task-private')).toBe(`subagent ${sentinel}`)
    expect(await listEncryptedUserSkills('default-model')).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: `skill ${sentinel}` })]),
    )
    expect(await readEncryptedLauncherIndexMeta()).toMatchObject({
      description: `index ${sentinel}`,
      applicationCount: 1,
    })
    expect(await readEncryptedLauncherApplications()).toEqual([
      expect.objectContaining({
        id: 'private-launcher-app',
        metadata: expect.objectContaining({ name: `Launcher ${sentinel}` }),
        embedding: [0.25, 0.5, 0.75],
      }),
    ])
    expect(await readEncryptedFileIndexMeta()).toMatchObject({
      status: 'complete',
      rootPath: `/home/${sentinel}`,
      semanticCount: 1,
    })
    expect(await readEncryptedFilesystemNodes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'file-node',
          parentId: 'root-node',
          metadata: expect.objectContaining({
            name: `private-${sentinel}.txt`,
          }),
        }),
      ]),
    )
    expect(await readEncryptedFileEmbeddingProfile()).toMatchObject({
      batchSize: 24,
      sentinel,
    })
    expect(
      await readEncryptedFilesystemNodePage({
        contentKind: 'text',
        minSizeBytes: 8,
        indexedAt: 2,
        limit: 10,
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'file-node',
        contentKind: 'text',
        sizeBytes: 12,
      }),
    ])
    expect(
      await countEncryptedFilesystemNodes({
        contentKind: 'text',
        indexedAt: 2,
      }),
    ).toBe(1)
    expect(await readEncryptedFileSemantics()).toEqual([
      expect.objectContaining({
        fileId: 'file-node',
        metadata: expect.objectContaining({
          summary: `file summary ${sentinel}`,
        }),
        embedding: fileEmbedding.map((value) => expect.closeTo(value)),
      }),
    ])
    expect(await readEncryptedVideoFrameSemantics()).toEqual([
      expect.objectContaining({
        semanticId: 'file-node:12500:0',
        fileId: 'file-node',
        timestampMs: 12500,
        metadata: expect.objectContaining({
          summary: `video frame ${sentinel}`,
        }),
        embedding: videoEmbedding.map((value) => expect.closeTo(value)),
      }),
    ])
    expect(await readEncryptedFileConcepts('generation-private')).toEqual([
      expect.objectContaining({
        id: 'concept-private',
        embeddingSpace: 'minilm',
        metadata: expect.objectContaining({ labelHint: `concept ${sentinel}` }),
        centroid: expect.any(Float32Array),
        memberCount: 1,
        cohesion: expect.closeTo(0.9),
      }),
    ])
    expect(await readEncryptedFileConceptMemberships(['concept-private'], 10)).toEqual([
      expect.objectContaining({
        conceptId: 'concept-private',
        fileId: 'file-node',
        sourceSemanticId: 'file-node',
        similarity: expect.closeTo(0.91),
      }),
    ])

    await closeEncryptedDatabase()
    await initializeEncryptedDatabase({ databasePath, masterKey })
    expect(await readEncryptedChatMemory(chatId)).toBe(`memory ${sentinel}`)
    expect(await deleteEncryptedChat(chatId)).toBe(1)
    expect(await getEncryptedChat(chatId)).toBeNull()
  })

  it('clears encrypted application data while preserving a usable database', async () => {
    await createDatabase()
    await writeEncryptedStoreKey('iris_settings', JSON.stringify({ theme: 'dark' }))
    const chat = await createEncryptedChat({ title: 'clear me' })
    await appendEncryptedChatMessage(String(chat.id), {
      role: 'user',
      content: 'private',
    })
    await upsertEncryptedUserSkill('default-model', 'clear-skill', {
      id: 'clear-skill',
      title: 'Clear skill',
      instructions: 'private',
    })
    await saveEncryptedLauncherIndex({ schemaVersion: 1, applicationCount: 1 }, [
      {
        id: 'clear-launcher-app',
        metadata: { name: 'Clear launcher application' },
        embedding: [1, 0],
      },
    ])
    await beginEncryptedFileIndex({
      status: 'building',
      rootNodeId: 'clear-root',
    })
    await writeEncryptedFilesystemNodes([
      {
        id: 'clear-root',
        parentId: null,
        nodeType: 'directory',
        contentKind: 'directory',
        sizeBytes: 0,
        modifiedAt: 0,
        indexedAt: 0,
        metadata: {
          name: 'clear',
          nodeType: 'directory',
          contentKind: 'directory',
        },
      },
    ])

    await writeEncryptedFileEmbeddingProfile({ batchSize: 16 })
    await clearEncryptedApplicationData()

    expect(await readEncryptedStoreAll()).toEqual({})
    expect(await listEncryptedChats()).toEqual([])
    expect(await listEncryptedUserSkills('default-model')).toEqual([])
    expect(await readEncryptedLauncherIndexMeta()).toBeNull()
    expect(await readEncryptedLauncherApplications()).toEqual([])
    expect(await readEncryptedFileIndexMeta()).toBeNull()
    expect(await readEncryptedFilesystemNodes()).toEqual([])
    expect(await readEncryptedFileSemantics()).toEqual([])
    expect(await readEncryptedVideoFrameSemantics()).toEqual([])
    expect(await readEncryptedFileEmbeddingProfile()).toBeNull()
    await writeEncryptedStoreKey('iris_settings', JSON.stringify({ restored: true }))
    expect(await readEncryptedStoreAll()).toEqual({
      iris_settings: JSON.stringify({ restored: true }),
    })
  })

  it('pages filesystem work in persisted scan order instead of random node IDs', async () => {
    await createDatabase()
    await writeEncryptedFilesystemNodes([
      {
        id: 'scan-root',
        parentId: null,
        nodeType: 'directory',
        contentKind: 'directory',
        sizeBytes: 0,
        modifiedAt: 0,
        indexedAt: 77,
        scanOrder: 0,
        metadata: { name: 'root' },
      },
      {
        id: 'z-random-id',
        parentId: 'scan-root',
        nodeType: 'file',
        contentKind: 'image',
        sizeBytes: 1,
        modifiedAt: 1,
        indexedAt: 77,
        scanOrder: 1,
        metadata: { name: 'one.jpg' },
      },
      {
        id: 'a-random-id',
        parentId: 'scan-root',
        nodeType: 'file',
        contentKind: 'image',
        sizeBytes: 1,
        modifiedAt: 2,
        indexedAt: 77,
        scanOrder: 2,
        metadata: { name: 'two.jpg' },
      },
      {
        id: 'm-random-id',
        parentId: 'scan-root',
        nodeType: 'file',
        contentKind: 'image',
        sizeBytes: 1,
        modifiedAt: 3,
        indexedAt: 77,
        scanOrder: 3,
        metadata: { name: 'three.jpg' },
      },
    ])

    const first = await readEncryptedFilesystemNodePage({
      contentKind: 'image',
      indexedAt: 77,
      orderByScan: true,
      limit: 2,
    })
    const second = await readEncryptedFilesystemNodePage({
      contentKind: 'image',
      indexedAt: 77,
      orderByScan: true,
      afterScanOrder: first.at(-1)?.scanOrder,
      afterId: first.at(-1)?.id,
      limit: 2,
    })

    expect([...first, ...second].map((node) => node.id)).toEqual(['z-random-id', 'a-random-id', 'm-random-id'])
  })

  it('rejects ciphertext when the database is opened with the wrong key', async () => {
    const { databasePath } = await createDatabase()
    await createEncryptedChat({ title: 'private title' })
    await closeEncryptedDatabase()

    await initializeEncryptedDatabase({
      databasePath,
      masterKey: randomBytes(32),
    })
    await expect(listEncryptedChats()).rejects.toThrow()
  })
})
