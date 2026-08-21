/**
 * Handles local bridge HTTP requests for core features. It parses and validates inputs,
 * delegates work to the focused service layer, and returns whether the route group consumed
 * the request.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js';
import {
  getSessionInfo,
  getSystemStats,
  getTopProcesses,
  readJsonBody,
  sendJson,
} from '../services/coreService.js';

/**
 * Processes core routes within the bridge route dispatch, including the side effects and
 * response expected by that boundary.
 */

export async function handleCoreRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/local/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, mode: 'desktop-local' });
    return true;
  }

  // system/stats and system/processes are intentionally ungated low-sensitivity telemetry
  // (CPU/memory and a truncated process list) that powers the System Monitor panel. They
  // expose no file contents, credentials, or environment, so the core group does not receive
  // the security context. Sensitive host reads (clipboard, environment) live in powerRoutes
  // and are gated there.
  if (pathname === '/api/local/system/stats' && (req.method === 'GET' || req.method === 'POST')) {
    const stats = await getSystemStats();
    sendJson(res, 200, { stats });
    return true;
  }

  if (pathname === '/api/local/system/processes' && req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const processes = await getTopProcesses(body?.limit);
    sendJson(res, 200, { processes });
    return true;
  }

  if (pathname === '/api/local/session' && req.method === 'GET') {
    const session = await getSessionInfo(baseDir);
    sendJson(res, 200, { session });
    return true;
  }

  return false;
}
