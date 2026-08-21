/** Runs bounded document and PDF extraction away from the bridge event loop. */

import { parentPort } from 'node:worker_threads';
import { extractDocumentText } from './fileDocumentService.js';
import { extractPdfText } from './filePdfService.js';
import type {
  FileExtractionWorkerRequest,
  FileExtractionWorkerResponse,
} from './fileExtractionWorkerTypes.js';

const workerPort = parentPort;
if (!workerPort) throw new Error('File extraction worker requires a parent port');

workerPort.on('message', async (request: FileExtractionWorkerRequest) => {
  const controller = new AbortController();
  try {
    const result =
      request.kind === 'pdf'
        ? await extractPdfText(request.filePath, controller.signal)
        : await extractDocumentText(request.filePath, controller.signal);
    const response: FileExtractionWorkerResponse = {
      id: request.id,
      result,
    };
    workerPort.postMessage(response);
  } catch (error) {
    const response: FileExtractionWorkerResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : 'File extraction failed',
    };
    workerPort.postMessage(response);
  }
});
