import { describe, expect, it } from 'vitest'

import { formatApprovalRequestForDisplay, normalizeApprovalOptions } from '@/platform-features/chat-ui/utils/approvals'

describe('approval request display', () => {
  it('shows the exact command, working directory and timeout for command approvals', () => {
    const request = formatApprovalRequestForDisplay(
      {
        id: 'approval-1',
        requestType: 'approval',
        requestedTool: 'terminal.exec',
        reason: 'This command crosses the open project boundary.',
        stepAction: {
          command: 'npm install -g example-cli',
          cwd: '/workspace/project',
        },
        expiresAt: 11_000,
      },
      1_000,
    )

    expect(request.requestedAction).toContain('This command crosses the open project boundary.')
    expect(request.requestedAction).toContain('Command:\nnpm install -g example-cli')
    expect(request.requestedAction).toContain('Working directory:\n/workspace/project')
    expect(request.requestedAction).toContain('Auto-denies in 10s if you do not respond.')
  })

  it('does not offer persistent machine permission changes from the Chat approval card', () => {
    const options = normalizeApprovalOptions({
      id: 'permission-1',
      requestType: 'permission',
      persistentPermission: true,
      permissionKeys: ['terminal_exec'],
    })

    expect(options.map((option) => option.id)).toEqual(['allow_once', 'deny'])
  })
})
