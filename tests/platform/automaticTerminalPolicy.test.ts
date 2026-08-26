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
    expect(terminalCommandEscapesWorkspace('wget https://example.com/archive.tgz -O ./archive.tgz', workspace)).toBe(false)
  })

  it('still detects filesystem output or working directories outside the workspace', () => {
    expect(terminalCommandEscapesWorkspace('curl https://example.com/api -o /tmp/result.json', workspace)).toBe(true)
    expect(terminalCommandEscapesWorkspace('npm install', workspace, '/tmp')).toBe(true)
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
