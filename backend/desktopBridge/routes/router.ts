/**
 * Dispatches each local bridge request to the feature route that owns its path. Route order
 * is kept explicit so overlapping prefixes resolve consistently in both development and
 * packaged execution.
 */

import type { BridgeRequest, BridgeResponse, BridgeRouteHandler } from '../types.js';
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js';
import { handleCoreRoutes } from './coreRoutes.js';
import { handleFileRoutes } from './fileRoutes.js';
import { handleAutomationAiRoutes } from './automationAiRoutes.js';
import { handlePersistenceRoutes } from './persistenceRoutes.js';
import { handleWebSkillRoutes } from './webSkillRoutes.js';
import { handleAgentRoutes } from './agentRoutes.js';
import { handlePowerRoutes } from './powerRoutes.js';
import { handleAudioRoutes } from './audioRoutes.js';

export type { BridgeRequest, BridgeResponse } from '../types.js';

// Order matters. Every group owns a distinct second path segment EXCEPT `/api/local/system/`,
// which is split: coreRoutes owns `/system/stats` and `/system/processes` (matched here first),
// while powerRoutes owns `/system/open-file-dialog` (matched later). This works only because
// every `/system/*` handler uses an exact `pathname ===` match. If a future edit gives core a
// `startsWith('/api/local/system/')` matcher it would silently swallow power's dialog route —
// keep `/system/*` matches exact, or consolidate them into one group.
const ROUTE_HANDLERS: readonly BridgeRouteHandler[] = [
  handleCoreRoutes,
  handleFileRoutes,
  handleAutomationAiRoutes,
  handlePersistenceRoutes,
  handleWebSkillRoutes,
  handleAgentRoutes,
  handlePowerRoutes,
  handleAudioRoutes,
];

// Routes one local bridge request through the ordered route groups and reports whether any group
// handled it.
export async function handleBridgeRequest(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = requestUrl.pathname;

  for (const handler of ROUTE_HANDLERS) {
    if (await handler(req, res, baseDir, requestUrl, pathname, securityContext)) return true;
  }

  return false;
}
