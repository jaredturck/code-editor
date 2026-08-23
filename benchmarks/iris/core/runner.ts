/** Runs benchmark definitions with warmups, isolated setup/teardown, and retained samples. */

import { performance } from 'node:perf_hooks'
import { summarizeSamples } from './statistics.js'
import type { BenchmarkDefinition, BenchmarkEnvironment, BenchmarkResult, BenchmarkSkip } from './types.js'

let resultSink: unknown

/** Identifies a setup result that intentionally cannot run on the current machine. */
function isSkip(value: unknown): value is BenchmarkSkip {
  return Boolean(value && typeof value === 'object' && (value as BenchmarkSkip).skip === true)
}

/** Runs one benchmark while keeping setup, model downloads, and teardown outside measured samples. */
export async function runBenchmark(
  definition: BenchmarkDefinition<any>,
  environment: BenchmarkEnvironment,
): Promise<BenchmarkResult> {
  const iterations = Math.max(1, definition.iterations ?? 8)
  const warmupIterations = Math.max(0, definition.warmupIterations ?? 2)
  const operationsPerIteration = Math.max(1, definition.operationsPerIteration ?? 1)
  const base: Omit<BenchmarkResult, 'status' | 'samplesMs' | 'elapsedMs'> = {
    id: definition.id,
    suite: definition.suite,
    name: definition.name,
    description: definition.description,
    variantKey: definition.variantKey || 'default',
    parameters: definition.parameters || {},
    tags: definition.tags || [],
    iterations,
    warmupIterations,
    operationsPerIteration,
    bytesPerOperation: definition.bytesPerOperation,
  }

  let context: any
  let shouldTeardown = false
  const caseStartedAt = performance.now()
  try {
    const setupValue = definition.setup ? await definition.setup(environment) : undefined
    if (isSkip(setupValue)) {
      return {
        ...base,
        status: 'skipped',
        skipReason: setupValue.reason,
        samplesMs: [],
        elapsedMs: performance.now() - caseStartedAt,
      }
    }
    context = setupValue
    shouldTeardown = true

    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      resultSink = await definition.run(context, -(iteration + 1))
    }
    globalThis.gc?.()

    const samplesMs: number[] = []
    let cpuUserMicros = 0
    let cpuSystemMicros = 0
    let peakRssBytes = 0
    let peakHeapUsedBytes = 0
    let peakExternalBytes = 0
    let peakArrayBuffersBytes = 0
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const memoryBefore = process.memoryUsage()
      const cpuBefore = process.cpuUsage()
      const startedAt = performance.now()
      resultSink = await definition.run(context, iteration)
      const elapsedMs = performance.now() - startedAt
      const cpu = process.cpuUsage(cpuBefore)
      const memoryAfter = process.memoryUsage()
      samplesMs.push(elapsedMs)
      cpuUserMicros += cpu.user
      cpuSystemMicros += cpu.system
      peakRssBytes = Math.max(peakRssBytes, memoryBefore.rss, memoryAfter.rss)
      peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memoryBefore.heapUsed, memoryAfter.heapUsed)
      peakExternalBytes = Math.max(peakExternalBytes, memoryBefore.external, memoryAfter.external)
      peakArrayBuffersBytes = Math.max(peakArrayBuffersBytes, memoryBefore.arrayBuffers, memoryAfter.arrayBuffers)
    }

    const statistics = summarizeSamples(samplesMs)
    const operationsPerSecond = statistics.meanMs ? (operationsPerIteration * 1000) / statistics.meanMs : 0
    const mebibytesPerSecond = definition.bytesPerOperation
      ? (operationsPerSecond * definition.bytesPerOperation) / (1024 * 1024)
      : undefined
    return {
      ...base,
      status: 'passed',
      samplesMs,
      statistics,
      operationsPerSecond,
      mebibytesPerSecond,
      cpuUserMs: cpuUserMicros / 1000,
      cpuSystemMs: cpuSystemMicros / 1000,
      peakRssBytes,
      peakHeapUsedBytes,
      peakExternalBytes,
      peakArrayBuffersBytes,
      elapsedMs: performance.now() - caseStartedAt,
    }
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error),
      samplesMs: [],
      elapsedMs: performance.now() - caseStartedAt,
    }
  } finally {
    if (definition.teardown && shouldTeardown) {
      try {
        await definition.teardown(context)
      } catch {
        // Preserve the benchmark result; global cleanup records teardown failures separately.
      }
    }
  }
}

/** Runs all definitions sequentially so model, database, and worker workloads do not overlap. */
export async function runBenchmarks(
  definitions: BenchmarkDefinition<any>[],
  environment: BenchmarkEnvironment,
  onResult?: (result: BenchmarkResult, index: number, total: number) => Promise<void> | void,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []
  for (let index = 0; index < definitions.length; index += 1) {
    const result = await runBenchmark(definitions[index], environment)
    results.push(result)
    await onResult?.(result, index, definitions.length)
  }
  return results
}
