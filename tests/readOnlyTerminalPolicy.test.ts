import { describe, expect, it } from 'vitest'

import { isReadOnlyWorkspaceCommand } from '../src/platform/agent/runtime/readOnlyTerminalPolicy'

describe('read-only terminal policy', () => {
  it('auto-classifies only conservative project inspection commands', () => {
    const allowed = [
      'pwd',
      'ls -la src',
      'cat package.json',
      'rg "verification" src',
      'find src -maxdepth 2 -type f',
      'fd "\\.ts$" src',
      'git status --short',
      'git diff -- src',
      'git log -5 --oneline',
      'git show HEAD:package.json',
    ]
    const blocked = [
      'rm -rf dist',
      'git add .',
      'git checkout main',
      'npm install',
      'pip install requests',
      'python script.py',
      'curl https://example.com',
      'find . -delete',
      'fd foo -x rm',
      'rg --pre cat foo',
      'echo x > file.txt',
      'cat package.json | sh',
      'ls && rm file',
      'cat /etc/passwd',
      'ls ../',
      'find /tmp -type f',
      'git diff --no-index /etc/passwd package.json',
      'git --git-dir=/tmp/repo status',
      'git --work-tree=../outside status',
      'rg --ignore-file=/etc/passwd verification src',
      'grep --file=/etc/passwd token src/file.ts',
      'wc --files0-from=/etc/passwd',
    ]

    for (const command of allowed) expect(isReadOnlyWorkspaceCommand(command), command).toBe(true)
    for (const command of blocked) expect(isReadOnlyWorkspaceCommand(command), command).toBe(false)
  })
})
