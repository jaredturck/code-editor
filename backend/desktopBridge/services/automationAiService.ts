/** Feature service surface for the corresponding desktop bridge routes. */
import type { BridgeResponse } from '../types.js';
import * as runtime from './bridgeServiceRuntime.js';

export const discoverLocalAIServers = runtime.discoverLocalAIServers;
export const getLocalModelInputCapabilities = runtime.getLocalModelInputCapabilities;
export const getRemoteModelInputCapabilities = runtime.getRemoteModelInputCapabilities;
export const pullLocalOllamaModel = runtime.pullLocalOllamaModel;
export const startLocalOllamaModelPull = runtime.startLocalOllamaModelPull;
export const getLocalOllamaModelPull = runtime.getLocalOllamaModelPull;
export const cancelLocalOllamaModelPull = runtime.cancelLocalOllamaModelPull;
export const getAutomationCapabilities = runtime.getAutomationCapabilities;
export const readJsonBody = runtime.readJsonBody;
export const resolvePath = runtime.resolvePath;
export const sendJson = runtime.sendJson;

export const executeAutomationActions = runtime.executeAutomationActions as (
  actions: unknown[],
  options?: { dryRun?: boolean; cwd?: string; allowMouseControl?: boolean },
) => Promise<unknown>;

export const proxyRemoteRequest = runtime.proxyRemoteRequest as (request: {
  url: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
  timeoutMs?: unknown;
  provider?: unknown;
}) => Promise<unknown>;

export const proxyRemoteStream = runtime.proxyRemoteStream as (
  request: Record<string, unknown>,
  response: BridgeResponse,
) => Promise<void>;
