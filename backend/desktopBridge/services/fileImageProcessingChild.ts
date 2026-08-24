/**
 * Runs Sharp image preparation in a plain Node child process on Linux/Electron so native
 * image decoder failures cannot terminate the Electron main process.
 */

import { prepareClipImage } from './fileImagePreparation.js'
import type {
  FileImageProcessingWorkerRequest,
  FileImageProcessingWorkerResponse,
} from './fileImageProcessingWorkerTypes.js'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Image decode failed')
}

process.on('message', async (request: FileImageProcessingWorkerRequest) => {
  if (!request || typeof request.id !== 'number' || typeof request.filePath !== 'string') return
  try {
    const image = await prepareClipImage(request.filePath)
    const response: FileImageProcessingWorkerResponse = {
      id: request.id,
      image,
    }
    process.send?.(response)
  } catch (error) {
    const response: FileImageProcessingWorkerResponse = {
      id: request.id,
      error: message(error),
    }
    process.send?.(response)
  }
})

process.on('disconnect', () => process.exit(0))
