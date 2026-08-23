/**
 * Writes normalized JSON responses for bridge middleware requests. The helper keeps status,
 * headers, and serialization consistent while route modules focus on feature behavior.
 */

import type { BridgeResponse } from './types.js'
import { sendJson as sendRuntimeJson } from './services/bridgeServiceRuntime.js'

// Sends JSON through the protocol owned by the local bridge runtime.
export function sendJson(response: BridgeResponse, statusCode: number, payload: unknown): void {
  sendRuntimeJson(response, statusCode, payload)
}
