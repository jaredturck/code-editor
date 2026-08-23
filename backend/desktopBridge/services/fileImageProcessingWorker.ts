/**
 * Hosts the Sharp image-preparation function inside a worker thread and transfers the completed
 * RGB buffer back to the bridge without another structured-clone copy.
 */

import { parentPort } from 'node:worker_threads'
import { prepareClipImage } from './fileImagePreparation.js'
import type {
  FileImageProcessingWorkerRequest,
  FileImageProcessingWorkerResponse,
} from './fileImageProcessingWorkerTypes.js'

/** Converts an unknown worker failure into the bounded message sent to the parent process. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Image decode failed')
}

if (!parentPort) throw new Error('Image preprocessing worker requires a parent port')

parentPort.on('message', async (request: FileImageProcessingWorkerRequest) => {
  try {
    const image = await prepareClipImage(request.filePath)
    const response: FileImageProcessingWorkerResponse = {
      id: request.id,
      image,
    }
    parentPort!.postMessage(response, [image.data.buffer as ArrayBuffer])
  } catch (error) {
    const response: FileImageProcessingWorkerResponse = {
      id: request.id,
      error: message(error),
    }
    parentPort!.postMessage(response)
  }
})
