'use strict'

/**
 * IRIS activity logger (main process).
 *
 * One file per application session under <userData>/logs/. Every line is written
 * with ANSI color codes so a `tail -f` in a real terminal renders priority +
 * process coloring live, and the saved file doubles as a colored transcript
 * (view later with `less -R` / `cat`). The logger is intentionally passive:
 *  - writes are buffered through a fs stream (never blocks the UI / agent loop),
 *  - every public method is wrapped so a logging failure can never crash the app,
 *  - it patches console.* in the main process to capture bridge-server output too.
 *
 * Renderer + agent activity arrives over the `iris:log` IPC channel (see
 * preload.cjs / src/lib/logger.ts) and is merged into the same stream, so the
 * single terminal shows the whole application: main, bridge, renderer, agent
 * thinking summaries, and AI API requests.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import security from './security.cjs'

const { redactSensitiveData, stripTerminalControlCharacters } = security

// ── ANSI palette ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
} as const

interface LevelDefinition {
  rank: number
  color: string
  label: string
}

// Priority → color + label. Higher index = louder.
const LEVELS: Record<string, LevelDefinition> = {
  debug: { rank: 10, color: C.gray, label: 'DEBUG' },
  info: { rank: 20, color: C.cyan, label: 'INFO ' },
  ai: { rank: 25, color: C.magenta, label: 'AI   ' },
  event: { rank: 30, color: C.green, label: 'EVENT' },
  warn: { rank: 40, color: C.yellow, label: 'WARN ' },
  error: { rank: 50, color: C.brightRed, label: 'ERROR' },
}

// Stable per-process colors so the eye can track origin at a glance.
const SCOPE_COLORS: Record<string, string> = {
  main: C.blue,
  bridge: C.green,
  renderer: C.cyan,
  agent: C.magenta,
  ai: C.magenta,
}

export interface LogEntry {
  level?: string
  scope?: string
  message?: unknown
  data?: unknown
  at?: number
}

export interface OpenTerminalResult {
  ok: boolean
  file?: string
  terminal?: string
  error?: string
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type TerminalCommand = [binary: string, args: string[]]

let stream: fs.WriteStream | null = null
let sessionFile = ''
let patchedConsole = false
const originalConsole: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

// Formats a timestamp for human-readable session logs.
function clock(ts: string | number | Date): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
}

// Persistent logs intentionally retain only structure and fingerprints. Free-form text,
// prompts, replies, file contents, commands, paths, and tool output never reach the log file.
function fingerprint(value: unknown): string {
  const text = stripTerminalControlCharacters(String(value ?? ''))
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function describeData(data: unknown): string {
  if (data === undefined || data === null) return ''
  if (Array.isArray(data)) return JSON.stringify({ type: 'array', length: data.length })
  if (data instanceof Error) {
    return JSON.stringify({
      type: 'error',
      name: data.name,
      fingerprint: fingerprint(data.message),
    })
  }
  if (typeof data === 'object') {
    return JSON.stringify({
      type: 'object',
      keys: Object.keys(data as Record<string, unknown>)
        .slice(0, 40)
        .sort(),
    })
  }
  return JSON.stringify({ type: typeof data, fingerprint: fingerprint(data) })
}

// Formats line for stable display or serialization without changing its underlying meaning.
function formatLine(entry: LogEntry): string {
  const level = LEVELS[entry.level || ''] || LEVELS.info
  const scope = stripTerminalControlCharacters(entry.scope || 'main')
    .toLowerCase()
    .slice(0, 80)
  const scopeColor = SCOPE_COLORS[scope] || C.gray
  const time = `${C.gray}${clock(entry.at || Date.now())}${C.reset}`
  const pri = `${level.color}${level.label}${C.reset}`
  const proc = `${scopeColor}${(scope + '        ').slice(0, 8)}${C.reset}`
  const rawMessage = stripTerminalControlCharacters(String(entry.message ?? ''))
  const message = `[message:${fingerprint(rawMessage)} chars:${rawMessage.length}]`
  const data = describeData(entry.data)
  const tail = data ? ` ${C.dim}${data}${C.reset}` : ''
  return `${time} ${pri} ${proc} ${message}${tail}\n`
}

// ── File lifecycle ──────────────────────────────────────────────────────────────

function init(userDataDir?: string): string {
  if (stream) return sessionFile
  try {
    const base = userDataDir || path.join(os.homedir(), '.iris-ai')
    const dir = path.join(base, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    sessionFile = path.join(dir, `iris-${stamp}.log`)
    stream = fs.createWriteStream(sessionFile, { flags: 'a' })

    // Stable symlink to the current session so a terminal can always
    // `tail -f` the same path even before a specific file name is known.
    try {
      const latest = path.join(dir, 'latest.log')
      try {
        fs.unlinkSync(latest)
      } catch {
        /* none yet */
      }
      fs.symlinkSync(sessionFile, latest)
    } catch {
      /* symlinks unsupported (e.g. some FS) — non-fatal */
    }

    record({
      level: 'event',
      scope: 'main',
      message: 'IRIS session log started',
      data: { file: sessionFile, pid: process.pid },
    })
    pruneOldLogs(dir)
  } catch {
    stream = null
  }
  return sessionFile
}

// Keep the logs directory bounded — retain the 40 most recent session files.
function pruneOldLogs(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.startsWith('iris-') && file.endsWith('.log'))
      .map((file) => ({
        file,
        time: fs.statSync(path.join(dir, file)).mtimeMs,
      }))
      .sort((left, right) => right.time - left.time)
    for (const { file } of files.slice(40)) {
      try {
        fs.unlinkSync(path.join(dir, file))
      } catch {
        /* non-fatal */
      }
    }
  } catch {
    /* non-fatal */
  }
}

// Appends one normalized entry to session activity logger without making logging a required success
// path.
function record(entry: LogEntry): void {
  try {
    if (!stream) return
    stream.write(formatLine({ ...entry, at: entry.at || Date.now() }))
  } catch {
    /* logging must never throw into callers */
  }
}

// Accept a batch (or single) of renderer/agent entries over IPC.
function ingest(payload: unknown): void {
  if (!payload) return
  const list = Array.isArray(payload) ? payload : [payload]
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    record({
      level: String(entry.level || 'info'),
      scope: String(entry.scope || 'renderer'),
      message: String(entry.message ?? ''),
      data: entry.data,
      at: Number(entry.at) || Date.now(),
    })
  }
}

// Finalizes session activity logger and releases resources retained for its lifetime.
function close(reason?: string): void {
  try {
    if (!stream) return
    record({
      level: 'event',
      scope: 'main',
      message: 'IRIS session log closed',
      data: { reason: reason || 'quit' },
    })
    stream.end()
  } catch {
    /* non-fatal */
  } finally {
    stream = null
  }
}

// ── Capture main-process console (includes the in-process bridge server) ────────

function patchConsole(): void {
  if (patchedConsole) return
  patchedConsole = true
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']
  for (const method of methods) {
    const original = console[method].bind(console) as (...args: unknown[]) => void
    originalConsole[method] = original
    console[method] = (...args: unknown[]): void => {
      try {
        const safeArgs = args.map((value) => redactSensitiveData(value))
        const text = safeArgs.map((value) => (typeof value === 'string' ? value : describeData(value))).join(' ')
        // Tag bridge-server lines (they prefix with [iris]) as the bridge process.
        const scope = /^\s*\[orbit\]/i.test(text) ? 'bridge' : 'main'
        const level = method === 'log' ? 'info' : method === 'debug' ? 'debug' : method
        record({ level, scope, message: text })
        original(...safeArgs)
      } catch {
        /* non-fatal */
        original('[REDACTED LOGGING ERROR]')
      }
    }
  }
}

// ── Open the OS terminal tailing the live session file ──────────────────────────

function commandExists(bin: string): boolean {
  if (!bin) return false
  try {
    if (spawnSync('which', [bin], { stdio: 'ignore' }).status === 0) return true
  } catch {
    /* `which` itself missing — fall through */
  }
  // Fallback: probe common bin dirs directly (PATH can be minimal when the app
  // is launched from a desktop icon rather than a shell).
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin', '/snap/bin']) {
    try {
      if (fs.existsSync(path.join(dir, bin))) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

// Write a tiny launch script that tails the current session file. Going through
// a script (rather than an inline command string) avoids every terminal's
// different quoting/`-e` rules — they all just run `bash <script>`.
function writeLaunchScript(): string {
  const dir = path.dirname(sessionFile)
  const script = path.join(dir, 'show-logs.sh')
  const body =
    '#!/usr/bin/env bash\n' +
    "printf '\\033]0;IRIS Logs\\007'\n" +
    'clear\n' +
    `echo "── IRIS live logs — ${sessionFile} ──"\n` +
    'echo "(close this window to stop following)"\n' +
    'echo\n' +
    `exec tail -n +1 -f "${sessionFile}"\n`
  fs.writeFileSync(script, body, { mode: 0o755 })
  return script
}

// [binary, argsBuilder(scriptPath)] — first that exists wins. Each opens a
// window running `bash <script>` and stays open (tail -f never returns).
function linuxTerminals(script: string): TerminalCommand[] {
  const quote = (value: string): string => `'${String(value).replace(/'/g, "'\\''")}'`
  return [
    ['x-terminal-emulator', ['-e', 'bash', script]],
    ['gnome-terminal', ['--title=IRIS Logs', '--', 'bash', script]],
    ['ptyxis', ['--', 'bash', script]],
    ['kgx', ['-e', `bash ${quote(script)}`]], // GNOME Console
    ['konsole', ['--title', 'IRIS Logs', '-e', 'bash', script]],
    ['xfce4-terminal', [`--command=bash ${quote(script)}`, '--title=IRIS Logs']],
    ['tilix', ['-t', 'IRIS Logs', '-e', `bash ${quote(script)}`]],
    ['kitty', ['--title', 'IRIS Logs', 'bash', script]],
    ['alacritty', ['--title', 'IRIS Logs', '-e', 'bash', script]],
    ['wezterm', ['start', '--', 'bash', script]],
    ['foot', ['bash', script]],
    ['terminator', ['-T', 'IRIS Logs', '-e', `bash ${quote(script)}`]],
    ['xterm', ['-T', 'IRIS Logs', '-e', 'bash', script]],
  ]
}

/**
 * Spawn the user's local terminal following the live session log. Returns
 * { ok, file, terminal?, error? }. Never throws.
 */
function openTerminal(): OpenTerminalResult {
  if (!sessionFile) return { ok: false, error: 'No active session log.' }
  const file = sessionFile

  try {
    if (process.platform === 'linux') {
      const script = writeLaunchScript()
      // Honor an explicit $TERMINAL first, then the known emulators.
      const preferred = (process.env.TERMINAL || '').trim()
      const list = linuxTerminals(script)
      if (preferred) list.unshift([preferred, ['-e', 'bash', script]])

      const chosen = list.find(([bin]) => commandExists(bin))
      if (!chosen) {
        return {
          ok: false,
          error: 'No terminal emulator found (set $TERMINAL or install gnome-terminal/konsole/xterm).',
          file,
        }
      }
      const [bin, args] = chosen
      const child = spawn(bin, args, { detached: true, stdio: 'ignore' })
      // child.on('error', (error: Error) =>
      child.stdout?.on('error', (error: Error) =>
        record({
          level: 'error',
          scope: 'main',
          message: `Terminal "${bin}" failed to launch`,
          data: { error: error.message },
        }),
      )

      child.unref()
      return { ok: true, file, terminal: bin }
    }

    if (process.platform === 'darwin') {
      const script = `tell application "Terminal"\nactivate\ndo script "clear; tail -n +1 -f '${file.replace(/'/g, "'\\''")}'"\nend tell`
      const child = spawn('osascript', ['-e', script], {
        detached: true,
        stdio: 'ignore',
      })
      child.stdout?.on('error', () => {})
      child.unref()
      return { ok: true, file, terminal: 'Terminal.app' }
    }

    if (process.platform === 'win32') {
      const psCmd = `Get-Content -Path '${file.replace(/'/g, "''")}' -Wait -Tail 1000`
      const child = spawn('cmd', ['/c', 'start', '"IRIS Logs"', 'powershell', '-NoExit', '-Command', psCmd], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.stdout?.on('error', () => {})
      child.unref()
      return { ok: true, file, terminal: 'powershell' }
    }

    return {
      ok: false,
      error: `Unsupported platform: ${process.platform}`,
      file,
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to open terminal.',
      file,
    }
  }
}

function getSessionFile(): string {
  return sessionFile
}

export { close, getSessionFile, ingest, init, openTerminal, patchConsole, record }
