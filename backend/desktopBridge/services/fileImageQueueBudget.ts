import fs from 'node:fs/promises'
import os from 'node:os'

const GIB = 1024 ** 3
const MINIMUM_RESERVE_BYTES = 1 * GIB
const MAXIMUM_RESERVE_BYTES = 3 * GIB
const MAXIMUM_QUEUE_BYTES = 5 * GIB
const ESTIMATED_PREPARED_IMAGE_BYTES = 192 * 1024
const DEFAULT_PREPARED_BATCH_COUNT = 4
const MAXIMUM_PREPARED_BATCH_COUNT = 6

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function calculatePreparedImageQueueBudget(totalMemoryBytes: number, availableMemoryBytes: number): number {
  const reserveBytes = clamp(Math.floor(totalMemoryBytes * 0.25), MINIMUM_RESERVE_BYTES, MAXIMUM_RESERVE_BYTES)
  return Math.min(MAXIMUM_QUEUE_BYTES, Math.max(0, availableMemoryBytes - reserveBytes))
}

export function calculatePreparedImageQueueCapacity(
  totalMemoryBytes: number,
  availableMemoryBytes: number,
  workerCount: number,
  batchSize = 256,
  targetBatchCount = DEFAULT_PREPARED_BATCH_COUNT,
): number {
  const normalizedWorkers = Math.max(1, Math.floor(workerCount))
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize))
  const normalizedBatchCount = Math.max(2, Math.min(MAXIMUM_PREPARED_BATCH_COUNT, Math.floor(targetBatchCount)))
  const queueBudgetBytes = calculatePreparedImageQueueBudget(totalMemoryBytes, availableMemoryBytes)
  const memoryCapacity = Math.max(normalizedWorkers, Math.floor(queueBudgetBytes / ESTIMATED_PREPARED_IMAGE_BYTES))
  const desiredCapacity = Math.max(normalizedWorkers, normalizedBatchSize * normalizedBatchCount)
  return Math.max(normalizedWorkers, Math.min(memoryCapacity, desiredCapacity))
}

async function linuxAvailableMemory(): Promise<number | null> {
  if (process.platform !== 'linux') return null
  const contents = await fs.readFile('/proc/meminfo', 'utf8').catch(() => '')
  const match = contents.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
  return match ? Number(match[1]) * 1024 : null
}

export async function resolvePreparedImageQueueCapacity(workerCount: number, batchSize = 256): Promise<number> {
  const availableMemoryBytes = (await linuxAvailableMemory()) ?? os.freemem()
  return calculatePreparedImageQueueCapacity(os.totalmem(), availableMemoryBytes, workerCount, batchSize)
}
