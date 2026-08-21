/**
 * Exercises the observable settings storage contract, with regression cases for “returns a
 * complete default settings object” and “merges partial saved settings with defaults”. The
 * suite documents caller-visible behavior so implementation refactors cannot silently
 * weaken those guarantees.
 */

import { describe, expect, it } from 'vitest';
import { initializeStorageForTests, readStorageJson } from '@/platform/localStorageStore';
import {
  DEFAULT_ORB_SETTINGS,
  buildBridgePermissionState,
  buildPersistentPermissionPatch,
  readOrbSettings,
  writeOrbSettings,
} from '@/platform/settingsStorage';

describe('settingsStorage', () => {
  it('returns a complete default settings object', () => {
    expect(readOrbSettings()).toEqual(DEFAULT_ORB_SETTINGS);
  });

  it('merges partial saved settings with defaults', () => {
    initializeStorageForTests({
      iris_settings: JSON.stringify({
        ai_provider: 'anthropic',
        permissions_terminal: true,
        _permission_consent_v1: true,
      }),
    });

    const settings = readOrbSettings();
    expect(settings.ai_provider).toBe('anthropic');
    expect(settings.permissions_terminal).toBe(true);
    expect(settings.ai_model).toBe(DEFAULT_ORB_SETTINGS.ai_model);
  });

  it('preserves extra application settings', () => {
    initializeStorageForTests({
      iris_settings: JSON.stringify({
        custom_setting: { enabled: true },
      }),
    });

    expect(readOrbSettings().custom_setting).toEqual({ enabled: true });
  });

  it('ignores undefined saved values', () => {
    const settings = { ...DEFAULT_ORB_SETTINGS, ai_provider: undefined };
    writeOrbSettings(settings);
    expect(readOrbSettings().ai_provider).toBe(DEFAULT_ORB_SETTINGS.ai_provider);
  });

  it('normalizes non-object stored values', () => {
    initializeStorageForTests({ iris_settings: JSON.stringify('invalid') });
    expect(readOrbSettings()).toEqual(DEFAULT_ORB_SETTINGS);
  });

  it('writes normalized settings to the existing storage key', () => {
    writeOrbSettings({ ai_provider: 'gemini', additional: 'kept' });
    const stored = readOrbSettings();
    expect(stored.ai_provider).toBe('gemini');
    expect(stored.ai_model).toBe(DEFAULT_ORB_SETTINGS.ai_model);
    expect(stored.additional).toBe('kept');
    expect(localStorage.getItem('iris_settings')).toBeNull();
  });

  it('starts every broad capability blocked on a fresh install', () => {
    initializeStorageForTests();
    const settings = readOrbSettings();

    expect(settings.permissions_file_read).toBe(false);
    expect(settings.permissions_file_write).toBe(false);
    expect(settings.permissions_terminal).toBe(false);
    expect(settings.permissions_screen_capture).toBe(false);
    expect(settings.permissions_mouse_control).toBe(false);
    expect(settings.permissions_microphone).toBe(false);
    expect(settings.agent_block_sudo).toBe(true);
    expect(settings.agent_allow_network_commands).toBe(false);
  });

  it('revokes legacy implicit permissions once when no consent marker exists', () => {
    initializeStorageForTests({
      iris_settings: JSON.stringify({
        permissions_file_read: true,
        permissions_terminal: true,
        permissions_screen_capture: true,
      }),
    });

    const settings = readOrbSettings();
    expect(settings.permissions_file_read).toBe(false);
    expect(settings.permissions_terminal).toBe(false);
    expect(settings.permissions_screen_capture).toBe(false);
    expect(settings._permission_consent_v1).toBe(true);
  });

  it('migrates retired role settings once into agent_models and removes the old fields', () => {
    initializeStorageForTests({
      iris_settings: JSON.stringify({
        _permission_consent_v1: true,
        agent_role_assignment: {
          orchestrator: {
            provider: 'anthropic',
            model: 'claude-opus',
            keyId: '1',
          },
        },
        agent_role_models: {
          orchestrator: [{ provider: 'anthropic', model: 'claude-opus', keyId: '2' }],
        },
        agent_role_tags: { orchestrator: ['planner'] },
        agent_role_tags_disabled: { orchestrator: ['cheap'] },
      }),
    });

    const settings = readOrbSettings();
    expect(settings.agent_models).toEqual([
      expect.objectContaining({
        role: 'orchestrator',
        provider: 'anthropic',
        model: 'claude-opus',
        keyId: '1',
        primary: true,
        tags: ['planner'],
        disabledTags: ['cheap'],
      }),
      expect.objectContaining({
        role: 'orchestrator',
        provider: 'anthropic',
        model: 'claude-opus',
        keyId: '2',
        primary: false,
        tags: ['planner'],
        disabledTags: ['cheap'],
      }),
    ]);

    const persisted = readStorageJson<Record<string, unknown>>('iris_settings', {});
    expect(persisted.agent_models).toHaveLength(2);
    expect(persisted).not.toHaveProperty('agent_role_assignment');
    expect(persisted).not.toHaveProperty('agent_role_models');
    expect(persisted).not.toHaveProperty('agent_role_tags');
    expect(persisted).not.toHaveProperty('agent_role_tags_disabled');
  });

  it('maps approved permission keys into settings and bridge capabilities', () => {
    const patch = buildPersistentPermissionPatch([
      'file_read',
      'terminal_exec',
      'mouse_control',
      'microphone',
      'sudo',
      'network_commands',
    ]);
    const settings = { ...DEFAULT_ORB_SETTINGS, ...patch };

    expect(patch).toMatchObject({
      permissions_file_read: true,
      permissions_terminal: true,
      permissions_mouse_control: true,
      permissions_microphone: true,
      agent_block_sudo: false,
      agent_allow_network_commands: true,
    });
    expect(buildBridgePermissionState(settings)).toEqual({
      fileRead: true,
      fileWrite: false,
      terminal: true,
      launcher: true,
      automation: true,
      microphone: true,
    });
  });
});
