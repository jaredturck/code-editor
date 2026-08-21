/**
 * Protects the permission-request contract: tools within the runtime surface stay visible
 * when consent is missing, but they remain unavailable until the approval flow grants them.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCapabilitySnapshot,
  evaluateToolAccess,
  fallbackForcedToolAction,
} from '@/platform/agent/runtime/capabilityPolicy';
import { DEFAULT_ORB_SETTINGS } from '@/platform/settingsStorage';

const safetyConfig = {
  profile: 'strict',
  requireExplicitApproval: false,
  maxSteps: 12,
};

describe('persistent permission requests', () => {
  it('advertises permission-blocked tools as requestable without marking them available', () => {
    const settings = { ...DEFAULT_ORB_SETTINGS };
    const snapshot = buildCapabilitySnapshot({
      settings,
      safetyConfig,
      userApprovalGranted: false,
    });

    expect(snapshot.availableTools).not.toContain('files.read');
    expect(snapshot.requestableTools).toContain('files.read');
    expect(snapshot.requestableTools).toContain('files.write');
    expect(snapshot.requestableTools).toContain('terminal.exec');
    expect(snapshot.advertisedTools).toContain('files.read');
    expect(snapshot.advertisedTools).toContain('terminal.exec');
  });

  it('marks a requestable tool available after the current session receives the grant', () => {
    const access = evaluateToolAccess('files.read', {
      settings: { ...DEFAULT_ORB_SETTINGS },
      safetyConfig,
      userApprovalGranted: false,
      sessionPermissionOverrides: { file_read: true } as any,
    });

    expect(access).toMatchObject({
      available: true,
      code: 'available',
      permissionKey: 'file_read',
    });
  });

  it('can force a requestable file action so the permission popup can be reached', () => {
    const snapshot = buildCapabilitySnapshot({
      settings: { ...DEFAULT_ORB_SETTINGS },
      safetyConfig,
      userApprovalGranted: false,
    });

    expect(fallbackForcedToolAction('list the files in this workspace', snapshot)).toMatchObject({
      tool: 'files.list',
    });
  });
});
