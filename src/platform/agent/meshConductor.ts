import { readAgentModels } from '@/platform/agent/agentIdentity';

/**
 * Session conductor for the tagged model mesh.
 *
 * The mesh remains flexible enough for substantial collaboration, but it keeps independent
 * emergency brakes for total consultations, recursion depth, and repeated calls to one peer. These
 * limits protect users from accidental model loops and unexpected remote-provider spend.
 */

export const DEFAULT_MAX_PEER_CONSULTS = 40;
export const DEFAULT_MAX_CONSULT_DEPTH = 10;
export const DEFAULT_MAX_PEER_REPEATS = 6;
export const HARD_MAX_PEER_CONSULTS = 100;
export const HARD_MAX_CONSULT_DEPTH = 16;
export const HARD_MAX_PEER_REPEATS = 12;

export interface MeshBudget {
  enabled: boolean;
  maxConsults: number;
  maxDepth: number;
  maxPerPeer: number;
}

export interface ConsultGateResult {
  ok: boolean;
  reason?: 'disabled' | 'cycle' | 'budget_exhausted' | 'depth_exceeded' | 'peer_repeat_exhausted';
  message?: string;
}

export interface MeshLedgerSnapshot {
  enabled: boolean;
  consultsUsed: number;
  maxConsults: number;
  maxDepth: number;
  maxPerPeer: number;
  visited: string[];
  peerConsults: Record<string, number>;
}

export interface MeshConductor {
  readonly budget: MeshBudget;
  consultsUsed: number;
  canConsult(peerRole: string, depth?: number): ConsultGateResult;
  recordConsult(peerRole: string): void;
  raiseConsultCap(extra: number): number;
  isVisited(role: string): boolean;
  snapshot(): MeshLedgerSnapshot;
}

interface MeshSettingsLike {
  agent_multi_enabled?: unknown;
  agent_peer_consult_enabled?: unknown;
  agent_consult_max?: unknown;
  agent_consult_depth?: unknown;
  agent_consult_peer_repeat_max?: unknown;
  [key: string]: unknown;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function isMeshEnabled(settings: MeshSettingsLike | null | undefined): boolean {
  if (settings?.agent_multi_enabled !== true) return false;
  return settings?.agent_peer_consult_enabled !== false;
}

export function peerReviewMode(
  settings: (MeshSettingsLike & { agent_peer_review?: unknown }) | null | undefined,
): 'off' | 'suggested' | 'always' {
  if (settings?.agent_multi_enabled !== true) return 'off';
  const mode = String(settings?.agent_peer_review || 'off').toLowerCase();
  return mode === 'always' ? 'always' : mode === 'suggested' ? 'suggested' : 'off';
}

export function isPeerReviewEnabled(
  settings: (MeshSettingsLike & { agent_peer_review?: unknown }) | null | undefined,
): boolean {
  return peerReviewMode(settings) !== 'off';
}

export function isOverwatchEnabled(
  settings: (MeshSettingsLike & { agent_models?: unknown }) | null | undefined,
): boolean {
  if (settings?.agent_multi_enabled !== true) return false;
  return readAgentModels(settings as Parameters<typeof readAgentModels>[0]).some(
    (entry) => entry.role === 'overwatcher' && Boolean(entry.provider),
  );
}

export function createMeshConductor(
  settings: MeshSettingsLike | null | undefined,
  currentRole = 'orchestrator',
): MeshConductor {
  const budget: MeshBudget = {
    enabled: isMeshEnabled(settings),
    maxConsults: boundedInteger(
      settings?.agent_consult_max,
      DEFAULT_MAX_PEER_CONSULTS,
      0,
      HARD_MAX_PEER_CONSULTS,
    ),
    maxDepth: boundedInteger(
      settings?.agent_consult_depth,
      DEFAULT_MAX_CONSULT_DEPTH,
      1,
      HARD_MAX_CONSULT_DEPTH,
    ),
    maxPerPeer: boundedInteger(
      settings?.agent_consult_peer_repeat_max,
      DEFAULT_MAX_PEER_REPEATS,
      1,
      HARD_MAX_PEER_REPEATS,
    ),
  };
  const self = String(currentRole || '')
    .trim()
    .toLowerCase();
  const visited = new Set<string>([self]);
  const peerConsults = new Map<string, number>();

  const conductor: MeshConductor = {
    budget,
    consultsUsed: 0,

    canConsult(peerRole: string, depth = 1): ConsultGateResult {
      if (!budget.enabled) {
        return {
          ok: false,
          reason: 'disabled',
          message:
            'Peer consultation is off. Enable the agent communication bridge in Settings → Agents.',
        };
      }
      if (conductor.consultsUsed >= budget.maxConsults) {
        return {
          ok: false,
          reason: 'budget_exhausted',
          message: `Peer consultation safety limit reached (${budget.maxConsults} per task).`,
        };
      }
      if (Math.max(1, Math.round(Number(depth) || 1)) > budget.maxDepth) {
        return {
          ok: false,
          reason: 'depth_exceeded',
          message: `Peer consultation depth limit reached (${budget.maxDepth}).`,
        };
      }
      const role = String(peerRole || '')
        .trim()
        .toLowerCase();
      if (role && role === self) {
        return {
          ok: false,
          reason: 'cycle',
          message: `A model can't consult itself — consult a different peer or decide yourself.`,
        };
      }
      if ((peerConsults.get(role) || 0) >= budget.maxPerPeer) {
        return {
          ok: false,
          reason: 'peer_repeat_exhausted',
          message: `Repeated consultation limit reached for ${role || 'this peer'} (${budget.maxPerPeer}).`,
        };
      }
      return { ok: true };
    },

    recordConsult(peerRole: string): void {
      const role = String(peerRole || '')
        .trim()
        .toLowerCase();
      conductor.consultsUsed += 1;
      if (role) {
        visited.add(role);
        peerConsults.set(role, (peerConsults.get(role) || 0) + 1);
      }
    },

    raiseConsultCap(extra: number): number {
      budget.maxConsults = Math.min(
        HARD_MAX_PEER_CONSULTS,
        budget.maxConsults + Math.max(0, Math.round(Number(extra) || 0)),
      );
      return budget.maxConsults;
    },

    isVisited(role: string): boolean {
      return visited.has(
        String(role || '')
          .trim()
          .toLowerCase(),
      );
    },

    snapshot(): MeshLedgerSnapshot {
      return {
        enabled: budget.enabled,
        consultsUsed: conductor.consultsUsed,
        maxConsults: budget.maxConsults,
        maxDepth: budget.maxDepth,
        maxPerPeer: budget.maxPerPeer,
        visited: Array.from(visited),
        peerConsults: Object.fromEntries(peerConsults.entries()),
      };
    },
  };

  return conductor;
}
