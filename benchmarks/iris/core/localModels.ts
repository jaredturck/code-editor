/** Prepares the real local models used by IRIS without contacting paid remote providers. */

import { performance } from 'node:perf_hooks';
import {
  FILE_CLIP_MODEL,
  fileClipCacheDirectory,
  getClipRuntime,
  isFileClipModelInstalled,
} from '../../../backend/desktopBridge/services/fileClipService.js';
import {
  FILE_ANALYSIS_MODEL,
  FILE_EMBEDDING_MODEL,
  FILE_OLLAMA_URL,
} from '../../../backend/desktopBridge/services/fileSemanticService.js';
import {
  LAUNCHER_EMBEDDING_MODEL,
  LAUNCHER_OLLAMA_URL,
} from '../../../backend/desktopBridge/services/launcherSemanticService.js';
import type { BenchmarkModelInfo } from './types.js';

interface OllamaTagsPayload {
  models?: Array<{ name?: string; model?: string }>;
}

/** Normalizes Ollama model names for exact-name and tagged-name comparisons. */
function normalizedModelName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/** Checks whether one model name is present in Ollama's installed tag list. */
function modelIsInstalled(installed: Set<string>, model: string): boolean {
  const expected = normalizedModelName(model);
  return [...installed].some(
    (name) =>
      name === expected || name.startsWith(`${expected}:`) || name.startsWith(`${expected}@`),
  );
}

/** Reads local Ollama tags through the same loopback service used by the application. */
async function readOllamaModels(): Promise<Set<string>> {
  const response = await fetch(`${FILE_OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Ollama model listing returned HTTP ${response.status}`);
  const payload = (await response.json()) as OllamaTagsPayload;
  return new Set(
    (payload.models || [])
      .flatMap((entry) => [entry.name, entry.model])
      .map(normalizedModelName)
      .filter(Boolean),
  );
}

/** Pulls a missing model by asking the local Ollama service, never a paid provider endpoint. */
async function pullOllamaModel(model: string): Promise<number> {
  const startedAt = performance.now();
  const response = await fetch(`${FILE_OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false }),
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (!response.ok || payload.error) {
    throw new Error(
      `Ollama could not install ${model}: ${String(payload.error || `HTTP ${response.status}`)}`,
    );
  }
  return performance.now() - startedAt;
}

/** Ensures one fixed local Ollama model exists and records setup separately from benchmark timing. */
async function ensureOllamaModel(modelRole: string, modelId: string): Promise<BenchmarkModelInfo> {
  const result: BenchmarkModelInfo = {
    modelRole,
    runtime: 'ollama',
    modelId,
    backend: 'ollama-loopback',
    device: 'local',
    installedBeforeRun: false,
    downloadedDuringRun: false,
    available: false,
  };
  try {
    let installed = await readOllamaModels();
    result.installedBeforeRun = modelIsInstalled(installed, modelId);
    if (!result.installedBeforeRun) {
      result.downloadDurationMs = await pullOllamaModel(modelId);
      result.downloadedDuringRun = true;
      installed = await readOllamaModels();
    }
    result.available = modelIsInstalled(installed, modelId);
    if (!result.available) throw new Error(`Ollama did not report ${modelId} after installation`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errorMessage = `Local Ollama model ${modelId} is unavailable at ${FILE_OLLAMA_URL}: ${message}`;
  }
  return result;
}

/** Loads the existing production CLIP cache and records the actual CUDA or CPU execution path. */
async function prepareClipModel(): Promise<BenchmarkModelInfo> {
  const result: BenchmarkModelInfo = {
    modelRole: 'clip_image_and_text',
    runtime: 'transformers.js',
    modelId: FILE_CLIP_MODEL,
    modelPath: fileClipCacheDirectory(),
    backend: 'onnxruntime-node',
    installedBeforeRun: false,
    downloadedDuringRun: false,
    available: false,
  };
  try {
    result.installedBeforeRun = await isFileClipModelInstalled();
    if (!result.installedBeforeRun) {
      throw new Error(
        'The CLIP cache is missing. Remote network access is blocked during benchmarks; ' +
          'prepare the CLIP model through IRIS before running npm run benchmark.',
      );
    }
    const startedAt = performance.now();
    const runtime = await getClipRuntime();
    result.coldLoadDurationMs = performance.now() - startedAt;
    result.device = runtime.device;
    result.dtype = runtime.dtype;
    result.backend = runtime.backend;
    result.available = true;
    result.details = {
      ...(runtime.fallbackError ? { cudaFallbackError: runtime.fallbackError } : {}),
      visionLaneCount: runtime.visionLanes.length,
      visionDeviceIndices: runtime.visionLanes.map((lane) => lane.deviceIndex),
      ...(runtime.laneErrors?.length ? { laneErrors: runtime.laneErrors } : {}),
    };
  } catch (error) {
    result.errorMessage = error instanceof Error ? error.message : String(error);
  }
  return result;
}

let preparedModelsPromise: Promise<BenchmarkModelInfo[]> | null = null;

/** Prepares every fixed local model used by the comprehensive benchmark suite once per command. */
async function prepareBenchmarkModelsOnce(): Promise<BenchmarkModelInfo[]> {
  if (FILE_OLLAMA_URL !== LAUNCHER_OLLAMA_URL) {
    throw new Error('Benchmark model preparation expects one shared local Ollama endpoint');
  }
  // Pull missing Ollama models sequentially so first-time setup does not compete for
  // network, disk, and model-registry locks. Existing models only incur tag checks.
  const models: BenchmarkModelInfo[] = [];
  models.push(await ensureOllamaModel('file_text_embedding', FILE_EMBEDDING_MODEL));
  models.push(await ensureOllamaModel('file_analysis_and_local_generation', FILE_ANALYSIS_MODEL));
  models.push(await ensureOllamaModel('launcher_embedding', LAUNCHER_EMBEDDING_MODEL));
  models.push(await prepareClipModel());
  return models;
}

/** Returns the retained local-model preparation result shared by the runner and model suites. */
export function prepareBenchmarkModels(): Promise<BenchmarkModelInfo[]> {
  preparedModelsPromise ||= prepareBenchmarkModelsOnce();
  return preparedModelsPromise;
}

/** Returns whether one prepared model record is available for benchmark execution. */
export function preparedModelAvailable(models: BenchmarkModelInfo[], modelId: string): boolean {
  return models.some((model) => model.modelId === modelId && model.available);
}
