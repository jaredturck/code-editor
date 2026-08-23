/** Verifies benchmark statistics, lifecycle isolation, network safety, and latest-report exports. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installBenchmarkNetworkGuard } from '../../benchmarks/core/networkGuard'
import { writeBenchmarkReport } from '../../benchmarks/core/report'
import { runBenchmark } from '../../benchmarks/core/runner'
import { percentile, summarizeSamples } from '../../benchmarks/core/statistics'
import type { BenchmarkEnvironment, BenchmarkReport } from '../../benchmarks/core/types'

/** Creates one deterministic runner environment without opening the benchmark database. */
function environment(): BenchmarkEnvironment {
  return {
    runId: 1,
    runKey: 'test-run',
    startedAt: '2026-06-26T00:00:00.000Z',
    databasePath: '/tmp/iris-benchmark.sqlite3',
    databaseKey: Buffer.alloc(32, 1),
    fixtureRoot: '/tmp/iris-benchmark-fixtures',
  }
}

/** Creates one complete report fixture for Markdown and CSV export tests. */
function reportFixture(): BenchmarkReport {
  return {
    schemaVersion: 2,
    runId: 1,
    runKey: 'test-report',
    startedAt: '2026-06-26T00:00:00.000Z',
    finishedAt: '2026-06-26T00:00:01.000Z',
    elapsedMs: 1000,
    remoteNetworkAttemptsBlocked: 0,
    models: [],
    system: {
      generatedAt: '2026-06-26T00:00:01.000Z',
      platform: 'linux',
      release: 'test',
      architecture: 'x64',
      hostname: 'test-host',
      cpuModel: 'test-cpu',
      logicalCpuCount: 1,
      totalMemoryBytes: 1024,
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      electronVersion: '',
      sqliteVersion: 'test',
      sharpVersion: 'test',
      ffmpegVersion: 'test',
      ollamaVersion: 'test',
      commit: 'test',
      branch: 'test',
      gpuSummary: '',
      command: 'npm run benchmark',
    },
    results: [
      {
        id: 'test.case',
        suite: 'Test suite',
        name: 'Test case',
        description: 'Report fixture',
        variantKey: 'default',
        parameters: {},
        tags: [],
        status: 'passed',
        iterations: 1,
        warmupIterations: 0,
        operationsPerIteration: 1,
        samplesMs: [1],
        statistics: summarizeSamples([1]),
        operationsPerSecond: 1000,
        peakRssBytes: 1024,
        peakHeapUsedBytes: 512,
        peakExternalBytes: 128,
        peakArrayBuffersBytes: 64,
        elapsedMs: 1,
      },
    ],
  }
}

describe('benchmark core', () => {
  it('calculates interpolated percentiles and dispersion summaries', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(summarizeSamples([4, 1, 3, 2])).toMatchObject({
      count: 4,
      totalMs: 10,
      meanMs: 2.5,
      medianMs: 2.5,
      minMs: 1,
      maxMs: 4,
      p90Ms: 3.7,
    })
  })

  it('keeps warmups outside measured samples and records external memory peaks', async () => {
    const run = vi.fn((_: { value: number }, iteration: number) => iteration)
    const result = await runBenchmark(
      {
        id: 'test.lifecycle',
        suite: 'Test',
        name: 'Lifecycle',
        description: 'Exercises warmup and measurement order',
        iterations: 3,
        warmupIterations: 1,
        setup: () => ({ value: 1 }),
        run,
      },
      environment(),
    )

    expect(result.status).toBe('passed')
    expect(result.samplesMs).toHaveLength(3)
    expect(result.peakExternalBytes).toBeGreaterThanOrEqual(0)
    expect(result.peakArrayBuffersBytes).toBeGreaterThanOrEqual(0)
    expect(run.mock.calls.map((call) => call[1])).toEqual([-1, 0, 1, 2])
  })

  it('overwrites one Markdown report and one normalized CSV export', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-benchmark-report-'))
    try {
      const files = await writeBenchmarkReport({
        report: reportFixture(),
        previous: new Map(),
        latestRows: [
          {
            run_id: 1,
            suite: 'Test suite',
            case_id: 'test.case',
            status: 'passed',
            median_ms: 1,
          },
        ],
        outputRoot: root,
      })
      const [markdown, csv, entries] = await Promise.all([
        fs.readFile(files.markdownPath, 'utf8'),
        fs.readFile(files.csvPath, 'utf8'),
        fs.readdir(root),
      ])

      expect(markdown).toContain('# IRIS Benchmark Report')
      expect(markdown).toContain('Historical results')
      expect(csv).toContain('case_id')
      expect(csv).toContain('test.case')
      expect(entries.sort()).toEqual(['report.md', 'results.csv'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('does not run teardown when setup intentionally skips a missing local resource', async () => {
    const teardown = vi.fn()
    const result = await runBenchmark(
      {
        id: 'test.skip',
        suite: 'Test',
        name: 'Skipped setup',
        description: 'Exercises setup skip behavior',
        setup: () => ({ skip: true, reason: 'Resource unavailable' }),
        run: () => undefined,
        teardown,
      },
      environment(),
    )

    expect(result).toMatchObject({
      status: 'skipped',
      skipReason: 'Resource unavailable',
    })
    expect(teardown).not.toHaveBeenCalled()
  })

  it('blocks non-loopback fetches before a remote provider can be contacted', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response('{}')) as typeof fetch
    const guard = installBenchmarkNetworkGuard()
    try {
      await expect(fetch('https://api.openai.com/v1/models')).rejects.toThrow('blocked non-loopback request')
      await expect(fetch('http://127.0.0.1:11434/api/tags')).resolves.toBeInstanceOf(Response)
      expect(guard.blockedAttempts).toBe(1)
    } finally {
      guard.restore()
      globalThis.fetch = originalFetch
    }
  })
})
