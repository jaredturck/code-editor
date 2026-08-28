/**
 * Deterministic safety policy for the local coding agent.
 *
 * The agent is powerful inside the opened workspace, but the harness—not the model—owns
 * containment, destructive-command blocks, privileged execution, network policy, and Git
 * mutation. Keep this module small enough to audit.
 */
import { getToolCatalogEntry } from '@/platform/agent/toolCatalog'

type SafetySettings = Record<string, unknown>

interface SafePathOptions {
  operation?: 'read' | 'write' | 'cwd'
  settings?: SafetySettings | null
}

interface CommandApprovalState {
  allowElevatedCommands?: boolean
  allowNetworkCommands?: boolean
  allowShellPassthrough?: boolean
}

const MAX_TERMINAL_COMMAND_LENGTH = 16_000
const SECRET_PATH = /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|\.azure|\.config\/gcloud|\.kube|\.npmrc|\.pypirc|\.netrc)(?:\/|$)|(?:^|\/)(?:id_rsa|id_ed25519|credentials|shadow)(?:$|\/)/i
const SYSTEM_WRITE_PATH = /^(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/proc|\/sys|\/dev|\/run)(?:\/|$)/i
const STARTUP_WRITE_PATH = /(?:^|\/)(?:\.bashrc|\.zshrc|\.profile|\.bash_profile|\.config\/autostart)(?:$|\/)/i
const GIT_METADATA_PATH = /(?:^|\/)\.git(?:\/|$)/i

const GIT_MUTATION = /(?:^|[;&|\n]\s*)(?:(?:env|command)\s+)*(?:\S*[/])?git(?:\s+-C\s+\S+|\s+-c\s+\S+|\s+--(?:git-dir|work-tree|namespace|config-env)(?:=\S+|\s+\S+))*\s+(?:init|clone|add|commit|reset|clean|checkout|switch|restore|rm|mv|merge|rebase|cherry-pick|revert|tag|stash|worktree|submodule|remote|fetch|pull|push|branch|config|update-index|apply|am)(?:\s|$)/i
const FORK_BOMB = /:\(\)\s*\{\s*:\|:&\s*;\s*\}\s*;/
const PIPE_TO_SHELL = /(?:curl|wget)[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i
const SUDO = /(?:^|[;&|]\s*)sudo\b/i
const PROCESS_TERMINATION = [
  /(?:^|[;&|]\s*)(?:(?:sudo|doas|command|env)\s+)*(?:\S*\/)?(?:kill|pkill|killall|killall5|taskkill|kill-port)(?:\s|$)/i,
  /(?:^|[;&|]\s*)(?:(?:sudo|doas|command|env)\s+)*(?:\S*\/)?fuser\b[^\n;&|]*(?:\s|^)(?:-k|--kill)(?:\s|$)/i,
  /\bxargs\b[^\n;&|]*(?:\s|^)(?:\S*\/)?(?:kill|pkill|killall)(?:\s|$)/i,
  /\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+exec(?:\s+--)?)\s+kill-port(?:\s|$)/i,
  /\bStop-Process\b/i,
  /\bprocess\.kill\s*\(/i,
  /\bos\.kill\s*\(/i,
]
const DESTRUCTIVE = [
  /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/|~)(?:\s|$)/i,
  /(?:^|[;&|]\s*)(?:mkfs(?:\.\w+)?|fdisk|parted)\b/i,
  /(?:^|[;&|]\s*)dd\b[^\n]*\bof=\/dev\//i,
  /(?:^|[;&|]\s*)(?:shutdown|reboot|poweroff|halt)\b/i,
  /(?:^|[;&|]\s*)chmod\s+-R\s+777\s+(?:\/|~)(?:\s|$)/i,
]
const NETWORK_COMMAND = /(?:^|[;&|]\s*)(?:curl|wget|ssh|scp|sftp|ftp|nc|ncat|telnet)\b|(?:^|[;&|]\s*)(?:npm|pnpm|yarn|pip|pip3|uv|cargo|go)\s+(?:install|add|get)\b/i

function normalizePath(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
}

export function resolveAgentRootBase(settings: SafetySettings | null | undefined): string {
  return normalizePath(settings?.agent_working_dir) || '~'
}

export function applyAgentRoot(rawPath: unknown, settings: SafetySettings | null | undefined): string {
  const input = normalizePath(rawPath)
  if (!input) return input
  if (input === '.' || input === './') return resolveAgentRootBase(settings)
  if (input.startsWith('/') || input.startsWith('~') || /^[A-Za-z]:\//.test(input)) return input
  const root = resolveAgentRootBase(settings).replace(/\/$/, '')
  return `${root}/${input.replace(/^\.\//, '')}`
}

function pathIsWithinAgentRoot(resolvedPath: string, settings: SafetySettings | null | undefined) {
  const root = resolveAgentRootBase(settings).replace(/\/$/, '')
  if (!root || root === '~') return true
  const windows_path = /^[A-Za-z]:\//.test(root)
  const normalized_root = windows_path ? root.toLowerCase() : root
  const normalized_path = windows_path ? resolvedPath.toLowerCase() : resolvedPath
  return normalized_path === normalized_root || normalized_path.startsWith(`${normalized_root}/`)
}

export function assertSafePath(pathInput: unknown, { operation = 'read', settings }: SafePathOptions = {}): string {
  const requested = normalizePath(pathInput)
  if (!requested) throw new Error('Path is required.')
  if (requested.includes('\0')) throw new Error('Path contains invalid null bytes.')
  if (/(?:^|\/)\.\.(?:\/|$)/.test(requested)) throw new Error('Path traversal is blocked for agent file tools.')

  const resolved = applyAgentRoot(requested, settings)
  if (!pathIsWithinAgentRoot(resolved, settings)) {
    throw new Error('Path is outside the open project workspace.')
  }
  if (GIT_METADATA_PATH.test(resolved)) {
    throw new Error('Git metadata is managed by Source Control and is not available through agent file tools.')
  }
  if (operation === 'read' && SECRET_PATH.test(resolved)) {
    throw new Error('Reading credential, key, or secret paths is blocked.')
  }
  if (operation !== 'read') {
    if (SECRET_PATH.test(resolved) || SYSTEM_WRITE_PATH.test(resolved)) {
      throw new Error('Writing credential, key, or system paths is blocked.')
    }
    const strict = String(settings?.agent_safety_profile || '').toLowerCase() === 'strict'
    if (strict && STARTUP_WRITE_PATH.test(resolved)) {
      throw new Error('Writing shell startup or autostart files is blocked in strict mode.')
    }
  }
  return resolved
}

export function assertSafeCommand(
  command: unknown,
  settings: SafetySettings | null | undefined,
  _context = 'terminal',
  approvalState: CommandApprovalState | null = null,
): string {
  const text = String(command || '').trim()
  if (!text) throw new Error('Command is required.')
  if (text.length > MAX_TERMINAL_COMMAND_LENGTH) throw new Error('Command is too long for safe execution.')

  if (GIT_MUTATION.test(text)) {
    throw new Error(
      'Git mutations are owned by Source Control. Agent shell Git is read-only; use status, diff, log, show, rev-parse, ls-files, grep, or blame.',
    )
  }
  if (PROCESS_TERMINATION.some((pattern) => pattern.test(text))) {
    throw new Error(
      'Process termination is blocked for agent terminal commands. Do not kill processes or reclaim ports; use an alternate dev-server port or an IRIS-managed process lifecycle instead.',
    )
  }
  if (FORK_BOMB.test(text) || DESTRUCTIVE.some((pattern) => pattern.test(text))) {
    throw new Error('Command blocked by destructive-command safety policy.')
  }
  if (PIPE_TO_SHELL.test(text)) throw new Error('Pipe-to-shell execution is blocked.')
  if (SUDO.test(text) && approvalState?.allowElevatedCommands !== true) {
    throw new Error('Elevated commands require explicit runtime approval.')
  }
  if (NETWORK_COMMAND.test(text) && approvalState?.allowNetworkCommands !== true) {
    throw new Error('Network-related terminal commands are disabled for this session.')
  }
  if (/\b(?:sh|bash|zsh)\s+-c\b/i.test(text) && approvalState?.allowShellPassthrough === false) {
    const strict = String(settings?.agent_safety_profile || '').toLowerCase() === 'strict'
    if (strict) throw new Error('Shell passthrough is blocked in strict mode.')
  }
  return text
}

export function assertAllowedTool(toolName: string) {
  const tool = getToolCatalogEntry(toolName)
  if (!tool) throw new Error(`Unknown coding-agent tool: ${toolName}`)
  return tool
}
