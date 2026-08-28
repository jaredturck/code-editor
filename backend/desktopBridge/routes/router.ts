/** Minimal local bridge router for the coding IDE and autonomous coding runtime. */
import type { BridgeRequest, BridgeResponse, BridgeRouteHandler } from '../types.js'
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js'
import { handleCoreRoutes } from './coreRoutes.js'
import { handleFileRoutes } from './fileRoutes.js'
import { handlePersistenceRoutes } from './persistenceRoutes.js'
import { handleWebSkillRoutes } from './webSkillRoutes.js'
import { handleAgentRoutes } from './agentRoutes.js'
import { handlePowerRoutes } from './powerRoutes.js'
import { handleImageRoutes } from './imageRoutes.js'

export type { BridgeRequest, BridgeResponse } from '../types.js'

const ROUTE_HANDLERS: readonly BridgeRouteHandler[] = [
  handleCoreRoutes,
  handleFileRoutes,
  handlePersistenceRoutes,
  handleWebSkillRoutes,
  handleAgentRoutes,
  handleImageRoutes,
  handlePowerRoutes,
]

export async function handleBridgeRequest(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const pathname = requestUrl.pathname
  for (const handler of ROUTE_HANDLERS) {
    if (await handler(req, res, baseDir, requestUrl, pathname, securityContext)) return true
  }
  return false
}
