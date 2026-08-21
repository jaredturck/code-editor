import type { LocalHardwareProfile } from '@/platform/providers/localModelCatalog';

export type LocalModelFit = 'fits' | 'tight' | 'oversized' | 'unknown';

export interface LocalRuntimeEstimate {
  model: string;
  parameterBillions: number | null;
  quantization: string;
  estimatedMemoryGb: number | null;
  availableVramGb: number | null;
  fit: LocalModelFit;
}

const KNOWN_MODEL_MEMORY_GB: Record<string, number> = {
  'qwen3.6:27b': 17,
  'qwen3.5:9b': 6.6,
  'qwen3-coder:30b': 19,
};

const QUANTIZATION_BYTES_PER_PARAMETER: Record<string, number> = {
  q2: 0.4,
  q3: 0.5,
  q4: 0.65,
  q5: 0.8,
  q6: 0.95,
  q8: 1.15,
  f16: 2.1,
  fp16: 2.1,
  bf16: 2.1,
};

const DEFAULT_QUANTIZED_BYTES_PER_PARAMETER = 0.7;
const RUNTIME_OVERHEAD_RATIO = 1.15;
const VRAM_COMFORT_RATIO = 0.82;
const VRAM_HARD_RATIO = 0.94;

function normalized_model(model: unknown) {
  return String(model || '').trim().toLowerCase();
}

export function parseLocalModelParameterBillions(model: unknown): number | null {
  const value = normalized_model(model);
  const match = /(?:^|[-_:/.])([0-9]+(?:\.[0-9]+)?)b(?:[-_:/.]|$)/i.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseLocalModelQuantization(model: unknown): string {
  const value = normalized_model(model);
  const match = /(?:^|[-_:/.])(q[2-8](?:_[a-z0-9]+)?|fp16|f16|bf16)(?:[-_:/.]|$)/i.exec(value);
  if (!match) return '';
  const token = match[1].toLowerCase();
  return token.startsWith('q') ? token.slice(0, 2) : token;
}

export function estimateLocalModelMemoryGb(model: unknown): number | null {
  const value = normalized_model(model);
  if (!value) return null;

  const known = KNOWN_MODEL_MEMORY_GB[value];
  if (Number.isFinite(known)) return known;

  const parameters = parseLocalModelParameterBillions(value);
  if (!parameters) return null;
  const quantization = parseLocalModelQuantization(value);
  const bytesPerParameter =
    QUANTIZATION_BYTES_PER_PARAMETER[quantization] || DEFAULT_QUANTIZED_BYTES_PER_PARAMETER;
  return Math.round(parameters * bytesPerParameter * RUNTIME_OVERHEAD_RATIO * 10) / 10;
}

export function availableLocalVramGb(
  hardware: LocalHardwareProfile | null | undefined,
): number | null {
  const totalMb = Number(hardware?.gpuMemoryTotalMb || 0);
  if (!Number.isFinite(totalMb) || totalMb <= 0) return null;
  return Math.round((totalMb / 1024) * 10) / 10;
}

export function evaluateLocalRuntimeFit(
  model: unknown,
  hardware: LocalHardwareProfile | null | undefined,
): LocalRuntimeEstimate {
  const name = String(model || '').trim();
  const estimatedMemoryGb = estimateLocalModelMemoryGb(name);
  const availableVramGb = availableLocalVramGb(hardware);
  let fit: LocalModelFit = 'unknown';

  if (estimatedMemoryGb !== null && availableVramGb !== null) {
    if (estimatedMemoryGb <= availableVramGb * VRAM_COMFORT_RATIO) fit = 'fits';
    else if (estimatedMemoryGb <= availableVramGb * VRAM_HARD_RATIO) fit = 'tight';
    else fit = 'oversized';
  }

  return {
    model: name,
    parameterBillions: parseLocalModelParameterBillions(name),
    quantization: parseLocalModelQuantization(name),
    estimatedMemoryGb,
    availableVramGb,
    fit,
  };
}

export function localRuntimeFitScore(estimate: LocalRuntimeEstimate): number {
  if (estimate.fit === 'fits') return 35;
  if (estimate.fit === 'tight') return 5;
  if (estimate.fit === 'oversized') return -100;
  return 0;
}
