/**
 * Calculates and formats model token, context, cache, and cost information for Chat panel
 * usage views. It turns provider-neutral usage records into readable metrics without
 * changing the accounting data.
 */

import type { ChatMessage, ChatSettings } from '../types';

// Formats compact number for stable display or serialization without changing its underlying
// meaning.
export function formatCompactNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
  return `${Math.round(number)}`;
}

// Estimates tokens for policy or budgeting decisions in the chat presentation layer.
export function estimateTokens(text: unknown): number {
  const input = String(text || '');
  if (!input) return 0;
  return Math.max(1, Math.ceil(input.length / 4));
}

// Selects or derives context window estimate from the available settings, input, and runtime
// context.
export function resolveContextWindowEstimate(settings: ChatSettings): number {
  const provider = String(settings?.ai_provider || '').toLowerCase();
  const model = String(settings?.ai_model || '').toLowerCase();

  if (provider === 'gemini' || model.includes('gemini')) return 1_000_000;
  if (provider === 'anthropic' || model.includes('claude')) return 200_000;
  if (provider === 'openai' || provider === 'opencode' || /gpt|o1|o3|o4/.test(model))
    return 128_000;

  if (provider === 'local') {
    if (/\b(70b|405b|mixtral|qwen2?\.5|deepseek)\b/i.test(model)) return 65_536;
    if (/\b(13b|14b|32b|34b)\b/i.test(model)) return 32_768;
    return 16_384;
  }

  return 65_536;
}

// Assembles estimated usage from lower-level state so callers receive one consistent
// representation.
export function buildEstimatedUsage({
  messages,
  settings,
}: {
  messages: ChatMessage[];
  settings: ChatSettings;
}): Record<string, number | string | boolean> {
  const promptTokens = Array.isArray(messages)
    ? messages.reduce(
        (total, message) =>
          total + estimateTokens(`${message?.role || 'user'} ${message?.content || ''}`),
        0,
      )
    : 0;

  const completionTokens = Array.isArray(messages)
    ? messages
        .filter((message) => String(message?.role || '').toLowerCase() === 'assistant')
        .reduce((total, message) => total + estimateTokens(message?.content || ''), 0)
    : 0;

  const totalTokens = Math.max(promptTokens + completionTokens, 0);
  const contextWindow = resolveContextWindowEstimate(settings);
  const contextRemaining = Math.max(0, contextWindow - totalTokens);
  const requests = Math.max(1, Math.floor((Array.isArray(messages) ? messages.length : 0) / 2));

  return {
    provider: String(settings?.ai_provider || 'unknown'),
    model: String(settings?.ai_model || ''),
    promptTokens,
    completionTokens,
    totalTokens,
    requests,
    contextWindow,
    contextRemaining,
    estimatedCalls: requests,
    providerReportedCalls: 0,
    estimatedOnly: true,
  };
}
