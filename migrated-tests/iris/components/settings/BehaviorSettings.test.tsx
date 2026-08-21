/**
 * Verifies the Behavior screen exposes the current runtime controls instead of obsolete
 * reasoning-step settings.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    agent_session_minutes: 15,
    context_budget_warn_ratio: 0.15,
    agent_safety_profile: 'strict',
    agent_finish_open_todos: true,
    agent_replay_enabled: true,
    agent_replay_max_runs: 40,
    agent_max_steps: 12,
    agent_auto_extend_steps: true,
  } as Record<string, unknown>,
  updateSettings: vi.fn(),
}));

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

import BehaviorSettings from '@/components/settings/categories/BehaviorSettings';

describe('BehaviorSettings', () => {
  beforeEach(() => mocks.updateSettings.mockReset());

  it('shows time and context controls without obsolete step limits', () => {
    render(<BehaviorSettings activeSubTab="agent" onSubTabChange={vi.fn()} />);

    expect(screen.getByText('Session check-in')).toBeInTheDocument();
    expect(screen.getByText('Context compaction threshold')).toBeInTheDocument();
    expect(screen.getByText('Background model health check')).toBeInTheDocument();
    // Cloud and consultation budgets live in Agents settings, not in this Behavior panel.
    expect(screen.queryByText('Max cloud requests / task')).not.toBeInTheDocument();
    expect(screen.queryByText('Max steps per session')).not.toBeInTheDocument();
    expect(screen.queryByText('Adaptive step budget')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto-extend steps')).not.toBeInTheDocument();
  });
});
