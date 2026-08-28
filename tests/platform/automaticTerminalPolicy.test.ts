import { describe, expect, it } from 'vitest'

import {
  isHardBlockedTerminalCommand,
  isWorkspaceAutonomousCommand,
  terminalCommandEscapesWorkspace,
} from '@/platform/agent/runtime/readOnlyTerminalPolicy'
import { assertSafeCommand, assertSafePath } from '@/platform/agent/runtime/safetyPolicy'

const workspace = '/workspace/project'

describe('automatic terminal workspace policy', () => {
  it('treats normal HTTP(S) network targets as network resources rather than workspace paths', () => {
    expect(terminalCommandEscapesWorkspace('curl https://example.com/api', workspace)).toBe(false)
    expect(terminalCommandEscapesWorkspace('wget https://example.com/archive.tgz -O ./archive.tgz', workspace)).toBe(
      false,
    )
  })

  it('detects filesystem output, shell expansion and working directories outside the workspace', () => {
    expect(terminalCommandEscapesWorkspace('curl https://example.com/api -o /tmp/result.json', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('echo result >$HOME/result.txt', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('echo result >/tmp/result.txt', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('npm install', workspace, '/tmp')).toBe(true)
  })

  it('treats semantic global installs as outside-project mutations', () => {
    expect(terminalCommandEscapesWorkspace('npm install -g typescript', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('pnpm add --global eslint', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('cargo install cargo-audit', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('go install example.com/tool@latest', workspace)).toBe(true)
  })

  it('recognizes routine project package and file commands as autonomous', () => {
    expect(isWorkspaceAutonomousCommand('npm install', workspace)).toBe(true)
    expect(isWorkspaceAutonomousCommand('npm run build', workspace)).toBe(true)
    expect(isWorkspaceAutonomousCommand('rm ./obsolete.txt', workspace)).toBe(true)
    expect(isWorkspaceAutonomousCommand('mkdir ./generated', workspace)).toBe(true)
  })

  it('hard-blocks catastrophic deletes even when they target the current workspace root', () => {
    expect(isHardBlockedTerminalCommand('rm -rf .')).toBe(true)
    expect(isHardBlockedTerminalCommand('rm -rf ./')).toBe(true)
    expect(isHardBlockedTerminalCommand('rm -rf /')).toBe(true)
  })

  it('blocks process termination even when terminal authority is otherwise granted', () => {
    const settings = { agent_working_dir: workspace }
    const blocked_commands = [
      'kill 1234',
      'pkill -f vite',
      'killall node',
      'kill $(lsof -t -i:5173)',
      'lsof -ti:5173 | xargs kill -9',
      'fuser -k 5173/tcp',
      'npx kill-port 5173',
      'node -e "process.kill(1234)"',
    ]

    for (const command of blocked_commands) {
      expect(() => assertSafeCommand(command, settings)).toThrow('Process termination is blocked')
    }
    expect(assertSafeCommand('npm run dev', settings)).toBe('npm run dev')
  })

  it('keeps lower-level path resolution inside the configured project root', () => {
    const linux_settings = { agent_working_dir: workspace }
    expect(assertSafePath('src/index.ts', { settings: linux_settings })).toBe('/workspace/project/src/index.ts')
    expect(() => assertSafePath('/workspace/other/index.ts', { settings: linux_settings })).toThrow(
      'Path is outside the open project workspace.',
    )

    const windows_settings = { agent_working_dir: 'C:/Workspace/Project' }
    expect(assertSafePath('C:/Workspace/Project/src/index.ts', { settings: windows_settings })).toBe(
      'C:/Workspace/Project/src/index.ts',
    )
    expect(() => assertSafePath('C:/Workspace/Other/index.ts', { settings: windows_settings })).toThrow(
      'Path is outside the open project workspace.',
    )
  })
})
