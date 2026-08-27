/** Core bridge routes required by the coding runtime. */
import type { BridgeRequest, BridgeResponse } from '../types.js'
import { getSessionInfo, sendJson } from '../services/coreService.js'

export async function handleCoreRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/local/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, mode: 'local-agentic-coding' })
    return true
  }
  if (pathname === '/api/local/session' && req.method === 'GET') {
    sendJson(res, 200, { session: await getSessionInfo(baseDir) })
    return true
  }
  return false
}
