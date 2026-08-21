/**
 * Verifies provider validation, curated model selection, and conditional custom inputs.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    ai_provider: 'local',
    ai_model: 'llama3',
    ai_local_url: 'http://localhost:11434',
    ai_opencode_url: 'https://opencode.ai/zen/v1',
    discovered_models: { local: ['llama3', 'qwen3'] },
    provider_selected_models: {},
    provider_key_validation: {
      local: {
        status: 'valid',
        testedAt: 1,
        message: 'Connected',
        models: ['llama3', 'qwen3'],
      },
    },
    local_runtime_kind: 'ollama',
  },
  updateSettings: vi.fn(),
  listStoredProviders: vi.fn(() => []),
}));

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock('@/platform/aiService', () => ({ testConnection: vi.fn() }));
vi.mock('@/platform/desktopBridge', () => ({
  cancelLocalOllamaModelPull: vi.fn(),
  discoverLocalAIServers: vi.fn(),
  getLocalOllamaModelPull: vi.fn(),
  startLocalOllamaModelPull: vi.fn(),
}));
vi.mock('@/platform/keyStore', () => ({
  clearKey: vi.fn(),
  getCredentialStorageStatus: () => ({
    persistent: true,
    backend: 'test-safe-storage',
  }),
  getKey: vi.fn(() => ''),
  listProviderKeys: vi.fn(() => ['1']),
  listStoredProviders: mocks.listStoredProviders,
  setKey: vi.fn(() => true),
}));

import ProvidersSection from '@/components/settings/ProvidersSection';

describe('ProvidersSection', () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.listStoredProviders.mockReset();
    mocks.listStoredProviders.mockReturnValue([]);
    mocks.settings.ai_provider = 'local';
    mocks.settings.ai_model = 'llama3';
    mocks.settings.discovered_models = { local: ['llama3', 'qwen3'] };
    mocks.settings.provider_selected_models = {};
    mocks.settings.provider_key_validation.local.models = ['llama3', 'qwen3'];
  });

  it('shows official key links only while provider key fields are empty', () => {
    render(<ProvidersSection availableModels={[]} setAvailableModels={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Get Anthropic API key' })).toHaveAttribute(
      'href',
      'https://platform.claude.com/settings/keys',
    );
    expect(screen.getByRole('link', { name: 'Get OpenAI API key' })).toHaveAttribute(
      'href',
      'https://platform.openai.com/settings/organization/api-keys',
    );
    expect(screen.getByRole('link', { name: 'Get Google Gemini API key' })).toHaveAttribute(
      'href',
      'https://aistudio.google.com/app/apikey',
    );
    expect(screen.getByRole('link', { name: 'Get DeepSeek API key' })).toHaveAttribute(
      'href',
      'https://platform.deepseek.com/api_keys',
    );
    expect(screen.getByRole('link', { name: 'Get OpenCode API key' })).toHaveAttribute(
      'href',
      'https://opencode.ai/auth',
    );
    expect(screen.getByRole('link', { name: 'Get OpenRouter API key' })).toHaveAttribute(
      'href',
      'https://openrouter.ai/settings/keys',
    );

    fireEvent.change(screen.getByPlaceholderText('sk-ant-api03-...'), {
      target: { value: 'temporary-key' },
    });

    expect(screen.queryByRole('link', { name: 'Get Anthropic API key' })).not.toBeInTheDocument();
  });

  it('adds installed local models to the curated list and hides manual input by default', () => {
    render(<ProvidersSection availableModels={['llama3', 'qwen3']} setAvailableModels={vi.fn()} />);

    expect(screen.queryByLabelText('Local custom model ID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Local model catalog'));
    fireEvent.click(screen.getByRole('option', { name: /^qwen3 Installed$/i }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_selected_models: { local: ['qwen3'] },
        ai_provider: 'local',
        ai_model: 'qwen3',
      }),
    );
  });

  it('keeps the first local model as the active agent model when adding another local model', () => {
    mocks.settings.provider_selected_models = { local: ['qwen3.5:9b'] };
    render(
      <ProvidersSection
        availableModels={['qwen3.5:9b', 'qwen3.6:latest']}
        setAvailableModels={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Local model catalog'));
    fireEvent.click(screen.getByRole('option', { name: /^qwen3\.6:latest Installed$/i }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_selected_models: { local: ['qwen3.5:9b', 'qwen3.6:latest'] },
        agent_required_local_model: 'qwen3.5:9b',
        ai_provider: 'local',
        ai_model: 'qwen3.5:9b',
      }),
    );
  });

  it('reveals manual local model input only after Other is selected', () => {
    render(<ProvidersSection availableModels={['llama3']} setAvailableModels={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Local model catalog'));
    fireEvent.click(screen.getByRole('option', { name: /Other \/ Custom model ID/i }));
    expect(screen.getByLabelText('Local custom model ID')).toBeInTheDocument();
  });
});
