/**
 * Shared contracts for the in-process executor/scout runtime and the orchestrator-facing
 * client. Keeping task, result, event, registry, and lifecycle shapes here prevents the
 * two modules from duplicating or widening the same protocol independently.
 */

import type { AISettings } from '@/platform/providers/types'
import type { AgentIdentity } from '@/platform/agent/agentIdentity'
import type { AgentTaskStatus, AgentWorkerStatus } from '@/platform/agent/agentBusShared'

export interface SubAgentSettings extends AISettings {
  native_tools_enabled?: boolean
  permissions_file_read?: boolean
  permissions_file_write?: boolean
  permissions_terminal?: boolean
  agent_safety_profile?: string
  agent_block_sudo?: boolean
  agent_allow_network_commands?: boolean
  agent_permission_tier?: number
  agent_permission_tier_orchestrator?: number
  agent_permission_tier_executor?: number
  agent_permission_tier_scout?: number
}

export interface SubAgentHealth {
  successRate: number
  consecutiveFailures: number
  suspended: boolean
}

export interface SubAgentRegistryEntry {
  status: AgentWorkerStatus
  currentTaskId: string | null
  lastSeen: number
  capabilities: string[]
  health: SubAgentHealth
}

export interface SubAgentRosterEntry {
  id: string
  role?: string
  status: AgentWorkerStatus | 'offline'
  currentTaskId: string | null
  lastSeen: number
  lastSeenSec: number
  queueDepth: number
  health: SubAgentHealth
}

export interface SubAgentTaskResult {
  taskId: string
  agentId: string
  status: AgentTaskStatus
  result: unknown
  toolsUsed: string[]
  stepsUsed: number
  stepBudget?: number
  tokensUsed: number
  satisfactionHint: string
  durationMs: number
  completedAt: number
  outputPath?: string
  outputChars?: number
}

export interface SubAgentLoopHandle {
  stop(): void
}

export interface SubAgentEvent extends Record<string, unknown> {
  type: string
  source?: 'subagent'
  at?: number
  agentId?: string
  role?: string
  taskId?: string
  status?: string
  outputPath?: string
  summary?: string
  tool?: string
  argsPreview?: string
  outputPreview?: string
  durationMs?: number
  step?: number
}

export type SubAgentEventListener = (event: SubAgentEvent) => void
export type SubAgentEventEmitter = (event: SubAgentEvent) => void
export type SubAgentTaskWaiter = (result: SubAgentTaskResult) => void

export interface ExplicitStepResult {
  order: number
  action: string
  ok: boolean
  result?: string
  error?: string
  fallback?: string
}

export interface ExecuteSTPResult extends SubAgentTaskResult {}

export interface DelegationEvaluation {
  satisfied: boolean
  reason?: string
  warning?: string
}

export interface DelegateArgs extends Record<string, unknown> {
  toAgent?: unknown
  type?: unknown
  instructions?: unknown
  goal?: unknown
  scope?: unknown
  constraints?: unknown
  tools?: unknown
  preferredTools?: unknown
  forbiddenTools?: unknown
  outputSchema?: unknown
  context?: unknown
  skills?: unknown
  maxSteps?: unknown
  timeoutMs?: unknown
  maxOutputChars?: unknown
  priority?: unknown
  waitForIdle?: unknown
}

export interface RecallArgs extends Record<string, unknown> {
  taskId?: unknown
  waitMs?: unknown
}

export interface StatusArgs extends Record<string, unknown> {
  taskId?: unknown
}

export interface BroadcastArgs extends Record<string, unknown> {
  message?: unknown
  contextUpdate?: unknown
}

export interface VerifyArgs extends Record<string, unknown> {
  taskId?: unknown
  criteria?: unknown
  fallbackAction?: unknown
}

export interface DelegateTarget {
  agentId: string
  role: string
  provider: string
  model: string
  identity: AgentIdentity
  subSettings: SubAgentSettings
}

export interface DelegateResult {
  taskId: string
  toAgent: string
  /** The model behind the resolved member, so the UI can show "executor#2 (model)". */
  model?: string
  summary: string
  status: 'posted'
  postedAt: number
}

export interface RecallResult {
  taskId: string
  status: AgentTaskStatus | 'unknown'
  result: unknown
  toolsUsed: string[]
  stepsUsed: number
  tokensUsed: number
  satisfactionHint: string
  durationMs: number
  ready?: boolean
}

export interface VerifyResult {
  taskId: string
  verdict: 'not_ready' | 'pass' | 'fail'
  message?: string
  reason?: string
  warning?: string | null
  criteria?: string
  result?: unknown
  satisfactionHint?: string
}

export interface OrchestrationModeResult {
  mode: 'full' | 'dual' | 'solo'
  available: string[]
  offline: string[]
}
