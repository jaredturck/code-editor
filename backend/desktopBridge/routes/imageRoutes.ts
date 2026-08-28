import type { BridgeRequest, BridgeResponse } from '../types.js'
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js'
import { requireBridgePermission } from '../shared/bridgeAuthorization.js'
import { readJsonBody, sendJson } from '../services/bridgeServiceRuntime.js'
import { resolveDirectoryWithinRoot } from '../shared/filesystemBoundary.js'
import {
  generateProjectImage,
  getImageGenerationStatus,
  installImageGenerationModels,
  stopImageGenerationServer,
  waitForProjectImages,
} from '../services/imageGenerationService.js'

export async function handleImageRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/image/status' && req.method === 'GET') {
    sendJson(res, 200, await getImageGenerationStatus())
    return true
  }

  if (pathname === '/api/local/image/install' && req.method === 'POST') {
    sendJson(res, 200, await installImageGenerationModels())
    return true
  }

  if (pathname === '/api/local/image/generate' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const workspaceRoot = await resolveDirectoryWithinRoot(String(body.workspaceRoot || ''), baseDir)
    const format = ['square', 'landscape', 'portrait'].includes(String(body.format || ''))
      ? (String(body.format) as 'square' | 'landscape' | 'portrait')
      : 'landscape'
    const result = await generateProjectImage({
      prompt: String(body.prompt || ''),
      outputPath: String(body.path || ''),
      workspaceRoot,
      format,
    })
    sendJson(res, 200, result)
    return true
  }

  if (pathname === '/api/local/image/wait' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const workspaceRoot = await resolveDirectoryWithinRoot(String(body.workspaceRoot || ''), baseDir)
    sendJson(res, 200, await waitForProjectImages(workspaceRoot))
    return true
  }

  if (pathname === '/api/local/image/unload' && req.method === 'POST') {
    await stopImageGenerationServer()
    sendJson(res, 200, { ok: true })
    return true
  }

  return false
}
