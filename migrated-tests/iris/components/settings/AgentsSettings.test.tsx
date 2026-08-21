/**
 * Verifies custom agent model fields stay hidden until Other is selected.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    agent_models: [
      {
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-4o',
        keyId: '1',
        primary: true,
      },
      {
        role: 'executor',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        keyId: '1',
        primary: true,
      },
      {
        role: 'scout',
        provider: 'local',
        model: 'llama3',
        keyId: '1',
        primary: true,
      },
    ],
    discovered_models: {
      openai: ['gpt-4o'],
      anthropic: ['claude-sonnet-4-6'],
      local: ['llama3'],
    },
  },
  updateSettings: vi.fn(),
}));

const defaultSettings = structuredClone(mocks.settings);

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock('@/platform/aiService', () => ({
  discoverModelsForProvider: vi.fn(),
}));

import AgentsSettings from '@/components/settings/categories/AgentsSettings';

describe('AgentsSettings', () => {
  beforeEach(() => {
    mocks.settings = structuredClone(defaultSettings);
    mocks.updateSettings.mockReset();
  });

  it('shows custom model inputs only after Other is selected for each role', () => {
    render(<AgentsSettings activeSubTab="roles" onSubTabChange={vi.fn()} />);

    for (const role of ['Orchestrator', 'Executor', 'Scout']) {
      expect(screen.queryByLabelText(`${role} custom model ID`)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(`${role} model`), {
        target: { value: '__custom_model__' },
      });

      expect(screen.getByLabelText(`${role} custom model ID`)).toBeInTheDocument();
    }
  });

  it('keeps existing custom model IDs visible and editable', () => {
    mocks.settings = {
      ...defaultSettings,
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'openai',
          model: 'custom-orchestrator',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'anthropic',
          model: 'custom-executor',
          keyId: '1',
          primary: true,
        },
        {
          role: 'scout',
          provider: 'local',
          model: 'custom-scout',
          keyId: '1',
          primary: true,
        },
      ],
    };

    render(<AgentsSettings activeSubTab="roles" onSubTabChange={vi.fn()} />);

    expect(screen.getByLabelText('Orchestrator custom model ID')).toHaveValue(
      'custom-orchestrator',
    );
    expect(screen.getByLabelText('Executor custom model ID')).toHaveValue('custom-executor');
    expect(screen.getByLabelText('Scout custom model ID')).toHaveValue('custom-scout');
  });
});
