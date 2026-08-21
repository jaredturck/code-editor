/**
 * Defines the request, response, runtime-state, agent, training, and persisted-skill
 * contracts shared across bridge routes and services. These types describe the bridge
 * boundary; they do not themselves authorize an operation.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeSecurityContext } from './shared/bridgeAuthorization.js';

export type BridgeRequest = IncomingMessage & {
  url?: string;
  method?: string;
};

export type BridgeResponse = ServerResponse;

export type BridgeRouteHandler = (
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
) => Promise<boolean>;

export type AgentRole =
  | 'orchestrator'
  | 'executor'
  | 'scout'
  | 'claude'
  | 'deepseek'
  | 'local'
  | 'openai'
  | 'gemini'
  | 'unknown';

export interface SkillProvenance {
  source: string;
  sourceLabel?: string;
  proposalId?: string;
  provider?: string;
  model?: string;
  receivedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface TrainingSkillProposal {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  skill: Record<string, unknown>;
  profiles: string[];
  provenance: SkillProvenance;
  receivedAt: number;
}
