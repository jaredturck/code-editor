/** Benchmarks encrypted chats, settings, artifacts, skills, sub-agent output, and launcher data. */

import {
  appendEncryptedChatMessage,
  createEncryptedChat,
  getEncryptedChat,
  listEncryptedUserSkills,
  readEncryptedArtifact,
  readEncryptedLauncherApplications,
  readEncryptedStoreAll,
  readEncryptedSubagentOutput,
  saveEncryptedArtifact,
  saveEncryptedLauncherIndex,
  upsertEncryptedUserSkill,
  writeEncryptedStoreKey,
  writeEncryptedSubagentOutput,
} from '../../../backend/desktopBridge/storage/encryptedDatabase.js'
import type { BenchmarkDefinition } from '../core/types.js'

/** Creates deterministic normalized vectors for launcher persistence measurements. */
function launcherApplications(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `benchmark-app-${index}`,
    metadata: {
      name: `Benchmark Application ${index}`,
      description: 'Representative launcher application metadata',
      executable: `/usr/bin/benchmark-${index}`,
      keywords: ['benchmark', 'application', `group-${index % 8}`],
    },
    embedding: Array.from({ length: 1024 }, (_, dimension) => Math.sin((index + 1) * (dimension + 1) * 0.001) / 32),
  }))
}

/** Exercises application persistence domains that are independent from filesystem indexing. */
export const persistenceBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'persistence.store.write.100',
    suite: 'Application persistence',
    name: 'Encrypted durable settings writes · 100',
    description:
      'Serializes, encrypts, and upserts representative renderer settings through the production durable store.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 100,
    tags: ['database'],
    run: async (_context, iteration) => {
      for (let index = 0; index < 100; index += 1) {
        await writeEncryptedStoreKey(`benchmark-setting-${index}`, {
          enabled: index % 2 === 0,
          provider: 'local',
          model: 'benchmark-local',
          values: Array.from({ length: 16 }, (_, valueIndex) => valueIndex + iteration),
        })
      }
    },
  },
  {
    id: 'persistence.store.read.100',
    suite: 'Application persistence',
    name: 'Encrypted durable settings hydration · 100',
    description: 'Reads, decrypts, and reconstructs a representative renderer settings collection.',
    iterations: 10,
    warmupIterations: 2,
    operationsPerIteration: 100,
    tags: ['database'],
    setup: async () => {
      for (let index = 0; index < 100; index += 1) {
        await writeEncryptedStoreKey(`benchmark-read-setting-${index}`, {
          key: index,
          content: 'Persistent benchmark setting content. '.repeat(8),
        })
      }
      return undefined
    },
    run: () => readEncryptedStoreAll(),
  },
  {
    id: 'persistence.chat.append.100',
    suite: 'Application persistence',
    name: 'Encrypted chat message append · 100',
    description:
      'Appends user and assistant turns through sequence allocation, encryption, transaction, and chat metadata updates.',
    iterations: 5,
    warmupIterations: 1,
    operationsPerIteration: 100,
    tags: ['database'],
    setup: () =>
      createEncryptedChat({
        title: 'Benchmark chat',
        provider: 'local',
        model: 'local',
      }),
    run: async (chat) => {
      for (let index = 0; index < 100; index += 1) {
        await appendEncryptedChatMessage(chat.id, {
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `Benchmark chat message ${index}. ${'context '.repeat(40)}`,
        })
      }
    },
  },
  {
    id: 'persistence.chat.read.200',
    suite: 'Application persistence',
    name: 'Encrypted chat reconstruction · 200 messages',
    description:
      'Loads chat metadata, decrypts the complete ordered transcript, and reconstructs the returned conversation object.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 200,
    tags: ['database'],
    setup: async () => {
      const chat = await createEncryptedChat({
        title: 'Benchmark read chat',
        provider: 'local',
      })
      for (let index = 0; index < 200; index += 1) {
        await appendEncryptedChatMessage(chat.id, {
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `Stored benchmark message ${index}. ${'semantic context '.repeat(20)}`,
        })
      }
      return chat
    },
    run: (chat) => getEncryptedChat(chat.id),
  },
  {
    id: 'persistence.artifact.roundtrip.1mib',
    suite: 'Application persistence',
    name: 'Encrypted artifact round trip · 1 MiB',
    description: 'Chunks, encrypts, stores, reloads, decrypts, and reassembles a representative agent deliverable.',
    iterations: 5,
    warmupIterations: 1,
    bytesPerOperation: 1024 * 1024,
    tags: ['database'],
    setup: () => ({ content: 'A'.repeat(1024 * 1024) }),
    run: async (context, iteration) => {
      const saved = await saveEncryptedArtifact({
        filename: `benchmark-artifact-${iteration}.md`,
        content: context.content,
        summary: 'Benchmark artifact',
        type: 'text/markdown',
      })
      return readEncryptedArtifact(saved.id)
    },
  },
  {
    id: 'persistence.subagent-output.roundtrip.1mib',
    suite: 'Application persistence',
    name: 'Encrypted sub-agent output round trip · 1 MiB',
    description: 'Encrypts, upserts, reloads, and decrypts the bounded delegated-output payload.',
    iterations: 6,
    warmupIterations: 1,
    bytesPerOperation: 1024 * 1024,
    tags: ['database'],
    setup: () => ({ content: 'Delegated benchmark output. '.repeat(40_000) }),
    run: async (context, iteration) => {
      const id = `benchmark-subagent-${iteration}`
      await writeEncryptedSubagentOutput(id, context.content)
      return readEncryptedSubagentOutput(id)
    },
  },
  {
    id: 'persistence.skills.upsert-and-list.100',
    suite: 'Application persistence',
    name: 'Encrypted skill upsert and list · 100',
    description:
      'Encrypts profile-scoped skill payloads, applies conflict updates, and decrypts the complete profile list.',
    iterations: 6,
    warmupIterations: 1,
    operationsPerIteration: 100,
    tags: ['database'],
    run: async (_context, iteration) => {
      const profile = `benchmark-profile-${iteration}`
      for (let index = 0; index < 100; index += 1) {
        await upsertEncryptedUserSkill(profile, `skill-${index}`, {
          name: `Benchmark skill ${index}`,
          description: 'Representative local skill instructions',
          instructions: 'Inspect the requested subsystem and return a concise result. '.repeat(10),
        })
      }
      return listEncryptedUserSkills(profile)
    },
  },
  {
    id: 'persistence.launcher-index.roundtrip.256',
    suite: 'Application persistence',
    name: 'Encrypted launcher index round trip · 256 applications',
    description:
      'Replaces the launcher vector index, encrypts metadata and embeddings, then decrypts the complete application set.',
    iterations: 4,
    warmupIterations: 1,
    operationsPerIteration: 256,
    tags: ['database'],
    setup: () => ({ applications: launcherApplications(256) }),
    run: async (context, iteration) => {
      await saveEncryptedLauncherIndex(
        {
          model: 'benchmark',
          applicationCount: context.applications.length,
          generatedAt: iteration,
        },
        context.applications,
      )
      return readEncryptedLauncherApplications()
    },
  },
]
