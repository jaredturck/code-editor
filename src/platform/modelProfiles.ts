// @ts-check
/**
 * modelProfiles.js
 * Central per-model capability registry — the single source of truth for HOW the
 * runtime should talk to each model family: tool-call format, prompt caching,
 * streaming, structured output, reasoning behaviour, output-token limits, and
 * context window.
 *
 * Families come from skillProfiles.inferModelFamily(). Prompt caching is derived
 * from the provider (Anthropic = explicit cache_control, OpenAI = automatic,
 * Gemini = implicit, OpenRouter = passthrough, local = none).
 *
 * These are DEFAULTS / best guesses. Per the "probe once, prefer native" policy,
 * a model's real native-tool support should be confirmed by an actual call and
 * cached; the registry only seeds that decision.
 *
 * Field reference (per family):
 *   toolProtocol     'native' = provider function-calling | 'json' = text-JSON fallback
 *   streaming        provider API can stream tokens (adapter implements separately)
 *   structuredOutput 'json_schema' | 'response_schema' | 'tools' | 'grammar' | 'none'
 *   reasoning        model deliberates internally → don't inject manual CoT scaffolding
 *   maxOutputTokens  DEFAULT per-call output cap when the user hasn't set one
 *   maxOutputCeiling true API max the user may raise the cap to (the "heavy work"
 *                    ceiling — resolveMaxOutputTokens clamps any override to this)
 *   contextWindow    total context window in tokens
 *
 * Heavy-work note (2026-06): the old flat 16K Anthropic cap silently truncated big
 * tool calls (a comprehensive report streamed inside an artifact.create/files.write
 * argument) at the output limit, producing empty args ("never entered information").
 * Defaults were raised across every provider, and `agent_max_output_tokens` lets the
 * user push the cap up to each model's real ceiling (Opus/Fable 128K, Sonnet 64K).
 */
import { inferModelFamily } from '@/platform/skillProfiles';
import type { ModelCapabilities } from '@/platform/agent/types';

export interface ModelProfileSettings {
  ai_provider?: unknown;
  ai_model?: unknown;
  agent_max_output_tokens?: unknown;
}

type CapabilityDefaults = Omit<ModelCapabilities, 'family' | 'provider' | 'caching'>;
type FamilyCapabilityOverrides = Partial<CapabilityDefaults>;

const DEFAULT_CONTEXT_WINDOW = 65536;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const DEFAULT_CAPABILITIES: CapabilityDefaults = {
  toolProtocol: 'json',
  streaming: true,
  structuredOutput: 'none',
  reasoning: false,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxOutputCeiling: DEFAULT_MAX_OUTPUT_TOKENS,
  contextWindow: DEFAULT_CONTEXT_WINDOW,
};

// Keyed by inferModelFamily() output. Anything not listed falls back to DEFAULT.
// maxOutputTokens = the DEFAULT cap; maxOutputCeiling = the most the user may raise
// it to via `agent_max_output_tokens`. Both raised from the old conservative values
// so heavy work (long reports written through a tool argument) no longer truncates.
const FAMILY_CAPABILITIES: Record<string, FamilyCapabilityOverrides> = {
  // ── Anthropic ──────────────────────────────────────────────────────────────
  // Opus 4.8 / Sonnet 4.6 are 1M-context. Default = the model's FULL output ceiling
  // (streaming is on by default, so the HTTP-timeout risk of large max_tokens is
  // moot). resolveMaxOutputTokens clamps the 128000 default to each model's real max
  // via resolveOutputCeiling (Opus/Fable 128K, Sonnet/Haiku 64K) so it never 400s.
  claude: {
    toolProtocol: 'native',
    structuredOutput: 'tools',
    maxOutputTokens: 128000,
    maxOutputCeiling: 128000,
    contextWindow: 1000000,
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  gpt4o: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 16384,
    contextWindow: 128000,
  },
  gpt4: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 32768,
    contextWindow: 128000,
  },
  gpt35: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 4096,
    maxOutputCeiling: 4096,
    contextWindow: 16384,
  },
  gpt: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 32768,
    contextWindow: 128000,
  },
  'gpt-oss': {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    reasoning: true,
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 131072,
  },
  'openai-o': {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    reasoning: true,
    maxOutputTokens: 65536,
    maxOutputCeiling: 100000,
    contextWindow: 200000,
  },

  // ── NVIDIA / Nemotron ────────────────────────────────────────────────────────
  nemotron: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    reasoning: true,
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 1000000,
  },

  // ── Google ─────────────────────────────────────────────────────────────────
  gemini2: {
    toolProtocol: 'native',
    structuredOutput: 'response_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 65536,
    contextWindow: 1000000,
  },
  gemini15: {
    toolProtocol: 'native',
    structuredOutput: 'response_schema',
    maxOutputTokens: 8192,
    maxOutputCeiling: 8192,
    contextWindow: 1000000,
  },
  gemini: {
    toolProtocol: 'native',
    structuredOutput: 'response_schema',
    maxOutputTokens: 8192,
    maxOutputCeiling: 8192,
    contextWindow: 1000000,
  },

  // ── Meta / Llama ─────────────────────────────────────────────────────────────
  llama3: {
    toolProtocol: 'native',
    structuredOutput: 'grammar',
    maxOutputTokens: 16384,
    maxOutputCeiling: 16384,
    contextWindow: 131072,
  },
  llama: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 8192,
    maxOutputCeiling: 8192,
    contextWindow: 8192,
  },

  // ── Mistral ──────────────────────────────────────────────────────────────────
  codestral: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 32768,
  },
  mistral: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 32768,
  },
  mixtral: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 16384,
    contextWindow: 32768,
  },

  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  'deepseek-r1': {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    reasoning: true,
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 65536,
  },
  'deepseek-v4': {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    reasoning: true,
    maxOutputTokens: 65536,
    maxOutputCeiling: 384000,
    contextWindow: 1000000,
  },
  deepseek: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 16384,
    maxOutputCeiling: 16384,
    contextWindow: 131072,
  },

  // ── Alibaba / Qwen ───────────────────────────────────────────────────────────
  qwen35: {
    toolProtocol: 'native',
    structuredOutput: 'tools',
    reasoning: true,
    maxOutputTokens: 8192,
    maxOutputCeiling: 16384,
    contextWindow: 32768,
  },
  qwen25: {
    toolProtocol: 'native',
    structuredOutput: 'grammar',
    maxOutputTokens: 16384,
    maxOutputCeiling: 16384,
    contextWindow: 32768,
  },
  qwen: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 8192,
    contextWindow: 32768,
  },

  // ── Microsoft / Phi (small, usually local) ───────────────────────────────────
  phi4: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 8192,
    contextWindow: 16384,
  },
  phi3: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 8192,
    contextWindow: 16384,
  },
  phi: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 4096,
    contextWindow: 8192,
  },

  // ── Google / Gemma (small, usually local) ────────────────────────────────────
  gemma3: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 8192,
    contextWindow: 8192,
  },
  gemma: {
    toolProtocol: 'json',
    structuredOutput: 'grammar',
    maxOutputTokens: 4096,
    maxOutputCeiling: 8192,
    contextWindow: 8192,
  },

  // ── xAI / Cohere ─────────────────────────────────────────────────────────────
  grok: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 32768,
    maxOutputCeiling: 32768,
    contextWindow: 131072,
  },
  cohere: {
    toolProtocol: 'native',
    structuredOutput: 'json_schema',
    maxOutputTokens: 8192,
    maxOutputCeiling: 8192,
    contextWindow: 128000,
  },
};

function _cachingForProvider(provider: unknown): ModelCapabilities['caching'] {
  switch (String(provider || '').toLowerCase()) {
    case 'anthropic':
      return 'explicit';
    case 'openai':
    case 'deepseek':
    case 'opencode':
      return 'auto';
    case 'gemini':
      return 'implicit';
    case 'openrouter':
      return 'passthrough';
    case 'local':
      return 'none';
    default:
      return 'none';
  }
}

export function getModelCapabilities(provider: unknown, model: unknown): ModelCapabilities {
  const family = inferModelFamily(model || '');
  const base = FAMILY_CAPABILITIES[family] || {};
  return {
    ...DEFAULT_CAPABILITIES,
    ...base,
    family,
    provider: String(provider || '').toLowerCase(),
    caching: _cachingForProvider(provider),
  };
}

export function resolveOutputCeiling(model: unknown, provider: unknown): number {
  const caps = getModelCapabilities(provider, model);
  const m = String(model || '').toLowerCase();

  if (caps.family === 'claude') {
    if (/opus|fable|mythos/.test(m)) return 128000;
    if (/sonnet|haiku/.test(m)) return 64000;
    return 64000;
  }

  return caps.maxOutputCeiling || caps.maxOutputTokens;
}

export function resolveMaxOutputTokens(
  model: unknown,
  provider: unknown,
  settings?: ModelProfileSettings,
): number {
  const caps = getModelCapabilities(provider, model);
  const ceiling = resolveOutputCeiling(model, provider);

  const override = Number(settings && settings.agent_max_output_tokens);
  if (Number.isFinite(override) && override > 0) {
    return Math.max(1024, Math.min(ceiling, Math.round(override)));
  }

  return Math.min(ceiling, caps.maxOutputTokens);
}

export function resolveContextWindow(settings: ModelProfileSettings = {}): number {
  const provider = String(settings?.ai_provider || '').toLowerCase();
  const model = String(settings?.ai_model || '');

  if (provider === 'local') {
    const m = model.toLowerCase();
    if (/\b(70b|405b|mixtral|qwen2?\.5|deepseek)\b/i.test(m)) return 65536;
    if (/\b(13b|14b|32b|34b)\b/i.test(m)) return 32768;
    return 16384;
  }

  return getModelCapabilities(provider, model).contextWindow;
}

export function supportsNativeTools(provider: unknown, model: unknown): boolean {
  return getModelCapabilities(provider, model).toolProtocol === 'native';
}

export function isReasoningModel(provider: unknown, model: unknown): boolean {
  return getModelCapabilities(provider, model).reasoning === true;
}
