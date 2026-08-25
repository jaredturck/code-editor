/**
 * Exposes bounded IRIS document/PDF/archive extraction to the Code Editor without unpacking
 * archives to disk or granting broader filesystem authority than the semantic index already owns.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js'
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js'
import { requireBridgePermission } from '../shared/bridgeAuthorization.js'
import { readJsonBody, sendJson } from '../services/fileService.js'
import { inspectIndexedDocument } from '../services/documentInspectionService.js'

export async function handleDocumentRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  _requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname !== '/api/local/fs/document/inspect' || req.method !== 'POST') return false

  requireBridgePermission(securityContext, 'fileRead')
  const body = await readJsonBody(req)
  try {
    sendJson(res, 200, await inspectIndexedDocument(baseDir, body.path))
  } catch (error) {
    sendJson(res, 422, {
      error: error instanceof Error ? error.message : 'IRIS could not inspect this document.',
    })
  }
  return true
}
