/** Runs bounded document and PDF extraction away from the bridge event loop. */

import { parentPort } from 'node:worker_threads'
import { extractDocumentText } from './fileDocumentService.js'
import type { FileExtractionWorkerRequest, FileExtractionWorkerResponse } from './fileExtractionWorkerTypes.js'

const workerPort = parentPort
if (!workerPort) throw new Error('File extraction worker requires a parent port')

async function extractRequestedFile(request: FileExtractionWorkerRequest, signal: AbortSignal) {
  if (request.kind === 'pdf') {
    const { extractPdfText } = await import('./filePdfService.js')
    return extractPdfText(request.filePath, signal)
  }
  return extractDocumentText(request.filePath, signal)
}

workerPort.on('message', async (request: FileExtractionWorkerRequest) => {
  const controller = new AbortController()
  try {
    const result = await extractRequestedFile(request, controller.signal)
    const response: FileExtractionWorkerResponse = {
      id: request.id,
      result,
    }
    workerPort.postMessage(response)
  } catch (error) {
    const response: FileExtractionWorkerResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : 'File extraction failed',
    }
    workerPort.postMessage(response)
  }
})
