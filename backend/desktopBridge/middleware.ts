/**
 * Creates the shared middleware form used by route-level tests and compatibility harnesses. Desktop development uses the standalone Electron-owned bridge.
 * It constructs one shared runtime state object and sends every request through the same
 * router used by the packaged server.
 */

import type { Connect } from 'vite'
import { normalizeBridgeError } from './errors.js'
import { handleBridgeRequest } from './routes/router.js'
import { isLocalBridgeRequest } from './services/bridgeServiceRuntime.js'
import { sendJson } from './response.js'
import type { BridgeRequest, BridgeResponse } from './types.js'
import { DEVELOPMENT_BRIDGE_PERMISSIONS } from './shared/bridgeAuthorization.js'

// Creates desktop bridge middleware with the state and dependencies needed by its consumers.
export function createDesktopBridgeMiddleware(baseDir: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const req = request as BridgeRequest
    const res = response as BridgeResponse

    if (!req.url || !req.url.startsWith('/api/local/')) {
      next()
      return
    }

    if (!isLocalBridgeRequest(req)) {
      sendJson(res, 403, { error: 'Forbidden: local bridge only accepts loopback requests.' })
      return
    }

    try {
      const handled = await handleBridgeRequest(req, res, baseDir, {
        permissions: { ...DEVELOPMENT_BRIDGE_PERMISSIONS },
      })
      if (!handled) next()
    } catch (error: unknown) {
      const normalized = normalizeBridgeError(error)
      sendJson(res, normalized.statusCode, { error: normalized.message })
    }
  }
}
