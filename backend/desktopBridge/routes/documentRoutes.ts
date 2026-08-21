/**
 * Exposes bounded IRIS document/PDF/archive extraction to the Code Editor without unpacking
 * archives to disk or granting broader filesystem authority than the semantic index already owns.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { BridgeRequest, BridgeResponse } from '../types.js';
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js';
import { requireBridgePermission } from '../shared/bridgeAuthorization.js';
import { resolveExistingPathWithinRoots } from '../shared/filesystemBoundary.js';
import { readJsonBody, sendJson } from '../services/fileService.js';
import { getFileIndexAccessRoots } from '../services/fileIndexSourceService.js';
import { extractDocumentText } from '../services/fileDocumentService.js';
import { extractPdfText } from '../services/filePdfService.js';
import { hasZipSignature } from '../services/fileArchiveService.js';

const SIGNATURE_BYTES = 8;

async function read_file_signature(file_path: string): Promise<Buffer> {
  const handle = await fs.open(file_path, 'r');
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read.bytesRead);
  } finally {
    await handle.close();
  }
}

function has_pdf_signature(buffer: Buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
}

export async function handleDocumentRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  _requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname !== '/api/local/fs/document/inspect' || req.method !== 'POST') return false;

  requireBridgePermission(securityContext, 'fileRead');
  const body = await readJsonBody(req);
  const roots = await getFileIndexAccessRoots(baseDir);
  const target_path = await resolveExistingPathWithinRoots(body.path, roots, baseDir);
  const stats = await fs.stat(target_path);

  if (!stats.isFile()) {
    sendJson(res, 400, { error: 'Document inspection requires a file.' });
    return true;
  }

  const signature = await read_file_signature(target_path);
  const controller = new AbortController();

  if (has_pdf_signature(signature)) {
    const extracted = await extractPdfText(target_path, controller.signal);
    if (!extracted) {
      sendJson(res, 422, { error: 'IRIS could not extract searchable text from this PDF.' });
      return true;
    }
    sendJson(res, 200, {
      path: target_path,
      name: path.basename(target_path),
      kind: 'pdf',
      ...extracted,
    });
    return true;
  }

  if (hasZipSignature(signature)) {
    const extracted = await extractDocumentText(target_path, controller.signal);
    if (!extracted) {
      sendJson(res, 422, { error: 'IRIS could not extract searchable text from this document or archive.' });
      return true;
    }
    sendJson(res, 200, {
      path: target_path,
      name: path.basename(target_path),
      kind: extracted.sourceType === 'zip' ? 'archive' : 'document',
      ...extracted,
    });
    return true;
  }

  sendJson(res, 400, {
    error: 'IRIS document inspection supports PDFs and ZIP-based Office/OpenDocument/archive files.',
  });
  return true;
}
