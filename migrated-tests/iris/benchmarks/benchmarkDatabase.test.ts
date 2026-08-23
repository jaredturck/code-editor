/** Verifies the persistent benchmark schema retains history while clearing production-style workload rows. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BenchmarkDatabase } from '../../benchmarks/core/database'
import { summarizeSamples } from '../../benchmarks/core/statistics'
import { readEncryptedStoreAll, writeEncryptedStoreKey } from '../../server/desktopBridge/storage/encryptedDatabase'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('benchmark database', () => {
  it('retains run results while deleting benchmark workload rows', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-benchmark-database-'))
    roots.push(root)
    const database = await BenchmarkDatabase.open({
      databasePath: path.join(root, 'iris-benchmark.sqlite3'),
      fixtureRoot: path.join(root, 'fixtures'),
    })

    try {
      const startedAt = '2026-06-26T00:00:00.000Z'
      const run = await database.beginRun({
        startedAt,
        appVersion: 'test',
        gitCommit: 'abc123',
        gitBranch: 'test',
        command: 'npm run benchmark',
        workingDirectory: root,
      })
      await database.registerCases([
        {
          id: 'test.database.case',
          suite: 'Test',
          name: 'Database case',
          description: 'Test retained result',
          run: () => undefined,
        },
      ])
      await database.markWorkloadDirty(run.runId)
      await writeEncryptedStoreKey('benchmark-workload', { value: 1 })
      expect(await readEncryptedStoreAll()).toHaveProperty('benchmark-workload')

      await database.recordResult(run.runId, {
        id: 'test.database.case',
        suite: 'Test',
        name: 'Database case',
        description: 'Test retained result',
        variantKey: 'default',
        parameters: {},
        tags: ['database'],
        status: 'passed',
        iterations: 2,
        warmupIterations: 1,
        operationsPerIteration: 1,
        samplesMs: [1, 2],
        statistics: summarizeSamples([1, 2]),
        operationsPerSecond: 666.666,
        peakRssBytes: 1024,
        peakHeapUsedBytes: 512,
        peakExternalBytes: 128,
        peakArrayBuffersBytes: 64,
        elapsedMs: 3,
      })
      await database.cleanupWorkloadData(run.runId)
      expect(await readEncryptedStoreAll()).not.toHaveProperty('benchmark-workload')

      await database.finishRun({
        runId: run.runId,
        finishedAt: '2026-06-26T00:00:01.000Z',
        durationMs: 1000,
        results: [
          {
            id: 'test.database.case',
            suite: 'Test',
            name: 'Database case',
            description: 'Test retained result',
            variantKey: 'default',
            parameters: {},
            tags: ['database'],
            status: 'passed',
            iterations: 2,
            warmupIterations: 1,
            operationsPerIteration: 1,
            samplesMs: [1, 2],
            statistics: summarizeSamples([1, 2]),
            operationsPerSecond: 666.666,
            elapsedMs: 3,
          },
        ],
        modelsDownloaded: 0,
        remoteNetworkAttemptsBlocked: 0,
      })

      const rows = await database.latestResultRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        case_id: 'test.database.case',
        status: 'passed',
        median_ms: 1.5,
      })
    } finally {
      await database.close()
    }
  })
})
