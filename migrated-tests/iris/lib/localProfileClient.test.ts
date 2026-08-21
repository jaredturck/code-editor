/**
 * Protects the local desktop profile contract after retirement of the hosted-platform facade.
 * This profile state is UI convenience only; bridge and operating-system permissions remain
 * separate security boundaries.
 */

import { describe, expect, it } from 'vitest';
import { localProfileClient } from '@/platform/localProfileClient';
import { readStorageJson, readStorageText } from '@/platform/localStorageStore';

describe('localProfileClient', () => {
  it('creates and reuses a local desktop session', async () => {
    const first = await localProfileClient.ensureLocalSession();
    const second = await localProfileClient.ensureLocalSession();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: 'local-user',
      email: 'desktop@local',
      role: 'admin',
      provider: 'local',
    });
    expect(readStorageText('iris_auth_token')).toMatch(/^local_/);
    expect(localStorage.getItem('iris_auth_token')).toBeNull();
  });

  it('rejects me() until a local profile exists', async () => {
    await expect(localProfileClient.me()).rejects.toMatchObject({
      status: 401,
      message: 'Not authenticated',
    });
  });

  it('preserves the existing local email/password-shaped UI behavior', async () => {
    await expect(
      localProfileClient.loginViaEmailPassword('user@example.test', 'password'),
    ).resolves.toEqual({
      user: expect.objectContaining({
        email: 'user@example.test',
        name: 'user',
      }),
    });
    await expect(localProfileClient.me()).resolves.toMatchObject({
      email: 'user@example.test',
    });
    await expect(localProfileClient.loginViaEmailPassword('', '')).rejects.toThrow(
      'Email and password are required',
    );
  });

  it('preserves registration, OTP, and reset UI flows locally', async () => {
    await expect(
      localProfileClient.register({
        email: 'new@example.test',
        password: 'password',
      }),
    ).resolves.toEqual({ requires_otp: true });
    await expect(localProfileClient.resendOtp('new@example.test')).resolves.toEqual({ sent: true });

    await expect(
      localProfileClient.verifyOtp({
        email: 'new@example.test',
        otpCode: '123456',
      }),
    ).resolves.toMatchObject({
      access_token: expect.stringMatching(/^local_/),
      user: { email: 'new@example.test' },
    });
    expect(readStorageJson('iris_pending_registration', null)).toBeNull();

    await expect(localProfileClient.resetPassword({ newPassword: '123' })).rejects.toThrow(
      'at least 6 characters',
    );
    await expect(localProfileClient.resetPassword({ newPassword: '123456' })).resolves.toEqual({
      success: true,
    });
  });

  it('clears all local profile state on logout', async () => {
    await localProfileClient.ensureLocalSession();
    localProfileClient.setToken('manual-token');
    expect(readStorageText('iris_auth_token')).toBe('manual-token');

    localProfileClient.logout();
    expect(readStorageJson('iris_auth_user', null)).toBeNull();
    expect(readStorageText('iris_auth_token')).toBe('');
  });
});
