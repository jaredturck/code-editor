/**
 * providerRegistry.ts
 * Single registration point for AI provider identity, UI metadata, defaults,
 * invocation, and model discovery. Provider-specific request/streaming logic
 * remains in the individual adapter files.
 */

import { callAnthropic, listAnthropicModels } from '@/platform/providers/anthropicProvider';
import {
  callOpenAI,
  callOpenCode,
  getOpenCodeBaseUrl,
  listOpenAICompatibleModels,
  OPENAI_API_BASE_URL,
} from '@/platform/providers/openaiProvider';
import { callGemini, listGeminiModels } from '@/platform/providers/geminiProvider';
import { callDeepSeek, listDeepSeekModels } from '@/platform/providers/deepseekProvider';
import { callOpenRouter, OPENROUTER_API_BASE_URL } from '@/platform/providers/openrouterProvider';
import { callLocalLLM, listLocalModels } from '@/platform/providers/localProvider';
import type {
  AIProvider,
  AIProviderDefinition,
  AIProviderId,
  ProviderDiscoveryContext,
  ProviderInvokeContext,
} from '@/platform/providers/types';

export type { AIProvider, AIProviderDefinition, AIProviderId } from '@/platform/providers/types';

const OPENROUTER_HEADERS = Object.freeze({
  'HTTP-Referer': 'iris-agentics',
  'X-Title': 'IRIS',
});

const _providers: readonly AIProvider[] = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    label: 'Anthropic',
    color: '#C084FC',
    keyPlaceholder: 'sk-ant-api03-...',
    keyHelpUrl: 'https://platform.claude.com/settings/keys',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-4-6',
    models: Object.freeze([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
    ]),
    invoke: ({ messages, apiKey, model, settings, fetchFn, options }: ProviderInvokeContext) =>
      callAnthropic(messages, apiKey, model, settings, fetchFn, options),
    discoverModels: ({ apiKey, fetchFn }: ProviderDiscoveryContext) =>
      listAnthropicModels(apiKey, fetchFn),
  }),
  Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    color: '#4ADE80',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.openai.com/settings/organization/api-keys',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
    models: Object.freeze(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']),
    invoke: ({ messages, apiKey, model, fetchFn, options }: ProviderInvokeContext) =>
      callOpenAI(messages, apiKey, model, fetchFn, options),
    // Discovers models from the available provider or runtime capabilities.
    discoverModels: ({ apiKey, fetchFn }: ProviderDiscoveryContext) =>
      listOpenAICompatibleModels(
        {
          apiKey,
          baseUrl: OPENAI_API_BASE_URL,
        },
        fetchFn,
      ),
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Google Gemini',
    color: '#60A5FA',
    keyPlaceholder: 'AIza...',
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
    requiresApiKey: true,
    defaultModel: 'gemini-2.0-flash',
    models: Object.freeze(['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']),
    invoke: ({ messages, apiKey, model, fetchFn, options }: ProviderInvokeContext) =>
      callGemini(messages, apiKey, model, fetchFn, options),
    discoverModels: ({ apiKey, fetchFn }: ProviderDiscoveryContext) =>
      listGeminiModels(apiKey, fetchFn),
  }),
  Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    color: '#22D3EE',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    defaultModel: 'deepseek-v4-pro',
    models: Object.freeze(['deepseek-v4-pro', 'deepseek-v4-flash']),
    invoke: ({ messages, apiKey, model, fetchFn, options }: ProviderInvokeContext) =>
      callDeepSeek(messages, apiKey, model, fetchFn, options),
    discoverModels: ({ apiKey, fetchFn }: ProviderDiscoveryContext) =>
      listDeepSeekModels(apiKey, fetchFn),
  }),
  Object.freeze({
    id: 'opencode',
    label: 'OpenCode',
    color: '#34D399',
    keyPlaceholder: 'oc-...',
    keyHelpUrl: 'https://opencode.ai/auth',
    requiresApiKey: true,
    defaultModel: 'gpt-4o-mini',
    models: Object.freeze(['deepseek-coder-v2', 'gpt-4o-mini', 'claude-3-5-sonnet-latest']),
    invoke: ({ messages, apiKey, model, settings, fetchFn, options }: ProviderInvokeContext) =>
      callOpenCode(messages, apiKey, model, settings, fetchFn, options),
    // Discovers models from the available provider or runtime capabilities.
    discoverModels: ({ apiKey, settings, fetchFn }: ProviderDiscoveryContext) =>
      listOpenAICompatibleModels(
        {
          apiKey,
          baseUrl: getOpenCodeBaseUrl(settings),
        },
        fetchFn,
      ),
  }),
  Object.freeze({
    id: 'openrouter',
    label: 'OpenRouter',
    color: '#F59E0B',
    keyPlaceholder: 'sk-or-v1-...',
    keyHelpUrl: 'https://openrouter.ai/settings/keys',
    requiresApiKey: true,
    defaultModel: 'openai/gpt-4o',
    models: Object.freeze([
      'openai/gpt-4o',
      'anthropic/claude-3-5-sonnet',
      'google/gemini-1.5-pro',
      'deepseek/deepseek-coder',
    ]),
    invoke: ({ messages, apiKey, model, fetchFn, options }: ProviderInvokeContext) =>
      callOpenRouter(messages, apiKey, model, fetchFn, options),
    // Discovers models from the available provider or runtime capabilities.
    discoverModels: ({ apiKey, fetchFn }: ProviderDiscoveryContext) =>
      listOpenAICompatibleModels(
        {
          apiKey,
          baseUrl: OPENROUTER_API_BASE_URL,
          extraHeaders: OPENROUTER_HEADERS,
        },
        fetchFn,
      ),
  }),
  Object.freeze({
    id: 'local',
    label: 'Local (Ollama)',
    color: '#94A3B8',
    keyPlaceholder: null,
    keyHelpUrl: null,
    requiresApiKey: false,
    defaultModel: 'llama3',
    models: Object.freeze([
      'llama3',
      'llama3.2',
      'mistral',
      'codellama',
      'phi3',
      'gemma2',
      'deepseek-coder',
    ]),
    invoke: ({ messages, model, settings, fetchFn, options }: ProviderInvokeContext) =>
      callLocalLLM(messages, String(settings?.ai_local_url || ''), model, fetchFn, options),
    discoverModels: ({ settings, fetchFn }: ProviderDiscoveryContext) =>
      listLocalModels(String(settings?.ai_local_url || ''), fetchFn),
  }),
] satisfies readonly AIProvider[]);

const _providerMap = new Map<AIProviderId, AIProvider>();
for (const provider of _providers) {
  if (_providerMap.has(provider.id)) {
    throw new Error(`Duplicate AI provider registration: ${provider.id}`);
  }
  _providerMap.set(provider.id, provider);
}

export const AI_PROVIDER_DEFINITIONS: readonly AIProviderDefinition[] = Object.freeze(
  _providers.map((provider) =>
    Object.freeze({
      id: provider.id,
      label: provider.label,
      color: provider.color,
      keyPlaceholder: provider.keyPlaceholder,
      keyHelpUrl: provider.keyHelpUrl,
      requiresApiKey: provider.requiresApiKey,
      defaultModel: provider.defaultModel,
      models: provider.models,
    }),
  ),
);

export const DEFAULT_AI_PROVIDER_ID: AIProviderId = 'openai';
export const DEFAULT_AI_MODEL = _providerMap.get(DEFAULT_AI_PROVIDER_ID)!.defaultModel;

// Returns the available AI providers in the normalized form used by callers.
export function listAIProviders(): readonly AIProvider[] {
  return _providers;
}

// Returns the normalized definitions used to populate provider settings and lookups.
export function listAIProviderDefinitions(): readonly AIProviderDefinition[] {
  return AI_PROVIDER_DEFINITIONS;
}

// Determines whether a value names a registered AI provider.
export function isAIProviderId(value: unknown): value is AIProviderId {
  return _providerMap.has(String(value || '').toLowerCase() as AIProviderId);
}

// Provides find AI state and actions to descendant renderer components.
export function findAIProvider(value: unknown): AIProvider | null {
  return _providerMap.get(String(value || '').toLowerCase() as AIProviderId) || null;
}

// Returns the registered provider definition for the supplied provider ID.
export function getAIProvider(value: unknown): AIProvider {
  const provider = findAIProvider(value);
  if (provider) return provider;
  const valid = _providers.map((entry) => entry.id).join(', ');
  throw new Error(`Unknown AI provider "${String(value || '')}". Valid providers: ${valid}.`);
}
