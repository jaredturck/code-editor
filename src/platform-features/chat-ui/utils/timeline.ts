/**
 * Maps raw agent events, tool names, todo states, and metrics to the labels, icons, and
 * styles used by the activity timeline. Keeping this interpretation centralized ensures
 * every timeline view explains the same execution record consistently.
 */

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Circle,
  Cloud,
  FilePen,
  FileText,
  FolderOpen,
  ListTodo,
  Loader2,
  Monitor,
  Rocket,
  Search as SearchIcon,
  Sparkles,
  SquareTerminal,
  StickyNote,
  Terminal,
  Wrench,
} from 'lucide-react';
import { getToolPresentation } from '@/platform/agent/toolCatalog';
import { stripTerminalControlCharacters } from '@/platform/security';
import type {
  AgentSegment,
  EventRowData,
  ThoughtGroup,
  TimelineEventData,
  ToolGroupItem,
} from '../types';

const TOOL_ICON_COMPONENTS = {
  files: FolderOpen,
  terminal: Terminal,
  notes: StickyNote,
  screen: Monitor,
  search: SearchIcon,
  launch: Rocket,
  todo: ListTodo,
  trace: Brain,
  command: SquareTerminal,
  edit: FilePen,
  fileText: FileText,
  tool: Wrench,
} as const;

// Returns tool icon without requiring callers to know where or how it is stored.
export function getToolIcon(toolName: unknown) {
  const presentation = getToolPresentation(String(toolName || ''));
  return (
    TOOL_ICON_COMPONENTS[presentation.moduleIcon as keyof typeof TOOL_ICON_COMPONENTS] || Wrench
  );
}

// Returns todo status icon without requiring callers to know where or how it is stored.
export function getTodoStatusIcon(status: unknown) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'done') return CheckCircle2;
  if (normalized === 'blocked') return AlertTriangle;
  if (normalized === 'in_progress') return Loader2;
  return Circle;
}

// Returns todo status color without requiring callers to know where or how it is stored.
export function getTodoStatusColor(status: unknown): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'done') return '#4ADE80';
  if (normalized === 'blocked') return '#F87171';
  if (normalized === 'in_progress') return '#60A5FA';
  return 'rgba(180,200,235,0.8)';
}

// Returns event styles without requiring callers to know where or how it is stored.
export function getEventStyles(event: TimelineEventData) {
  if (event.type === 'phase')
    return {
      bg: 'rgba(167,139,250,0.11)',
      border: 'rgba(167,139,250,0.24)',
      color: 'var(--app-text-strong)',
    };
  if (event.type === 'notice')
    return event.level === 'error'
      ? {
          bg: 'rgba(248,113,113,0.12)',
          border: 'rgba(239,68,68,0.36)',
          color: 'rgba(254,202,202,0.97)',
        }
      : {
          bg: 'rgba(251,191,36,0.1)',
          border: 'rgba(251,191,36,0.24)',
          color: 'rgba(254,240,179,0.95)',
        };
  if (event.type === 'cloud_request')
    return {
      bg: 'rgba(251,191,36,0.1)',
      border: 'rgba(251,191,36,0.3)',
      color: 'rgba(254,240,179,0.96)',
    };
  if (event.type === 'cloud_response')
    return event.status === 'error'
      ? {
          bg: 'var(--app-danger-soft)',
          border: 'rgba(248,113,113,0.28)',
          color: 'rgba(254,202,202,0.95)',
        }
      : {
          bg: 'rgba(251,191,36,0.07)',
          border: 'rgba(251,191,36,0.2)',
          color: 'rgba(253,230,138,0.86)',
        };
  if (event.type === 'thinking')
    return {
      bg: 'rgba(148,163,184,0.09)',
      border: 'rgba(148,163,184,0.22)',
      color: 'var(--app-text)',
    };
  if (event.type === 'tool_call')
    return {
      bg: 'rgba(96,165,250,0.11)',
      border: 'rgba(96,165,250,0.24)',
      color: 'var(--app-text)',
    };
  if (event.type === 'tool_result' && event.status === 'ok')
    return {
      bg: 'var(--app-success-soft)',
      border: 'rgba(74,222,128,0.25)',
      color: 'rgba(170,245,196,0.95)',
    };
  if (event.type === 'tool_result')
    return {
      bg: 'var(--app-danger-soft)',
      border: 'rgba(248,113,113,0.26)',
      color: 'rgba(254,202,202,0.95)',
    };
  return {
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.24)',
    color: 'rgba(254,240,179,0.95)',
  };
}

function parseEventArgs(event: TimelineEventData): Record<string, any> {
  if (event.args && typeof event.args === 'object') return event.args as Record<string, any>;
  try {
    const parsed = JSON.parse(String(event.argsPreview || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toolActionLabel(event: TimelineEventData): string {
  const tool = String(event.tool || 'tool');
  const args = parseEventArgs(event);
  const file = basename(args.path);
  if (tool === 'files.read') return `Read ${file || 'file'}`;
  if (tool === 'files.write' || tool === 'files.patch') return `Edit ${file || 'file'}`;
  if (tool === 'files.diff') return `Review changes${file ? ` in ${file}` : ''}`;
  if (tool === 'files.list') return `List ${file || 'files'}`;
  if (tool === 'files.find' || tool === 'search.ripgrep') return 'Search files';
  if (tool === 'rag.retrieve') return 'Search local index';
  if (tool === 'search.web') return 'Search the web';
  if (tool === 'web.fetch') return 'Read web page';
  if (tool.startsWith('terminal.')) return 'Run command';
  return getToolPresentation(tool).actionVerb || tool;
}

// Returns event label without requiring callers to know where or how it is stored.
export function getEventLabel(event: TimelineEventData): string {
  if (event.type === 'phase') return `Phase · ${event.name || 'session'}`;
  if (event.type === 'notice') return 'Notice';
  if (event.type === 'cloud_request') return `Cloud request · ${event.provider || 'provider'}`;
  if (event.type === 'cloud_response') return `Cloud response · ${event.provider || 'provider'}`;
  if (event.type === 'thinking')
    return event.source === 'local-planner' ? 'Planning locally' : 'Reasoning';
  if (event.type === 'todo') return 'Todo Update';
  if (event.type === 'tool_call') return toolActionLabel(event);
  if (event.type === 'tool_result')
    return event.status === 'ok'
      ? `${toolActionLabel(event)} complete`
      : `${toolActionLabel(event)} failed`;
  return 'Action';
}

// Returns event body without requiring callers to know where or how it is stored.
export function getEventBody(event: TimelineEventData): string {
  if (event.type === 'phase') return stripTerminalControlCharacters(event.summary || '');
  if (event.type === 'notice') return stripTerminalControlCharacters(event.summary || '');
  if (event.type === 'cloud_request')
    return stripTerminalControlCharacters(event.reason || event.summary || '');
  if (event.type === 'cloud_response') return stripTerminalControlCharacters(event.summary || '');
  if (event.type === 'thinking') return stripTerminalControlCharacters(event.summary || '');
  if (event.type === 'todo')
    return stripTerminalControlCharacters(`${event.op || 'update'}: ${event.text || ''}`);
  if (event.type === 'tool_call')
    return stripTerminalControlCharacters(event.argsPreview || 'No arguments');
  if (event.type === 'tool_result')
    return stripTerminalControlCharacters(event.outputPreview || 'No output');
  return '';
}

// Returns event primary icon without requiring callers to know where or how it is stored.
export function getEventPrimaryIcon(event: TimelineEventData) {
  if (event.type === 'phase') return Sparkles;
  if (event.type === 'notice') return AlertTriangle;
  if (event.type === 'cloud_request' || event.type === 'cloud_response') return Cloud;
  if (event.type === 'thinking') return Brain;
  if (event.type === 'todo') return ListTodo;
  if (event.type === 'tool_call' || event.type === 'tool_result') return getToolIcon(event.tool);
  return Wrench;
}

// Formats clock for stable display or serialization without changing its underlying meaning.
export function formatClock(timestamp: unknown): string {
  if (!Number.isFinite(Number(timestamp))) return '--:--:--';
  const value = new Date(Number(timestamp));
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = String(value.getMinutes()).padStart(2, '0');
  const ss = String(value.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Formats duration for stable display or serialization without changing its underlying meaning.
export function formatDuration(durationMs: unknown): string | null {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value / 1000)} s`;
}

// Returns the first displayable line from a larger timeline value.
function firstLine(text: unknown, max = 96): string {
  const line = stripTerminalControlCharacters(text).replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function stripRoleTag(text: unknown): string {
  return stripTerminalControlCharacters(text).replace(/^\[[^\]]+\]\s*/, '');
}

// Pulls the per-model attribution off a raw event so a flat row can render the model chip,
// ability tags, and pick its color lane. Main-agent events carry no model/agentColor and fall
// back to the type-based palette.
function rowAttribution(event: TimelineEventData) {
  return {
    source: event.source,
    model: event.source === 'subagent' ? String(event.model || '') : '',
    role: String(event.subAgentRole || event.role || ''),
    roleLabel: event.roleLabel ? String(event.roleLabel) : undefined,
    agentColor:
      typeof event.agentColor === 'string' && event.agentColor ? event.agentColor : undefined,
    agentTags: Array.isArray(event.agentTags) ? event.agentTags.slice(0, 4) : [],
  };
}

// Guard/policy/config failures that the runtime emits (some still arrive mistyped as
// `thinking`). A match becomes a red `blocked` node instead of a thinking row.
const BLOCK_PATTERN =
  /^(step \d+ error|task failed|.*\b(blocked|denied|not configured|no permission|permission|timed out|unauthorized|forbidden)\b)/i;

// Application-injected context: the session preamble (memory/skills/runtime lines, tagged
// `channel:'steering'`), the Overwatcher supervisor, and any steer injected into a model's
// prompt. Routed into the timeline's "Application steering" group; hidden unless Dev mode is on.
function isSteeringEvent(event: TimelineEventData): boolean {
  if (event.channel === 'steering') return true;
  if (String(event.subAgentRole || '').toLowerCase() === 'overwatcher') return true;
  const summary = String(event.summary || event.body || '');
  if (/\[overwatcher\b/i.test(summary)) return true;
  if (/\bsteer injected\b|steering on your input|steer — guidance/i.test(summary)) return true;
  return false;
}

// Strips the runtime's legacy "Step N error:" / "Step N " prefix so a blocked node leads with
// the actual error rather than a removed bookkeeping concept.
function stripStepPrefix(text: string): string {
  return text.replace(/^step\s+\d+\s+error:\s*/i, '').replace(/^step\s+\d+[:\s-]+/i, '');
}

/**
 * Flattens a message (or pending/run) timeline into the ordered rows rendered by EventTimeline.
 * Tool calls are paired with their results (per agent + tool) into a single row; thinking,
 * notices, phases, todos, and skill loads keep their emission order. Sub-agent rows keep their
 * model attribution so `groupEventRows` can title each delegate's segment once.
 *
 * `options.devMode` (default false) keeps Overwatcher + injected-steer events; otherwise they
 * are filtered out so the timeline shows only the agent's own work.
 */
export function buildMessageEventRows(
  timeline: TimelineEventData[] | undefined,
  options: { devMode?: boolean } = {},
): EventRowData[] {
  const list = Array.isArray(timeline) ? timeline : [];
  const devMode = options.devMode === true;
  const rows: EventRowData[] = [];
  // tool_call rows awaiting their tool_result, keyed by agent + tool so concurrent models don't
  // cross-pair.
  const pending = new Map<string, number[]>();
  // The `at` of the previous event, so a thinking row's duration ("Thought for Ns") can be
  // derived from the gap since the last activity when the runtime didn't stamp one.
  let prevAt: number | undefined;

  list.forEach((event, index) => {
    const type = String(event.type || '');
    const at = Number(event.at) || undefined;
    const gapMs = at && prevAt ? at - prevAt : undefined;
    if (at) prevAt = at;
    const rowId = String(event.id ?? `idx${index}`);

    // Application-injected context → one uniform plain row in the "Application steering" group.
    // Hidden entirely in non-dev mode; never misclassified as a thought or a blocked node.
    if (isSteeringEvent(event)) {
      if (!devMode) return;
      const text = stripTerminalControlCharacters(
        event.summary || event.body || event.content || event.name || '',
      );
      rows.push({
        id: `g${rowId}`,
        kind: 'notice',
        at,
        summary: firstLine(text, 200),
        level: event.level === 'error' ? 'error' : 'info',
        source: 'steering',
        roleLabel: 'Application steering',
      });
      return;
    }

    const attribution = rowAttribution(event);
    const agentKey = String(
      event.agentId ||
        event.subAgentRole ||
        event.role ||
        (event.source === 'subagent' ? 'sub' : 'main'),
    );

    if (type === 'thinking') {
      const text = stripRoleTag(event.summary || event.body || event.content);
      // A mistyped guard/config error → a red blocked node, not a thinking row.
      if (BLOCK_PATTERN.test(text)) {
        const errorText = stripStepPrefix(text);
        rows.push({
          id: `b${rowId}`,
          kind: 'blocked',
          at,
          title: 'Tool call blocked',
          body: errorText,
          summary: firstLine(errorText, 120),
          ...attribution,
        });
        return;
      }
      rows.push({
        id: `t${rowId}`,
        kind: 'thinking',
        at,
        text,
        summary: firstLine(text),
        durationMs: Number(event.durationMs) || gapMs || undefined,
        ...attribution,
      });
      return;
    }

    if (type === 'tool_call') {
      const idx = rows.length;
      rows.push({
        id: `c${rowId}`,
        kind: 'tool',
        at,
        tool: {
          id: `c${rowId}`,
          tool: String(event.tool || ''),
          module: event.module,
          argsPreview: event.argsPreview || '',
          step: event.step,
          result: null,
        },
        ...attribution,
      });
      const key = `${agentKey}|${event.tool}`;
      const queue = pending.get(key) || [];
      queue.push(idx);
      pending.set(key, queue);
      return;
    }

    if (type === 'tool_result') {
      const key = `${agentKey}|${event.tool}`;
      const queue = pending.get(key);
      if (queue?.length) {
        const idx = queue.shift() as number;
        if (rows[idx]?.tool) rows[idx].tool!.result = event;
        return;
      }
      // Orphan result (no matching call captured) — still surface it as a tool row.
      rows.push({
        id: `r${rowId}`,
        kind: 'tool',
        at,
        tool: {
          id: `r${rowId}`,
          tool: String(event.tool || ''),
          module: event.module,
          argsPreview: '',
          result: event,
        },
        ...attribution,
      });
      return;
    }

    if (type === 'notice') {
      const noticeText = stripTerminalControlCharacters(event.summary || '');
      // A guard/policy/config failure (now emitted as an error notice) becomes a blocked node.
      if (event.level === 'error' && BLOCK_PATTERN.test(noticeText)) {
        const errorText = stripStepPrefix(noticeText);
        rows.push({
          id: `b${rowId}`,
          kind: 'blocked',
          at,
          title: 'Tool call blocked',
          body: errorText,
          summary: firstLine(errorText, 120),
          ...attribution,
        });
        return;
      }
      rows.push({
        id: `n${rowId}`,
        kind: 'notice',
        at,
        summary: noticeText,
        level: event.level,
        ...attribution,
      });
      return;
    }

    if (type === 'phase') {
      rows.push({
        id: `p${rowId}`,
        kind: 'phase',
        at,
        title: String(event.name || 'session'),
        summary: stripTerminalControlCharacters(event.summary || ''),
        ...attribution,
      });
      return;
    }

    // todo / skill_load / anything else → a generic step row reusing the shared label/body helpers.
    rows.push({
      id: `s${rowId}`,
      kind: type === 'todo' ? 'todo' : type === 'skill_load' ? 'skill' : 'step',
      at,
      title: getEventOneLine(event),
      summary: getEventBody(event),
      ...attribution,
    });
  });

  return rows;
}

// The rail node color for a row. Declutter: only status carries color now — green ok, red
// fail/blocked, blue running, amber notice, indigo thinking. Agent identity is shown by the
// segment title color, not per-row lanes.
export function getEventNodeColor(row: EventRowData): string {
  if (row.kind === 'blocked') return '#F87171';
  if (row.kind === 'thinking') return '#818CF8';
  if (row.kind === 'tool') {
    const status = row.tool?.result?.status;
    if (status && status !== 'ok') return '#F87171';
    if (!row.tool?.result) return '#6C9EFF';
    return '#4ADE80';
  }
  if (row.kind === 'notice') return row.level === 'error' ? '#F87171' : '#FBBF24';
  if (row.kind === 'phase') return '#A78BFA';
  if (row.kind === 'skill') return '#34D399';
  return 'rgba(108,158,255,0.65)';
}

// The node's visual state drives its shape (filled dot / red X / warning / pulsing ring).
export function getEventNodeState(
  row: EventRowData,
): 'ok' | 'fail' | 'running' | 'think' | 'notice' | 'phase' | 'blocked' {
  if (row.kind === 'blocked') return 'blocked';
  if (row.kind === 'thinking') return 'think';
  if (row.kind === 'tool') {
    const status = row.tool?.result?.status;
    if (status && status !== 'ok') return 'fail';
    if (!row.tool?.result) return 'running';
    return 'ok';
  }
  if (row.kind === 'notice') return row.level === 'error' ? 'fail' : 'notice';
  if (row.kind === 'phase') return 'phase';
  return 'ok';
}

// A thought must last longer than this to group the actions taken under it; shorter "quick"
// thoughts stay as plain one-liners with their tools on the main timeline.
const THOUGHT_GROUP_MIN_MS = 12000;

// ── Thought grouping ───────────────────────────────────────────────────────────────
// Identity for segmenting: each sub-agent (by model/role) and the main agent get their own
// contiguous segment.
function rowAgentKey(row: EventRowData): string {
  if (row.source === 'steering') return 'steering';
  if (row.source === 'subagent') return `sub:${row.model || row.roleLabel || row.role || 'sub'}`;
  return 'main';
}

// Stable key for coalescing consecutive identical rows into one + a ×N badge.
function rowRepeatKey(row: EventRowData): string {
  if (row.kind === 'tool') {
    return `tool:${row.tool?.tool || ''}:${String(row.tool?.argsPreview || '').slice(0, 80)}`;
  }
  const text = row.text || row.summary || row.title || row.body || '';
  return `${row.kind}:${String(text).slice(0, 80)}`;
}

// First clause of a thought, for the collapsible one-liner. Derived from the existing thinking
// text (no model call, no extra tokens). Exported so the live-streaming thought reuses it.
export function thoughtSummary(text: unknown, max = 80): string {
  const clean = stripTerminalControlCharacters(text).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Thinking…';
  const sentence = clean.split(/(?<=[.!?])\s/)[0] || clean;
  const clipped = sentence.length > max ? sentence.slice(0, max).trim() : sentence;
  return clipped.length < clean.length ? `${clipped}…` : clipped;
}

// A row counts as an "action" that nests under the current thought; everything else
// (skill reads, notices, phases, todos) stays on the segment's main line.
function isThoughtChild(row: EventRowData): boolean {
  return row.kind === 'tool' || row.kind === 'blocked';
}

function thoughtStatus(children: EventRowData[]): ThoughtGroup['status'] {
  for (const child of children) {
    if (child.kind === 'blocked') return 'error';
    if (child.kind === 'tool' && child.tool?.result?.status && child.tool.result.status !== 'ok') {
      return 'error';
    }
  }
  return 'done';
}

/**
 * Reorganizes flat rows into agent segments of thought-groups + standalone rows. A `thinking`
 * row opens a collapsible group; the tool/blocked actions emitted under it nest as children
 * (consecutive duplicates coalesce to ×N). A new producer, or any non-action row, closes the
 * current thought. The result is what EventTimeline renders.
 */
export function groupEventRows(rows: EventRowData[]): AgentSegment[] {
  const list = Array.isArray(rows) ? rows : [];
  const segments: AgentSegment[] = [];
  let segment: AgentSegment | null = null;
  let thought: ThoughtGroup | null = null;

  const closeThought = (): void => {
    if (segment && thought) {
      thought.status = thoughtStatus(thought.children);
      if (thought.status === 'error') segment.status = 'error';
      segment.blocks.push(thought);
    }
    thought = null;
  };

  const pushStandalone = (row: EventRowData): void => {
    if (!segment) return;
    const last = segment.blocks[segment.blocks.length - 1];
    if (last && last.kind === 'row' && rowRepeatKey(last.row) === rowRepeatKey(row)) {
      last.row.repeat = (last.row.repeat || 1) + 1;
      return;
    }
    segment.blocks.push({ kind: 'row', id: row.id, row });
  };

  list.forEach((row, index) => {
    const key = rowAgentKey(row);
    if (!segment || segment.agentKey !== key) {
      closeThought();
      segment = {
        id: `seg${index}-${key}`,
        source:
          row.source === 'steering' ? 'steering' : row.source === 'subagent' ? 'subagent' : 'main',
        agentKey: key,
        model: row.model,
        role: row.role,
        roleLabel: row.roleLabel,
        agentColor: row.agentColor,
        agentTags: row.agentTags,
        status: 'done',
        blocks: [],
      };
      segments.push(segment);
    }

    if (row.kind === 'thinking') {
      closeThought();
      const group: ThoughtGroup = {
        kind: 'thought',
        id: `th${row.id}`,
        thoughtRow: row,
        summary: thoughtSummary(row.text || row.summary),
        durationMs: row.durationMs,
        children: [],
        status: 'working',
      };
      // Only a "deep" thought (lasting >12s) groups the actions taken under it. A quick thought
      // is a plain one-liner and the tools that follow render on the main timeline.
      if (Number(row.durationMs) > THOUGHT_GROUP_MIN_MS) {
        thought = group;
      } else {
        group.status = 'done';
        segment.blocks.push(group);
      }
      return;
    }

    if (thought && isThoughtChild(row)) {
      const last = thought.children[thought.children.length - 1];
      if (last && rowRepeatKey(last) === rowRepeatKey(row)) {
        last.repeat = (last.repeat || 1) + 1;
        return;
      }
      thought.children.push(row);
      return;
    }

    // Any non-action row (or an action with no open thought) closes the thought and lands on
    // the main line.
    closeThought();
    pushStandalone(row);
  });
  closeThought();

  // A segment whose last block is the live (still-open) thought reads as working.
  return segments;
}

// Interprets args and turns the source representation into structured application data.
function parseArgs(argsPreview: unknown): Record<string, any> {
  if (!argsPreview) return {};
  try {
    const value = JSON.parse(String(argsPreview));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

// Returns the final path segment used for compact timeline labels.
function basename(path: unknown): string {
  const value = String(path || '')
    .replace(/[\\]+/g, '/')
    .replace(/\/+$/, '');
  return value.split('/').pop() || value;
}

/**
 * Produces a concise human-readable description of tool item for the interface or logs.
 */

export function describeToolItem(item: ToolGroupItem) {
  const tool = String(item.tool || '');
  const args = parseArgs(item.argsPreview);
  const presentation = getToolPresentation(tool);
  const Icon =
    TOOL_ICON_COMPONENTS[presentation.icon as keyof typeof TOOL_ICON_COMPONENTS] || Wrench;

  if (presentation.kind === 'command') {
    const command = String(args.command || args.script || '').trim();
    return {
      icon: Icon,
      language: presentation.language,
      code: command || item.argsPreview,
      label: command
        ? firstLine(command, 64)
        : tool === 'launch.run'
          ? 'Launched a process'
          : 'Ran a command',
      badge: 'Script',
      kind: 'command',
    };
  }
  if (presentation.kind === 'edit') {
    const file = basename(args.path);
    return {
      icon: Icon,
      language: presentation.language,
      code: String(args.content ?? args.patch ?? item.argsPreview),
      label: `${presentation.actionVerb || 'Edited'} ${file || 'a file'}`,
      badge: file,
      kind: 'edit',
    };
  }
  if (presentation.kind === 'read') {
    const file = basename(args.path) || (args.query ? `"${firstLine(args.query, 28)}"` : '');
    return {
      icon: Icon,
      language: presentation.language,
      code: item.argsPreview,
      label: `${presentation.actionVerb || 'Read'} ${file || 'files'}`,
      badge: file || null,
      kind: 'read',
    };
  }
  if (presentation.kind === 'search') {
    return {
      icon: Icon,
      language: presentation.language,
      code: item.argsPreview,
      label: `Searched ${args.query ? `"${firstLine(args.query, 32)}"` : ''}`.trim(),
      badge: null,
      kind: 'search',
    };
  }
  return {
    icon: Icon,
    language: presentation.language,
    code: item.argsPreview,
    label: tool,
    badge: null,
    kind: 'other',
  };
}

// Summarizes added and removed lines for compact diff presentation.
export function diffStat(output: unknown): { add: number; del: number } | null {
  const text = stripTerminalControlCharacters(output);
  if (!/^[+-]/m.test(text)) return null;
  let add = 0;
  let del = 0;
  for (const line of text.split('\n')) {
    if (/^\+(?!\+\+)/.test(line)) add += 1;
    else if (/^-(?!--)/.test(line)) del += 1;
  }
  return add || del ? { add, del } : null;
}

/**
 * Finds web visualizer points within a larger input for later policy or presentation logic.
 */

export function extractWebVisualizerPoints(events: TimelineEventData[]) {
  const timeline = Array.isArray(events) ? events : [];
  const seen = new Set<string>();
  const points: Array<Record<string, any>> = [];

  timeline.forEach((event) => {
    const chart = event?.chart as Record<string, any> | undefined;
    const kind = String(chart?.kind || '').toLowerCase();
    if (!kind.startsWith('web-')) return;

    const label = String(chart?.label || '').trim() || 'Web source';
    const url = String(chart?.url || '').trim();
    const index = Number.isFinite(Number(chart?.index)) ? Number(chart?.index) : null;
    const total = Number.isFinite(Number(chart?.total)) ? Number(chart?.total) : null;
    const linesRead = Number.isFinite(Number(chart?.linesRead))
      ? Number(chart?.linesRead)
      : Number(chart?.value || 0);
    const charsRead = Number.isFinite(Number(chart?.charsRead)) ? Number(chart?.charsRead) : 0;
    const status = String(chart?.status || '').toLowerCase();

    const dedupeKey = `${index || 0}|${url || label}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    points.push({
      kind,
      label,
      url,
      index,
      total,
      linesRead,
      charsRead,
      status,
      at: Number(event?.at || Date.now()),
    });
  });

  return points;
}

// Returns event one line without requiring callers to know where or how it is stored.
export function getEventOneLine(event: TimelineEventData): string {
  const label = getEventLabel(event);
  if (event.type === 'cloud_request') {
    const request = Number(event.requestNumber || 0);
    const limit = Number(event.requestLimit || 0);
    return `${label}${event.model ? ` · ${event.model}` : ''}${request ? ` · request ${request}${limit ? `/${limit}` : ''}` : ''}`;
  }
  if (event.type === 'cloud_response') return `${label}${event.model ? ` · ${event.model}` : ''}`;
  if (event.type === 'notice') return firstLine(event.summary, 140) || label;
  if (event.type === 'tool_call') {
    const args = (event.args || {}) as Record<string, unknown>;
    const argSummary = Object.entries(args)
      .slice(0, 2)
      .map(([, value]) => `${String(value).slice(0, 40)}`)
      .join(' · ');
    return argSummary ? `${label} · ${argSummary}` : label;
  }
  if (event.type === 'thinking') return firstLine(event.summary || event.body, 140) || label;
  if (event.type === 'skill_load') {
    const skillName = event.skillTitle || event.skillId || '';
    return skillName ? `Loaded: ${String(skillName)}` : label;
  }
  return label;
}

const EVENT_BORDER_COLORS: Record<string, string> = {
  thinking: '#A855F7',
  cloud_request: '#FBBF24',
  cloud_response: '#F59E0B',
  tool_call: 'var(--iris-accent)',
  skill_load: '#34D399',
  phase: '#F59E0B',
  notice: '#FBBF24',
  error: '#F87171',
  default: 'var(--app-border)',
};

// Returns event border color without requiring callers to know where or how it is stored.
// Sub-agent events carry a stable per-model color (Workstream D) so each model gets its own
// left-border lane; the orchestrator's own events keep the type-based palette.
export function getEventBorderColor(event: TimelineEventData): string {
  // A notice keeps its own amber/red lane (red for failures) even when sub-agent-sourced, so a
  // model-failure / failover card reads as a warning rather than blending into the agent's color.
  if (event.type === 'notice') return event.level === 'error' ? '#F87171' : '#FBBF24';
  if (event.source === 'subagent' && typeof event.agentColor === 'string' && event.agentColor) {
    return event.agentColor;
  }
  return EVENT_BORDER_COLORS[String(event.type || '')] || EVENT_BORDER_COLORS.default;
}
