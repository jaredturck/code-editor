import { describe, expect, it } from 'vitest'

import {
  isHardBlockedTerminalCommand,
  isWorkspaceAutonomousCommand,
  terminalCommandEscapesWorkspace,
} from '@/platform/agent/runtime/readOnlyTerminalPolicy'

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
})
