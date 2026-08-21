/**
 * Defines the message, artifact, timeline, approval, question, and controller state used
 * across the Chat panel. These types describe the presentation contract around an agent run
 * without duplicating the runtime's provider-specific structures.
 */

import type { Dispatch, SetStateAction } from 'react';

export type ChatRole = 'user' | 'assistant' | 'system' | string;
export type UnknownRecord = Record<string, any>;

export interface ChatMessage {
  role: ChatRole;
  content: string;
  meta?: UnknownRecord;
  _injected?: boolean;
}

export interface TimelineEventData extends UnknownRecord {
  id?: string | number;
  type?: string;
  source?: string;
  subAgentRole?: string;
  role?: string;
  summary?: string;
  body?: string;
  durationMs?: number;
  tool?: string;
  module?: string;
  argsPreview?: string;
  outputPreview?: string;
  status?: string;
  step?: string | number;
  at?: number;
  timeoutMs?: number;
  op?: string;
  text?: string;
  name?: string;
  // Multi-model transparency (Workstream D): event-level model attribution.
  roleLabel?: string;
  agentColor?: string;
  agentTags?: string[];
  // The MEMBER id (executor#2, …) + the actual model that produced a sub-agent event.
  agentId?: string;
  model?: string;
  level?: string;
  // File-write green/red diff (Workstream D QoL): a real pre→post unified diff + counts.
  diff?: string;
  added?: number;
  removed?: number;
  provider?: string;
  purpose?: string;
  reason?: string;
  requestNumber?: number;
  requestLimit?: number;
}

export interface ToolGroupItem extends UnknownRecord {
  id: string;
  tool?: string;
  module?: string;
  argsPreview?: string;
  step?: string | number;
  result?: TimelineEventData | null;
}

// A single row in the flat inline event timeline (chat + Agent Console share this).
// Replaces the old grouped bubbles: thinking, tool calls, notices, and phases are all
// rendered as connected rows on a vertical rail rather than collapsed disclosures.
// `blocked` is a guard/policy/config failure surfaced as a red warning node (these used to
// arrive mistyped as `thinking`).
export type EventRowKind =
  | 'thinking'
  | 'tool'
  | 'notice'
  | 'phase'
  | 'todo'
  | 'skill'
  | 'step'
  | 'blocked';

export interface EventRowData extends UnknownRecord {
  id: string;
  kind: EventRowKind;
  at?: number;
  // Per-model attribution. `source === 'subagent'` is shown once on the segment's colored
  // title (the model is labeled there) — individual rows no longer carry color lanes.
  source?: string;
  model?: string;
  role?: string;
  roleLabel?: string;
  agentColor?: string;
  agentTags?: string[];
  // thinking
  text?: string; // markdown body
  summary?: string;
  durationMs?: number;
  // tool (carries the paired call + result)
  tool?: ToolGroupItem;
  // notice / phase / blocked / generic
  level?: string;
  status?: string;
  title?: string;
  body?: string;
  // Coalescing: consecutive identical rows fold into one with a ×N repeat badge.
  repeat?: number;
}

// ── Thought-grouped timeline model ────────────────────────────────────────────────
// Rows are reorganized around how a model actually works: a live thought, then the tool
// calls/actions taken while still under that thought (collapsible to a one-liner). Items not
// under any thought (skill reads, notices, phases) render on the segment's main line.
export interface ThoughtGroup {
  kind: 'thought';
  id: string;
  thoughtRow: EventRowData; // the thinking row (full markdown lives in .text)
  summary: string; // first clause of the thought + '…'
  durationMs?: number;
  children: EventRowData[]; // tool/blocked rows nested under this thought
  status: 'working' | 'done' | 'error';
}

// A block is either a collapsible thought (with nested actions) or a standalone main-line row.
export type TimelineBlock = ThoughtGroup | { kind: 'row'; id: string; row: EventRowData };

// One producer's contiguous run of activity. Sub-agent segments render a colored title once
// (role · model · tags); the main agent segment is headerless.
export interface AgentSegment {
  id: string;
  source: 'main' | 'subagent' | 'steering';
  agentKey: string;
  model?: string;
  role?: string;
  roleLabel?: string;
  agentColor?: string;
  agentTags?: string[];
  status: 'working' | 'done' | 'error';
  blocks: TimelineBlock[];
}

export interface SubAgentActivityGroup {
  // The MEMBER id the activity ran as (executor, executor#2, …) — one card per model, not per role.
  memberId: string;
  role: string;
  // The actual model that produced this activity + its ability tags, shown on the card.
  model: string;
  tags: string[];
  // 'error' paints the card red and keeps it collapsed; 'working' shows the live spinner.
  status: 'working' | 'done' | 'error';
  thinkingText: string;
  thinkingSummary: string;
  toolItems: ToolGroupItem[];
}

export interface ApprovalOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

export interface ApprovalRequest extends UnknownRecord {
  id: string;
  requestType?: string;
  reason?: string;
  options?: ApprovalOption[];
  question?: string;
  questionOptions?: string[];
  allowOther?: boolean;
  recommendedDecision?: string;
  permissionKeys?: string[];
  persistentPermission?: boolean;
  createdAt?: number;
  expiresAt?: number;
}

export interface ApprovalResolution extends UnknownRecord {
  approved: boolean;
  decision: string;
  answer?: string;
  stopped?: boolean;
}

export type ApprovalResolver = (resolution: ApprovalResolution) => void;

export interface ChatSettings extends UnknownRecord {
  ai_provider?: string;
  ai_model?: string;
  agent_replay_enabled?: boolean;
  agent_replay_max_runs?: number;
  chat_auto_title?: boolean;
  chat_persistence_enabled?: boolean;
}

export interface SlashCommandParameterOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SlashCommandParameter {
  name: string;
  label: string;
  options?: SlashCommandParameterOption[];
  freeform?: boolean;
  placeholder?: string;
}

export interface ChatScrollController {
  stickToBottom: boolean;
  setStickToBottom: Dispatch<SetStateAction<boolean>>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  handleMessagesScroll(): void;
  handleMessagesWheel(event: React.WheelEvent<HTMLDivElement>): void;
  markManualScrollIntent(): void;
  scrollToBottom(): void;
}
