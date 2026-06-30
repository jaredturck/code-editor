import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { IPty } from 'node-pty'

interface TerminalEntry {
  owner_id: number
  terminal_id: number
  process: IPty
}

const terminal_entries = new Map<string, TerminalEntry>()
let pty_module: typeof import('node-pty') | null = null
let pty_load_error: Error | null = null

function load_pty() {
  if (pty_module) {
    return pty_module
  }

  if (pty_load_error) {
    throw pty_load_error
  }

  try {
    pty_module = require('node-pty') as typeof import('node-pty')
    return pty_module
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    pty_load_error = new Error(
      `The terminal native module could not be loaded. Run npm install so @electron/rebuild can rebuild node-pty for Electron. ${detail}`,
    )
    throw pty_load_error
  }
}

function terminal_key(owner_id: number, terminal_id: number) {
  return `${owner_id}:${terminal_id}`
}

function resolve_shell() {
  const configured_shell = process.env.SHELL

  if (configured_shell && existsSync(configured_shell)) {
    return configured_shell
  }

  return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
}

export function create_terminal(sender: WebContents, terminal_id: number, cwd = homedir()) {
  const key = terminal_key(sender.id, terminal_id)
  const existing = terminal_entries.get(key)

  if (existing) {
    return {
      shell: resolve_shell(),
      cwd,
    }
  }

  const pty = load_pty()
  const shell = resolve_shell()
  const environment = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
  const terminal_process = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: environment as Record<string, string>,
  })
  const entry: TerminalEntry = {
    owner_id: sender.id,
    terminal_id,
    process: terminal_process,
  }

  terminal_entries.set(key, entry)

  terminal_process.onData((data) => {
    if (!sender.isDestroyed()) {
      sender.send('terminal:data', { terminal_id, data })
    }
  })
  terminal_process.onExit(({ exitCode, signal }) => {
    terminal_entries.delete(key)

    if (!sender.isDestroyed()) {
      sender.send('terminal:exit', {
        terminal_id,
        exit_code: exitCode,
        signal,
      })
    }
  })

  return { shell, cwd }
}

export function write_terminal(owner_id: number, terminal_id: number, data: string) {
  terminal_entries.get(terminal_key(owner_id, terminal_id))?.process.write(data)
}

export function resize_terminal(owner_id: number, terminal_id: number, cols: number, rows: number) {
  const terminal_process = terminal_entries.get(terminal_key(owner_id, terminal_id))?.process

  if (!terminal_process) {
    return
  }

  terminal_process.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
}

export function kill_terminal(owner_id: number, terminal_id: number) {
  const key = terminal_key(owner_id, terminal_id)
  const entry = terminal_entries.get(key)

  if (!entry) {
    return
  }

  terminal_entries.delete(key)
  entry.process.kill()
}

export function kill_window_terminals(owner_id: number) {
  for (const [key, entry] of terminal_entries) {
    if (entry.owner_id !== owner_id) {
      continue
    }

    terminal_entries.delete(key)
    entry.process.kill()
  }
}

export function kill_all_terminals() {
  for (const [key, entry] of terminal_entries) {
    terminal_entries.delete(key)
    entry.process.kill()
  }
}
