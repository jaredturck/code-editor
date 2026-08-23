/**
 * Verifies contextual permission cards persist the requested capability, retry the blocked
 * action, and allow dismissal without changing settings.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grantPermissions: vi.fn(),
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({ grantPermissions: mocks.grantPermissions }),
}))

import PermissionRequestCard from '@/components/permissions/PermissionRequestCard'

describe('PermissionRequestCard', () => {
  beforeEach(() => {
    mocks.grantPermissions.mockReset().mockResolvedValue({})
  })

  it('enables the requested permission and retries the blocked action', async () => {
    const onEnabled = vi.fn()
    render(
      <PermissionRequestCard
        permissionKey="file_read"
        title="File access required"
        description="IRIS needs permission."
        onDismiss={vi.fn()}
        onEnabled={onEnabled}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(mocks.grantPermissions).toHaveBeenCalledWith('file_read'))
    expect(onEnabled).toHaveBeenCalledOnce()
  })

  it('dismisses without granting the permission', () => {
    const onDismiss = vi.fn()
    render(
      <PermissionRequestCard
        permissionKey="terminal_exec"
        title="Terminal required"
        description="IRIS needs permission."
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(mocks.grantPermissions).not.toHaveBeenCalled()
  })

  it('keeps the card visible and shows bridge synchronization failures', async () => {
    mocks.grantPermissions.mockRejectedValue(new Error('Bridge update failed'))
    render(
      <PermissionRequestCard
        permissionKey="microphone"
        title="Microphone required"
        description="IRIS needs permission."
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    expect(await screen.findByText('Bridge update failed')).toBeInTheDocument()
  })
})
