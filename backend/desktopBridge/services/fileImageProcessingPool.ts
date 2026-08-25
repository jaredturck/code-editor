import { fork, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import { Worker } from 'node:worker_threads'
import { FileImageQueue } from './fileImageQueue.js'
import type {
  FileImageProcessingWorkerRequest,
  FileImageProcessingWorkerResponse,
  PreparedClipImage,
} from './fileImageProcessingWorkerTypes.js'

const MAX_WORKERS = 24
const JOB_TIMEOUT_MS = 15_000

interface PendingJob {
  id: number
  filePath: string
  resolve: (image: PreparedClipImage) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

type ImageProcessor = { kind: 'thread'; process: Worker } | { kind: 'child'; process: ChildProcess }

interface WorkerSlot {
  processor: ImageProcessor
  job: PendingJob | null
  closing: boolean
}

export interface FileImageProcessingPool {
  workerCount: number
  prepare(filePath: string): Promise<PreparedClipImage>
  close(): Promise<void>
}

function workerCount(): number {
  return Math.max(1, Math.min(MAX_WORKERS, os.availableParallelism()))
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || 'Image preprocessing failed')
}

function shouldUseChildProcesses(): boolean {
  return process.platform === 'linux' && Boolean(process.versions.electron)
}

function createProcessor(): ImageProcessor {
  if (shouldUseChildProcesses()) {
    const execPath = String(process.env.npm_node_execpath || process.env.NODE || 'node')
    return {
      kind: 'child',
      process: fork(new URL('./fileImageProcessingChild.js', import.meta.url), [], {
        execPath,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        serialization: 'advanced',
      }),
    }
  }

  return {
    kind: 'thread',
    process: new Worker(new URL('./fileImageProcessingWorker.js', import.meta.url), {
      execArgv: [],
    }),
  }
}

function sendRequest(processor: ImageProcessor, request: FileImageProcessingWorkerRequest): void {
  if (processor.kind === 'thread') {
    processor.process.postMessage(request)
    return
  }
  processor.process.send?.(request)
}

function terminateProcessor(processor: ImageProcessor): Promise<number> {
  if (processor.kind === 'thread') return processor.process.terminate()
  return new Promise((resolve) => {
    const child = processor.process
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode ?? 0)
      return
    }
    child.once('exit', (code) => resolve(code ?? 0))
    child.kill()
  })
}

export function createFileImageProcessingPool(): FileImageProcessingPool {
  const count = workerCount()
  const slots: WorkerSlot[] = []
  const queue = new FileImageQueue<PendingJob>()
  let nextId = 1
  let closed = false

  const dispatch = () => {
    if (closed) return
    for (const slot of slots) {
      if (slot.job || !queue.length) continue
      const job = queue.shift()
      if (!job) continue
      slot.job = job
      job.timer = setTimeout(() => {
        if (slot.job !== job) return
        slot.job = null
        job.reject(new Error(`Image preprocessing timed out: ${job.filePath}`))
        void replaceSlot(slot)
      }, JOB_TIMEOUT_MS)
      const request: FileImageProcessingWorkerRequest = {
        id: job.id,
        filePath: job.filePath,
      }
      sendRequest(slot.processor, request)
    }
  }

  const createSlot = (): WorkerSlot => {
    const slot: WorkerSlot = {
      processor: createProcessor(),
      job: null,
      closing: false,
    }
    const onMessage = (response: FileImageProcessingWorkerResponse) => {
      const job = slot.job
      if (!job || response.id !== job.id) return
      slot.job = null
      if (job.timer) clearTimeout(job.timer)
      if (response.image) job.resolve(response.image)
      else job.reject(new Error(response.error || 'Image preprocessing failed'))
      dispatch()
    }
    const onError = (error: Error) => {
      const job = slot.job
      slot.job = null
      if (job?.timer) clearTimeout(job.timer)
      job?.reject(new Error(errorMessage(error)))
      if (!closed && !slot.closing) void replaceSlot(slot)
    }
    const onExit = (code: number | null) => {
      if (closed || slot.closing || code === 0) return
      const job = slot.job
      slot.job = null
      if (job?.timer) clearTimeout(job.timer)
      job?.reject(new Error(`Image preprocessing worker exited with code ${code ?? 'unknown'}`))
      void replaceSlot(slot)
    }

    if (slot.processor.kind === 'thread') {
      slot.processor.process.on('message', onMessage)
      slot.processor.process.on('error', onError)
      slot.processor.process.on('exit', onExit)
    } else {
      slot.processor.process.on('message', (response) => onMessage(response as FileImageProcessingWorkerResponse))
      slot.processor.process.on('error', onError)
      slot.processor.process.on('exit', onExit)
    }
    return slot
  }

  const replaceSlot = async (slot: WorkerSlot) => {
    if (closed || slot.closing) return
    slot.closing = true
    await terminateProcessor(slot.processor).catch(() => 0)
    const index = slots.indexOf(slot)
    if (index >= 0 && !closed) slots[index] = createSlot()
    dispatch()
  }

  for (let index = 0; index < count; index += 1) slots.push(createSlot())

  return {
    workerCount: count,
    prepare(filePath: string) {
      if (closed) return Promise.reject(new Error('Image preprocessing pool is closed'))
      return new Promise<PreparedClipImage>((resolve, reject) => {
        queue.push({ id: nextId++, filePath, resolve, reject })
        dispatch()
      })
    },
    async close() {
      if (closed) return
      closed = true
      const error = new Error('Image preprocessing pool was closed')
      queue.drain((job) => job.reject(error))
      for (const slot of slots) {
        slot.closing = true
        if (slot.job?.timer) clearTimeout(slot.job.timer)
        slot.job?.reject(error)
        slot.job = null
      }
      await Promise.all(slots.map((slot) => terminateProcessor(slot.processor).catch(() => 0)))
    },
  }
}
