/** Runs IRIS's complete local benchmark suite and overwrites the latest Markdown/CSV exports. */

import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { BenchmarkDatabase } from './core/database.js'
import { prepareBenchmarkModels } from './core/localModels.js'
import { installBenchmarkNetworkGuard } from './core/networkGuard.js'
import { writeBenchmarkReport } from './core/report.js'
import { runBenchmarks } from './core/runner.js'
import { readBenchmarkSystemInfo } from './core/system.js'
import type { BenchmarkDefinition, BenchmarkReport, BenchmarkResult } from './core/types.js'
import { agentBenchmarks } from './suites/agents.benchmark.js'
import { cryptoBenchmarks } from './suites/crypto.benchmark.js'
import { databaseBenchmarks } from './suites/database.benchmark.js'
import { indexingBenchmarks } from './suites/indexing.benchmark.js'
import { liveModelBenchmarks } from './suites/liveModels.benchmark.js'
import { networkBenchmarks } from './suites/network.benchmark.js'
import { persistenceBenchmarks } from './suites/persistence.benchmark.js'
import { pipelineBenchmarks } from './suites/pipelines.benchmark.js'
import { providerBenchmarks } from './suites/providers.benchmark.js'

const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version?: string }

const definitions: BenchmarkDefinition<any>[] = [
  ...cryptoBenchmarks,
  ...databaseBenchmarks,
  ...persistenceBenchmarks,
  ...indexingBenchmarks,
  ...pipelineBenchmarks,
  ...liveModelBenchmarks,
  ...providerBenchmarks,
  ...agentBenchmarks,
  ...networkBenchmarks,
]

/** Formats elapsed benchmark time for readable terminal progress. */
function terminalDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds.toFixed(1)} ms`
  return `${(milliseconds / 1000).toFixed(2)} s`
}

/** Formats one completed benchmark line with median and throughput where available. */
function resultLine(result: BenchmarkResult): string {
  const marker = result.status === 'passed' ? '✓' : result.status === 'skipped' ? '○' : '✗'
  if (result.status === 'skipped') return `${marker} ${result.id} · ${result.skipReason}`
  if (result.status === 'failed') return `${marker} ${result.id} · failed`
  const throughput = result.operationsPerSecond
    ? ` · ${result.operationsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 1 })} ops/s`
    : ''
  return `${marker} ${result.id} · median ${terminalDuration(result.statistics?.medianMs || 0)}${throughput}`
}

/** Executes one complete local-only run with retained history and guaranteed workload cleanup. */
async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error('IRIS exposes one benchmark entry point: npm run benchmark')
  }

  const networkGuard = installBenchmarkNetworkGuard()
  const startedAt = new Date()
  const runStartedAt = performance.now()
  const results: BenchmarkResult[] = []
  let database: BenchmarkDatabase | null = null
  let runId = 0
  let runKey = ''
  let models = [] as Awaited<ReturnType<typeof prepareBenchmarkModels>>
  let fatalError = ''

  try {
    const system = await readBenchmarkSystemInfo()
    database = await BenchmarkDatabase.open()
    const run = await database.beginRun({
      startedAt: startedAt.toISOString(),
      appVersion: String(packageJson.version || ''),
      gitCommit: system.commit,
      gitBranch: system.branch,
      command: 'npm run benchmark',
      workingDirectory: process.cwd(),
    })
    runId = run.runId
    runKey = run.runKey

    await database.recordEnvironment(runId, system)
    await database.registerCases(definitions)
    await database.recordEvent(
      runId,
      'info',
      'startup',
      'benchmark_started',
      `Starting ${definitions.length} benchmark cases.`,
    )

    // Clear only production-style workload rows from an interrupted or prior benchmark run.
    await database.cleanupWorkloadData()
    await database.markWorkloadDirty(runId)

    console.log('Preparing real local models through CLIP and loopback Ollama...')
    models = await prepareBenchmarkModels()
    for (const model of models) {
      await database.recordModel(runId, model)
      await database.recordEvent(
        runId,
        model.available ? 'info' : 'warning',
        'models',
        model.available ? 'model_ready' : 'model_unavailable',
        `${model.modelId}: ${model.available ? 'ready' : model.errorMessage || 'unavailable'}`,
        {
          runtime: model.runtime,
          device: model.device,
          dtype: model.dtype,
          downloadedDuringRun: model.downloadedDuringRun,
        },
      )
    }

    console.log(`Running ${definitions.length} IRIS benchmark cases...`)
    const environment = {
      runId,
      runKey,
      startedAt: startedAt.toISOString(),
      databasePath: database.databasePath,
      databaseKey: Buffer.from(database.masterKey),
      fixtureRoot: database.fixtureRoot,
    }
    results.push(
      ...(await runBenchmarks(definitions, environment, async (result, index, total) => {
        const resultId = await database?.recordResult(runId, result)
        await database?.recordEvent(
          runId,
          result.status === 'failed' ? 'error' : result.status === 'skipped' ? 'warning' : 'info',
          'execution',
          `benchmark_${result.status}`,
          `${result.id}: ${result.status}`,
          {
            variant: result.variantKey,
            medianMs: result.statistics?.medianMs,
          },
          resultId,
        )
        console.log(`[${index + 1}/${total}] ${resultLine(result)}`)
      })),
    )

    if (networkGuard.blockedAttempts > 0) {
      fatalError = `The network guard blocked ${networkGuard.blockedAttempts} non-loopback request(s): ${networkGuard.blockedUrls.join(', ')}`
      await database.recordEvent(runId, 'error', 'security', 'remote_network_blocked', fatalError, {
        urls: networkGuard.blockedUrls,
      })
    }

    await database.cleanupWorkloadData(runId)
    const finishedAt = new Date()
    const elapsedMs = performance.now() - runStartedAt
    await database.finishRun({
      runId,
      finishedAt: finishedAt.toISOString(),
      durationMs: elapsedMs,
      results,
      modelsDownloaded: models.filter((model) => model.downloadedDuringRun).length,
      remoteNetworkAttemptsBlocked: networkGuard.blockedAttempts,
      fatalError: fatalError || undefined,
    })

    const report: BenchmarkReport = {
      schemaVersion: 2,
      runId,
      runKey,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs,
      system,
      models,
      results,
      remoteNetworkAttemptsBlocked: networkGuard.blockedAttempts,
    }
    const [previous, latestRows] = await Promise.all([database.previousResults(runId), database.latestResultRows()])
    const files = await writeBenchmarkReport({ report, previous, latestRows })
    console.log(`\nMarkdown report: ${files.markdownPath}`)
    console.log(`CSV export:      ${files.csvPath}`)

    const incomplete = results.filter((result) => result.status !== 'passed')
    if (fatalError || incomplete.length) {
      console.error(
        `\nBenchmark completed with ${incomplete.length} incomplete case(s)${fatalError ? ' and a security failure' : ''}.`,
      )
      process.exitCode = 1
    }
  } catch (error) {
    fatalError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(fatalError)
    process.exitCode = 1
    if (database && runId) {
      await database.cleanupWorkloadData(runId).catch(() => undefined)
      await database
        .finishRun({
          runId,
          finishedAt: new Date().toISOString(),
          durationMs: performance.now() - runStartedAt,
          results,
          modelsDownloaded: models.filter((model) => model.downloadedDuringRun).length,
          remoteNetworkAttemptsBlocked: networkGuard.blockedAttempts,
          fatalError,
        })
        .catch(() => undefined)
    }
  } finally {
    networkGuard.restore()
    await database?.close().catch((error) => {
      console.error(`Benchmark database close failed: ${String(error)}`)
      process.exitCode = 1
    })
  }
}

await main()
