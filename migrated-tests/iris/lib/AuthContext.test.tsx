/**
 * Exercises the observable auth context contract, with regression cases for “loads the
 * current local user and public settings” and “creates a local session when the initial
 * lookup fails”. The suite documents caller-visible behavior so implementation refactors
 * cannot silently weaken those guarantees.
 */

import 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  me: vi.fn(),
  ensureLocalSession: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@/platform/localProfileClient', () => ({
  localProfileClient: authMocks,
}))

import { AuthProvider, useAuth } from '@/platform/AuthContext'

function wrapper({ children }: React.PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthContext', () => {
  beforeEach(() => {
    authMocks.me.mockReset()
    authMocks.ensureLocalSession.mockReset()
    authMocks.logout.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('loads the current local user and public settings', async () => {
    authMocks.me.mockResolvedValue({ id: 'local-user', role: 'user' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.isLoadingAuth).toBe(false))
    expect(result.current.user).toEqual({ id: 'local-user', role: 'user' })
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.appPublicSettings!.public_settings.mode).toBe('desktop-local')
  })

  it('creates a local session when the initial lookup fails', async () => {
    authMocks.me.mockRejectedValue(new Error('missing'))
    authMocks.ensureLocalSession.mockResolvedValue({ id: 'created-user' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.authChecked).toBe(true))
    expect(authMocks.ensureLocalSession).toHaveBeenCalledOnce()
    expect(result.current.user).toEqual({ id: 'created-user' })
  })

  it('records an authentication error when both local methods fail', async () => {
    authMocks.me.mockRejectedValue(new Error('missing'))
    authMocks.ensureLocalSession.mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.authChecked).toBe(true))
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.authError).toEqual({
      type: 'auth_required',
      message: 'Authentication required',
    })
  })

  it('logs out through the local profile service', async () => {
    authMocks.me.mockResolvedValue({ id: 'local-user' })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true))

    act(() => result.current.logout(false))
    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
    expect(authMocks.logout).toHaveBeenCalledWith(null)
  })

  it('requires the provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider')
  })
})
