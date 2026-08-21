/**
 * Fixed-size worker pool for CPU-heavy document and PDF parsing. The pool uses up to eight
 * logical CPUs, reuses workers across both stages, and replaces a worker when a file exceeds
 * the hard job deadline.
 */

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type {
  FileExtractionKind,
  FileExtractionResult,
  FileExtractionWorkerRequest,
  FileExtractionWorkerResponse,
} from './fileExtractionWorkerTypes.js';

const FILE_EXTRACTION_MAX_WORKERS = 8;
const FILE_EXTRACTION_JOB_TIMEOUT_MS = 6_000;

interface QueuedExtractionJob {
  id: number;
  kind: FileExtractionKind;
  filePath: string;
  resolve: (result: FileExtractionResult) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  job: QueuedExtractionJob | null;
  timeout: NodeJS.Timeout | null;
}

function extractionError(message: string): Error {
  return new Error(message || 'File extraction failed');
}

export class FileExtractionPool {
  readonly workerCount = Math.max(1, Math.min(FILE_EXTRACTION_MAX_WORKERS, availableParallelism()));

  private workers: WorkerSlot[] = [];
  private queue: QueuedExtractionJob[] = [];
  private nextJobId = 1;
  private closed = false;

  extract(kind: FileExtractionKind, filePath: string): Promise<FileExtractionResult> {
    if (this.closed) return Promise.reject(extractionError('Extraction pool is closed'));
    this.ensureWorkers();
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        kind,
        filePath,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = extractionError('File extraction was cancelled');
    for (const job of this.queue.splice(0)) job.reject(error);
    const workers = this.workers.splice(0);
    await Promise.all(
      workers.map(async (slot) => {
        if (slot.timeout) clearTimeout(slot.timeout);
        slot.job?.reject(error);
        slot.job = null;
        await slot.worker.terminate().catch(() => undefined);
      }),
    );
  }

  private ensureWorkers(): void {
    while (!this.closed && this.workers.length < this.workerCount) {
      this.workers.push(this.createWorkerSlot());
    }
  }

  private createWorkerSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: new Worker(new URL('./fileExtractionWorker.js', import.meta.url)),
      job: null,
      timeout: null,
    };
    slot.worker.on('message', (response: FileExtractionWorkerResponse) => {
      this.finishJob(slot, response);
    });
    slot.worker.on('error', (error) => {
      this.replaceFailedWorker(slot, error);
    });
    slot.worker.on('exit', (code) => {
      if (!this.closed && code !== 0 && this.workers.includes(slot)) {
        this.replaceFailedWorker(
          slot,
          extractionError(`File extraction worker exited with code ${code}`),
        );
      }
    });
    return slot;
  }

  private dispatch(): void {
    if (this.closed) return;
    for (const slot of this.workers) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift();
      if (!job) break;
      slot.job = job;
      const request: FileExtractionWorkerRequest = {
        id: job.id,
        kind: job.kind,
        filePath: job.filePath,
      };
      slot.timeout = setTimeout(() => {
        this.replaceFailedWorker(
          slot,
          extractionError('File extraction exceeded the six-second limit'),
        );
      }, FILE_EXTRACTION_JOB_TIMEOUT_MS);
      slot.worker.postMessage(request);
    }
  }

  private finishJob(slot: WorkerSlot, response: FileExtractionWorkerResponse): void {
    const job = slot.job;
    if (!job || response.id !== job.id) return;
    if (slot.timeout) clearTimeout(slot.timeout);
    slot.timeout = null;
    slot.job = null;
    if (response.error) job.reject(extractionError(response.error));
    else job.resolve(response.result ?? null);
    this.dispatch();
  }

  private replaceFailedWorker(slot: WorkerSlot, error: Error): void {
    const index = this.workers.indexOf(slot);
    if (index < 0) return;
    if (slot.timeout) clearTimeout(slot.timeout);
    slot.timeout = null;
    slot.job?.reject(error);
    slot.job = null;
    this.workers.splice(index, 1);
    void slot.worker.terminate().catch(() => undefined);
    if (!this.closed) {
      this.workers.push(this.createWorkerSlot());
      this.dispatch();
    }
  }
}

export function createFileExtractionPool(): FileExtractionPool {
  return new FileExtractionPool();
}
