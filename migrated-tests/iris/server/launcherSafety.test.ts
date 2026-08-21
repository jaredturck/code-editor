/**
 * Exercises the observable launcher safety contract, with regression cases for “keeps
 * simple commands structured and immediately runnable” and “requires approval for
 * destructive and legacy shell commands”. The suite documents caller-visible behavior so
 * implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyLauncherRequest,
  consumeLauncherApproval,
  createLauncherApproval,
  normalizeLauncherRequest,
} from '../../server/desktopBridge/shared/launcherSafety';

describe('launcher safety', () => {
  it('keeps simple commands structured and immediately runnable', () => {
    const request = normalizeLauncherRequest(
      { command: 'npm run dev', category: 'command' },
      '/tmp',
    );

    expect(request).toMatchObject({ executable: 'npm', args: ['run', 'dev'] });
    expect(classifyLauncherRequest(request).requiresApproval).toBe(false);
  });

  it('requires approval for destructive and legacy shell commands', () => {
    const destructive = normalizeLauncherRequest({ command: 'rm -rf /tmp/example' }, '/tmp');
    const legacy = normalizeLauncherRequest({ command: 'echo ok && echo next' }, '/tmp');

    expect(classifyLauncherRequest(destructive).kind).toBe('destructive');
    expect(classifyLauncherRequest(legacy).kind).toBe('legacy_shell');
  });

  it('requires approval for script-category system actions', () => {
    const request = normalizeLauncherRequest(
      {
        executable: 'konsole',
        args: ['-e', 'bash', '-lc', 'sudo pacman -Syu'],
        category: 'script',
      },
      '/tmp',
    );

    expect(classifyLauncherRequest(request)).toMatchObject({
      requiresApproval: true,
      kind: 'legacy_shell',
    });
  });

  it('binds one-time approval to the exact command and working directory', () => {
    const request = normalizeLauncherRequest({ command: 'rm -rf /tmp/example' }, '/tmp');
    const changed = normalizeLauncherRequest({ command: 'rm -rf /tmp/other' }, '/tmp');
    const approvalId = createLauncherApproval(request);

    expect(consumeLauncherApproval(approvalId, changed)).toBe(false);
    expect(consumeLauncherApproval(approvalId, request)).toBe(false);

    const validApprovalId = createLauncherApproval(request);
    expect(consumeLauncherApproval(validApprovalId, request)).toBe(true);
    expect(consumeLauncherApproval(validApprovalId, request)).toBe(false);
  });
});
