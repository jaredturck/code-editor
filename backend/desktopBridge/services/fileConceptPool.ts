/** Persistent worker pool for concept-centroid training and bulk membership assignment. */

import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { FileConceptWorkerRequest, FileConceptWorkerResponse } from './fileConceptWorkerTypes.js'

const MAX_CONCEPT_WORKERS = 8

interface PendingRequest {
  resolve: (response: FileConceptWorkerResponse) => void
  reject: (error: Error) => void
}

interface WorkerSlot {
  worker: Worker
  pending: Map<number, PendingRequest>
  sampleRows: number
  activeAssignments: number
  closing: boolean
}

export interface FileConceptBroadStepResult {
  sums: Float32Array
  counts: Int32Array
}

export interface FileConceptAssignmentResult {
  conceptIndexes: Int32Array
  scores: Float32Array
}

function responseError(response: FileConceptWorkerResponse): Error {
  return new Error(response.error || 'Concept worker failed')
}

function copyBuffer(values: Float32Array | Int32Array): ArrayBuffer {
  const copy = new Uint8Array(values.byteLength)
  copy.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
  return copy.buffer
}

export class FileConceptPool {
  readonly workerCount = Math.max(1, Math.min(MAX_CONCEPT_WORKERS, availableParallelism()))

  private slots: WorkerSlot[] = []
  private nextRequestId = 1
  private nextAssignmentWorker = 0
  private closed = false

  constructor() {
    for (let index = 0; index < this.workerCount; index += 1) {
      this.slots.push(this.createSlot())
    }
  }

  async initializeSample(vectors: Float32Array, dimension: number): Promise<void> {
    const rowCount = vectors.length / dimension
    if (!Number.isInteger(rowCount) || rowCount < 1) throw new Error('Concept sample is empty')
    const chunkRows = Math.ceil(rowCount / this.slots.length)
    await Promise.all(
      this.slots.map(async (slot, index) => {
        const startRow = Math.min(rowCount, index * chunkRows)
        const endRow = Math.min(rowCount, startRow + chunkRows)
        const chunk = vectors.slice(startRow * dimension, endRow * dimension)
        slot.sampleRows = endRow - startRow
        const buffer = chunk.buffer as ArrayBuffer
        await this.request(
          slot,
          {
            id: this.nextRequestId++,
            type: 'initialize-sample',
            vectors: buffer,
            dimension,
          },
          [buffer],
        )
      }),
    )
  }

  async broadStep(
    centroids: Float32Array,
    centroidCount: number,
    dimension: number,
  ): Promise<FileConceptBroadStepResult> {
    const results = await Promise.all(
      this.slots
        .filter((slot) => slot.sampleRows > 0)
        .map(async (slot) => {
          const buffer = copyBuffer(centroids)
          return this.request(
            slot,
            {
              id: this.nextRequestId++,
              type: 'broad-step',
              centroids: buffer,
              centroidCount,
            },
            [buffer],
          )
        }),
    )
    const sums = new Float32Array(centroidCount * dimension)
    const counts = new Int32Array(centroidCount)
    for (const response of results) {
      if (!response.sums || !response.counts) throw responseError(response)
      const partialSums = new Float32Array(response.sums)
      const partialCounts = new Int32Array(response.counts)
      for (let index = 0; index < sums.length; index += 1) sums[index] += partialSums[index]
      for (let index = 0; index < counts.length; index += 1) counts[index] += partialCounts[index]
    }
    return { sums, counts }
  }

  async broadAssignments(centroids: Float32Array, centroidCount: number): Promise<Int32Array> {
    const results = await Promise.all(
      this.slots.map(async (slot) => {
        if (!slot.sampleRows) return new Int32Array(0)
        const buffer = copyBuffer(centroids)
        const response = await this.request(
          slot,
          {
            id: this.nextRequestId++,
            type: 'broad-assignments',
            centroids: buffer,
            centroidCount,
          },
          [buffer],
        )
        if (!response.assignments) throw responseError(response)
        return new Int32Array(response.assignments)
      }),
    )
    const assignments = new Int32Array(results.reduce((sum, item) => sum + item.length, 0))
    let offset = 0
    for (const result of results) {
      assignments.set(result, offset)
      offset += result.length
    }
    return assignments
  }

  async trainLocalClusters(
    jobs: Array<{
      vectors: Float32Array
      dimension: number
      centroidCount: number
      iterations: number
      seed: number
    }>,
  ): Promise<Float32Array[]> {
    return Promise.all(
      jobs.map(async (job, index) => {
        const slot = this.slots[index % this.slots.length]
        const buffer = job.vectors.buffer as ArrayBuffer
        const response = await this.request(
          slot,
          {
            id: this.nextRequestId++,
            type: 'train-local',
            vectors: buffer,
            dimension: job.dimension,
            centroidCount: job.centroidCount,
            iterations: job.iterations,
            seed: job.seed,
          },
          [buffer],
        )
        if (!response.centroids) throw responseError(response)
        return new Float32Array(response.centroids)
      }),
    )
  }

  async setModel(
    dimension: number,
    broadCentroids: Float32Array,
    localCentroids: Float32Array,
    localOffsets: Int32Array,
  ): Promise<void> {
    await Promise.all(
      this.slots.map(async (slot) => {
        const broadBuffer = copyBuffer(broadCentroids)
        const localBuffer = copyBuffer(localCentroids)
        const offsetsBuffer = copyBuffer(localOffsets)
        await this.request(
          slot,
          {
            id: this.nextRequestId++,
            type: 'set-model',
            dimension,
            broadCentroids: broadBuffer,
            localCentroids: localBuffer,
            localOffsets: offsetsBuffer,
          },
          [broadBuffer, localBuffer, offsetsBuffer],
        )
      }),
    )
  }

  async assign(vectors: Float32Array, maximumMemberships: number): Promise<FileConceptAssignmentResult> {
    const slot = this.leastBusyAssignmentSlot()
    slot.activeAssignments += 1
    const buffer = vectors.buffer as ArrayBuffer
    try {
      const response = await this.request(
        slot,
        {
          id: this.nextRequestId++,
          type: 'assign',
          vectors: buffer,
          maximumMemberships,
        },
        [buffer],
      )
      if (!response.conceptIndexes || !response.scores) throw responseError(response)
      return {
        conceptIndexes: new Int32Array(response.conceptIndexes),
        scores: new Float32Array(response.scores),
      }
    } finally {
      slot.activeAssignments -= 1
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const error = new Error('Concept worker pool was closed')
    const slots = this.slots.splice(0)
    await Promise.all(
      slots.map(async (slot) => {
        slot.closing = true
        for (const pending of slot.pending.values()) pending.reject(error)
        slot.pending.clear()
        await slot.worker.terminate().catch(() => undefined)
      }),
    )
  }

  private leastBusyAssignmentSlot(): WorkerSlot {
    let selected = this.slots[this.nextAssignmentWorker % this.slots.length]
    this.nextAssignmentWorker += 1
    for (const slot of this.slots) {
      if (slot.activeAssignments < selected.activeAssignments) selected = slot
    }
    return selected
  }

  private createSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: new Worker(new URL('./fileConceptWorker.js', import.meta.url), {
        execArgv: [],
      }),
      pending: new Map(),
      sampleRows: 0,
      activeAssignments: 0,
      closing: false,
    }
    slot.worker.on('message', (response: FileConceptWorkerResponse) => {
      const pending = slot.pending.get(response.id)
      if (!pending) return
      slot.pending.delete(response.id)
      if (response.type === 'error') pending.reject(responseError(response))
      else pending.resolve(response)
    })
    const rejectAll = (error: unknown) => {
      if (slot.closing) return
      const normalized = error instanceof Error ? error : new Error(String(error))
      for (const pending of slot.pending.values()) pending.reject(normalized)
      slot.pending.clear()
    }
    slot.worker.on('error', rejectAll)
    slot.worker.on('exit', (code) => {
      if (!slot.closing && code !== 0) rejectAll(new Error(`Concept worker exited with ${code}`))
    })
    return slot
  }

  private request(
    slot: WorkerSlot,
    request: FileConceptWorkerRequest,
    transferList: ArrayBuffer[],
  ): Promise<FileConceptWorkerResponse> {
    if (this.closed) return Promise.reject(new Error('Concept worker pool is closed'))
    return new Promise((resolve, reject) => {
      slot.pending.set(request.id, { resolve, reject })
      slot.worker.postMessage(request, transferList)
    })
  }
}

export function createFileConceptPool(): FileConceptPool {
  return new FileConceptPool()
}
