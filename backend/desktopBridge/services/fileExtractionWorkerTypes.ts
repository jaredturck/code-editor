import type { DocumentTextResult } from './fileDocumentService.js'
import type { PdfTextResult } from './filePdfService.js'

export type FileExtractionKind = 'document' | 'pdf'
export type FileExtractionResult = DocumentTextResult | PdfTextResult | null

export interface FileExtractionWorkerRequest {
  id: number
  kind: FileExtractionKind
  filePath: string
}

export interface FileExtractionWorkerResponse {
  id: number
  result?: FileExtractionResult
  error?: string
}
