/**
 * Executes a short, bounded role task through IRIS's configured model mesh.
 *
 * This is the shared local-first path for feature work that needs one or two model calls but
 * does not need the full conversational agent loop. It reuses role assignments, ability tags,
 * key slots, model-health failover, and the normal provider adapters. Cloud candidates are never
 * selected unless the caller explicitly enables and approves them.
 */

import { callAIWithMeta } from '@/platform/aiService';
import { getKey } from '@/platform/keyStore';
import { buildAgentRoster, type RosterMember } from '@/platform/agent/modelTags';
import { isModelHealthy, recordModelFailure, recordModelSuccess } from '@/platform/agent/modelHealth';
import type { AgentRoleId } from '@/platform/agent/agentIdentity';
import type { AIMessage } from '@/platform/providers/types';
import type { ProviderMeta } from '@/platform/agent/types';

export interface BoundedRoleTaskOptions {
  settings: Record<string, any>;
  messages: readonly AIMessage[];
  preferredRoles?: readonly AgentRoleId[];
  requiredTags?: readonly string[];
  /** Cloud is opt-in and still requires cloudApproved=true. */
  allowCloud?: boolean;
  cloudApproved?: boolean;
  maxAttempts?: number;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  extendedThinking?: boolean;
  signal?: AbortSignal;
  taskLabel?: string;
  onToken?: (token: string) => void;
  onTokenReset?: () => void;
  onThinkingToken?: (token: string) => void;
  onThinkingReset?: () => void;
  onModelSelected?: (model: {
    role: AgentRoleId;
    provider: string;
    model: string;
    attempt: number;
    maxAttempts: number;
  }) => void;
  onAttemptFailed?: (model: {
    role: AgentRoleId;
    provider: string;
    model: string;
    attempt: number;
    maxAttempts: number;
    error: string;
  }) => void;
}

export interface BoundedRoleTaskResult {
  text: string;
  meta: ProviderMeta;
  role: AgentRoleId;
  provider: string;
  model: string;
  keyId: string;
  local: boolean;
  attempts: number;
}

function normalizedTags(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );
}

function roleRank(role: AgentRoleId, preferredRoles: readonly AgentRoleId[]): number {
  const index = preferredRoles.indexOf(role);
  return index < 0 ? preferredRoles.length + 1 : index;
}

function candidateSettings(
  settings: Record<string, any>,
  candidate: RosterMember,
  options: BoundedRoleTaskOptions,
): Record<string, any> {
  return {
    ...settings,
    ai_provider: candidate.provider,
    ai_model: candidate.model,
    ai_runtime_api_key:
      candidate.provider === 'local' ? '' : getKey(candidate.provider, candidate.keyId || '1'),
    agent_primary_locked: true,
    agent_model_routing: 'off',
    agent_failover_mode: 'off',
    agent_max_output_tokens: options.maxOutputTokens ?? settings.agent_max_output_tokens,
    reasoning_effort: options.reasoningEffort ?? 'low',
    extended_thinking: options.extendedThinking ?? false,
  };
}

function selectCandidates(options: BoundedRoleTaskOptions): RosterMember[] {
  const preferredRoles = options.preferredRoles?.length
    ? [...options.preferredRoles]
    : (['scout', 'orchestrator', 'executor', 'overwatcher'] as AgentRoleId[]);
  const requiredTags = normalizedTags(options.requiredTags);
  const cloudAllowed = options.allowCloud === true && options.cloudApproved === true;

  const roster = buildAgentRoster(options.settings)
    .filter((member) => Boolean(member.provider && member.model))
    .filter((member) => isModelHealthy(member.provider, member.model, member.keyId))
    .filter((member) => requiredTags.every((tag) => member.tags.includes(tag)))
    .filter((member) => member.provider === 'local' || cloudAllowed);

  roster.sort(
    (left, right) =>
      Number(right.provider === 'local') - Number(left.provider === 'local') ||
      roleRank(left.role, preferredRoles) - roleRank(right.role, preferredRoles) ||
      Number(right.primary) - Number(left.primary) ||
      right.tags.length - left.tags.length,
  );

  // A newly configured local-only install can temporarily have no role cards yet.
  // Preserve local operation without reviving any retired role-settings reader.
  if (
    !roster.length &&
    String(options.settings.ai_provider || '').toLowerCase() === 'local' &&
    String(options.settings.ai_model || '').trim() &&
    requiredTags.every((tag) => tag !== 'vision')
  ) {
    roster.push({
      id: 'scout',
      role: 'scout',
      primary: true,
      provider: 'local',
      model: String(options.settings.ai_model),
      keyId: '1',
      tags: ['local', 'general'],
      tier: 1,
      costTier: 'cheap',
    });
  }

  return roster;
}

function isRateLimitError(error: unknown): boolean {
  return /rate.?limit|429|too many requests|quota|overloaded|insufficient balance/i.test(
    error instanceof Error ? error.message : String(error || ''),
  );
}

/** Run one short model task with local-first role selection and bounded failover. */
export async function runBoundedRoleTask(
  options: BoundedRoleTaskOptions,
): Promise<BoundedRoleTaskResult> {
  const candidates = selectCandidates(options);
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, candidates.length || 1));
  const errors: string[] = [];

  for (let index = 0; index < candidates.length && index < maxAttempts; index += 1) {
    if (options.signal?.aborted) {
      const error = new Error('Operation cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const candidate = candidates[index];
    let emittedText = false;
    let emittedThinking = false;
    options.onModelSelected?.({
      role: candidate.role,
      provider: candidate.provider,
      model: candidate.model,
      attempt: index + 1,
      maxAttempts,
    });
    try {
      const meta = await callAIWithMeta(
        options.messages,
        candidateSettings(options.settings, candidate, options),
        {
          signal: options.signal,
          onToken: options.onToken
            ? (token) => {
                emittedText = true;
                options.onToken?.(token);
              }
            : undefined,
          onThinkingToken: options.onThinkingToken
            ? (token) => {
                emittedThinking = true;
                options.onThinkingToken?.(token);
              }
            : undefined,
        },
      );
      recordModelSuccess(candidate.provider, candidate.model, candidate.keyId);
      return {
        text: String(meta?.text || '').trim(),
        meta,
        role: candidate.role,
        provider: candidate.provider,
        model: candidate.model,
        keyId: candidate.keyId || '1',
        local: candidate.provider === 'local',
        attempts: index + 1,
      };
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
      errors.push(`${candidate.provider}/${candidate.model}: ${message}`);
      options.onAttemptFailed?.({
        role: candidate.role,
        provider: candidate.provider,
        model: candidate.model,
        attempt: index + 1,
        maxAttempts,
        error: message,
      });
      if (
        (emittedText || emittedThinking) &&
        index + 1 < Math.min(candidates.length, maxAttempts)
      ) {
        options.onTokenReset?.();
        options.onThinkingReset?.();
      }
      recordModelFailure(candidate.provider, candidate.model, candidate.keyId, {
        error: message,
        rateLimited: isRateLimitError(error),
      });
    }
  }

  const required = normalizedTags(options.requiredTags);
  const requirementText = required.length ? ` with ${required.join(', ')} capability` : '';
  const cloudText =
    options.allowCloud && !options.cloudApproved
      ? ' Cloud fallback was not approved.'
      : options.allowCloud
        ? ''
        : ' Cloud fallback is disabled for this task.';
  const detail = errors.length ? ` ${errors.join(' | ')}` : '';
  throw new Error(
    `No healthy configured local model${requirementText} could complete ${options.taskLabel || 'this task'}.${cloudText}${detail}`,
  );
}
