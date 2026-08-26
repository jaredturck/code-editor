/** Extracts one indexed document for trusted editor Search without widening agent file permissions. */

import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathWithinRoots } from '../shared/filesystemBoundary.js'
import { getFileIndexAccessRoots } from './fileIndexSourceService.js'
import { extractDocumentText } from './fileDocumentService.js'
import { hasZipSignature } from './fileArchiveService.js'

const SIGNATURE_BYTES = 8

export interface DocumentInspectionResult {
  path: string
  name: string
  kind: 'document' | 'pdf' | 'archive'
  text: string
  sourceType: string
  extractionMethod: string
  pagesRead?: number
  archiveEntry?: string
}

async function readFileSignature(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES)
    const read = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read.bytesRead)
  } finally {
    await handle.close()
  }
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF'
}

/** Resolve against the configured file-index roots, then perform bounded document extraction. */
export async function inspectIndexedDocument(
  baseDir: string,
  requestedPath: unknown,
): Promise<DocumentInspectionResult> {
  const roots = await getFileIndexAccessRoots(baseDir)
  const targetPath = await resolveExistingPathWithinRoots(requestedPath, roots, baseDir)
  const stats = await fs.stat(targetPath)
  if (!stats.isFile()) throw new Error('Document inspection requires a file.')

  const signature = await readFileSignature(targetPath)
  const controller = new AbortController()

  if (hasPdfSignature(signature)) {
    const { extractPdfText } = await import('./filePdfService.js')
    const extracted = await extractPdfText(targetPath, controller.signal)
    if (!extracted) throw new Error('IRIS could not extract searchable text from this PDF.')
    return {
      path: targetPath,
      name: path.basename(targetPath),
      kind: 'pdf',
      ...extracted,
    }
  }

  if (hasZipSignature(signature)) {
    const extracted = await extractDocumentText(targetPath, controller.signal)
    if (!extracted) throw new Error('IRIS could not extract searchable text from this document or archive.')
    return {
      path: targetPath,
      name: path.basename(targetPath),
      kind: extracted.sourceType === 'zip' ? 'archive' : 'document',
      ...extracted,
    }
  }

  throw new Error('IRIS document inspection supports PDFs and ZIP-based Office/OpenDocument/archive files.')
}
