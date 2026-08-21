/**
 * Normalizes current and legacy launcher requests, decides when visible review is required,
 * and binds one-time approval to the exact command being launched. This preserves existing
 * shortcuts without allowing approval for one command to authorize a different request.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface NormalizedLauncherRequest {
  category: string;
  cwd: string;
  executable?: string;
  args: string[];
  legacyCommand?: string;
  displayCommand: string;
}

export interface LauncherRisk {
  requiresApproval: boolean;
  kind: 'ordinary' | 'destructive' | 'elevated' | 'legacy_shell';
  reason: string;
}

interface PendingApproval {
  signature: string;
  expiresAt: number;
}

const APPROVAL_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_APPROVALS = 100;
const pendingApprovals = new Map<string, PendingApproval>();
const ELEVATED_EXECUTABLES = new Set(['sudo', 'doas', 'pkexec', 'su']);
const DESTRUCTIVE_EXECUTABLES = new Set([
  'rm',
  'rmdir',
  'shred',
  'mkfs',
  'wipefs',
  'dd',
  'kill',
  'killall',
  'pkill',
  'shutdown',
  'reboot',
  'poweroff',
  'halt',
]);

// Removes expired or excess approvals so retained in-memory state remains bounded.
function pruneApprovals(now = Date.now()): void {
  for (const [approvalId, approval] of pendingApprovals) {
    if (approval.expiresAt <= now) pendingApprovals.delete(approvalId);
  }
  while (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
    const oldest = pendingApprovals.keys().next();
    if (oldest.done) break;
    pendingApprovals.delete(oldest.value);
  }
}

function quoteDisplayArgument(value: string): string {
  return /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Interprets simple command and turns the source representation into structured application
 * data.
 */

function parseSimpleCommand(command: string): { executable: string; args: string[] } | null {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = '';
      else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if ('|&;<>`\n\r'.includes(character)) return null;
    if (character === '$' || character === '*' || character === '?' || character === '[')
      return null;
    current += character;
  }

  if (escaped || quote) return null;
  if (current) tokens.push(current);
  if (!tokens.length) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) return null;

  return { executable: tokens[0], args: tokens.slice(1) };
}

/**
 * Converts every launcher request into one internal format before it is checked or
 * executed. It supports the current executable-and-arguments format and shortcuts saved
 * before that format was introduced, preserving shell-dependent legacy commands for visible
 * review rather than silently changing their meaning.
 */

export function normalizeLauncherRequest(
  body: Record<string, unknown>,
  cwd: string,
): NormalizedLauncherRequest {
  const category = String(body.category || 'command').trim() || 'command';
  const explicitExecutable = String(body.executable || '').trim();
  const explicitArgs = Array.isArray(body.args)
    ? body.args.map((argument) => String(argument)).slice(0, 100)
    : [];

  if (explicitExecutable) {
    return {
      category,
      cwd,
      executable: explicitExecutable,
      args: explicitArgs,
      displayCommand: [explicitExecutable, ...explicitArgs].map(quoteDisplayArgument).join(' '),
    };
  }

  const command = String(body.command || '').trim();
  if (!command) throw new Error('Launch command is required');
  const parsed = parseSimpleCommand(command);

  if (parsed) {
    return {
      category,
      cwd,
      executable: parsed.executable,
      args: parsed.args,
      displayCommand: [parsed.executable, ...parsed.args].map(quoteDisplayArgument).join(' '),
    };
  }

  return {
    category,
    cwd,
    args: [],
    legacyCommand: command,
    displayCommand: command,
  };
}

/**
 * Determines whether a normalized launch can run immediately or needs the user to review an
 * elevated, destructive, or shell-dependent action. The classification produces the
 * human-readable reason shown by the Launcher panel.
 */

export function classifyLauncherRequest(request: NormalizedLauncherRequest): LauncherRisk {
  if (request.category === 'data_clear') {
    return {
      requiresApproval: true,
      kind: 'destructive',
      reason:
        'This action permanently deletes IRIS chats, settings, notes, skills, artifacts, and other encrypted application data.',
    };
  }

  if (request.category === 'script') {
    return {
      requiresApproval: true,
      kind: 'legacy_shell',
      reason:
        'This launcher action runs a script or system-management command and requires confirmation.',
    };
  }

  if (request.legacyCommand) {
    return {
      requiresApproval: true,
      kind: 'legacy_shell',
      reason: 'This shortcut uses shell operators or expansion and will run through a shell.',
    };
  }

  const executable = path.basename(String(request.executable || '')).toLowerCase();
  if (ELEVATED_EXECUTABLES.has(executable)) {
    return {
      requiresApproval: true,
      kind: 'elevated',
      reason: 'This command requests elevated operating-system privileges.',
    };
  }

  if (DESTRUCTIVE_EXECUTABLES.has(executable)) {
    return {
      requiresApproval: true,
      kind: 'destructive',
      reason: 'This command can delete data, stop processes, or change system state.',
    };
  }

  if (executable === 'git' && (request.args.includes('clean') || request.args.includes('--hard'))) {
    return {
      requiresApproval: true,
      kind: 'destructive',
      reason: 'This Git command can permanently discard local work.',
    };
  }

  if (
    executable === 'docker' &&
    request.args.includes('system') &&
    request.args.includes('prune')
  ) {
    return {
      requiresApproval: true,
      kind: 'destructive',
      reason: 'This Docker command can remove local containers, images, or volumes.',
    };
  }

  return { requiresApproval: false, kind: 'ordinary', reason: '' };
}

// Hashes the normalized launcher request so approval applies only to that exact command.
function approvalSignature(request: NormalizedLauncherRequest): string {
  return JSON.stringify({
    category: request.category,
    cwd: request.cwd,
    executable: request.executable || '',
    args: request.args,
    legacyCommand: request.legacyCommand || '',
  });
}

/**
 * Creates a short-lived approval record for one exact normalized launch request. The stored
 * signature prevents a token issued for a reviewed command from being reused with different
 * arguments or a different working directory.
 */

export function createLauncherApproval(request: NormalizedLauncherRequest): string {
  pruneApprovals();
  const approvalId = randomUUID();
  pendingApprovals.set(approvalId, {
    signature: approvalSignature(request),
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });
  return approvalId;
}

/**
 * Consumes a matching launcher approval exactly once and removes expired or mismatched
 * records. Returning false leaves the caller on the review path instead of weakening the
 * original classification.
 */

export function consumeLauncherApproval(
  approvalId: unknown,
  request: NormalizedLauncherRequest,
): boolean {
  pruneApprovals();
  const normalizedId = String(approvalId || '').trim();
  if (!normalizedId) return false;
  const approval = pendingApprovals.get(normalizedId);
  pendingApprovals.delete(normalizedId);
  return Boolean(approval && approval.signature === approvalSignature(request));
}
