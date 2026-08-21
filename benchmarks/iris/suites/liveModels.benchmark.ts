/** Benchmarks IRIS's real local CLIP and Ollama models through production code paths. */

import { callLocalLLM } from '../../../src/platform/providers/localProvider.js';
import {
  createClipRawImages,
  embedClipPreparedImages,
  getClipRuntime,
  prepareClipPreparedVisionInputs,
  prepareClipVisionInputs,
  runClipVisionModel,
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
import { prepareBenchmarkModels, preparedModelAvailable } from '../core/localModels.js';
import type { BenchmarkDefinition, BenchmarkSkip } from '../core/types.js';

interface ClipContext {
  runtime: Awaited<ReturnType<typeof getClipRuntime>>;
  prepared: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    channels: 3;
  }>;
  rawImages: unknown[];
  inputs?: unknown;
}

interface OllamaContext {
  model: string;
  input: string[];
}

/** Creates one deterministic RGB batch after model preparation has completed outside timing. */
async function clipContext(
  batchSize: number,
  prepareInputs: boolean,
): Promise<ClipContext | BenchmarkSkip> {
  const models = await prepareBenchmarkModels();
  if (!preparedModelAvailable(models, 'Xenova/clip-vit-base-patch32')) {
    const model = models.find((entry) => entry.modelId === 'Xenova/clip-vit-base-patch32');
    return {
      skip: true,
      reason: model?.errorMessage || 'CLIP is unavailable.',
    };
  }
  const runtime = await getClipRuntime();
  const prepared = Array.from({ length: batchSize }, (_, index) => ({
    data: new Uint8Array(224 * 224 * 3).fill((index * 17) % 251),
    width: 224,
    height: 224,
    channels: 3 as const,
  }));
  const rawImages = createClipRawImages(prepared, runtime.RawImage);
  const inputs = prepareInputs
    ? await prepareClipPreparedVisionInputs(prepared, runtime)
    : undefined;
  return { runtime, prepared, rawImages, inputs };
}

/** Creates a local Ollama batch or returns a visible unavailable-model result. */
async function ollamaContext(
  model: string,
  batchSize: number,
): Promise<OllamaContext | BenchmarkSkip> {
  const models = await prepareBenchmarkModels();
  if (!preparedModelAvailable(models, model)) {
    const record = models.find((entry) => entry.modelId === model);
    return {
      skip: true,
      reason: record?.errorMessage || `Local model ${model} is unavailable.`,
    };
  }
  return {
    model,
    input: Array.from(
      { length: batchSize },
      (_, index) =>
        `IRIS local benchmark input ${index}. ${'semantic filesystem content '.repeat(18)}`,
    ),
  };
}

/** Sends one real embedding batch to the local Ollama service. */
async function embedWithOllama(context: OllamaContext): Promise<unknown> {
  const response = await fetch(`${FILE_OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: context.model,
      input: context.input,
      truncate: true,
      keep_alive: '10m',
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`Ollama embedding returned HTTP ${response.status}`);
  return response.json();
}

/** Builds the production-relevant CLIP processor, inference, and end-to-end batch matrix. */
function clipBenchmarks(): BenchmarkDefinition<any>[] {
  const definitions: BenchmarkDefinition<any>[] = [];
  for (const batchSize of [32, 128, 256, 512]) {
    definitions.push(
      {
        id: `models.clip.processor.${batchSize}`,
        suite: 'Real local models',
        name: `CLIP image processor · batch ${batchSize}`,
        description:
          'Runs the real Transformers.js processor that converts 224×224 RGB RawImage values into model tensors.',
        variantKey: `batch=${batchSize}`,
        parameters: { batchSize },
        iterations: batchSize >= 512 ? 3 : 5,
        warmupIterations: 1,
        operationsPerIteration: batchSize,
        tags: ['local-model'],
        setup: () => clipContext(batchSize, false),
        run: (context) => prepareClipVisionInputs(context.rawImages, context.runtime.processor),
      },
      {
        id: `models.clip.direct-tensor.${batchSize}`,
        suite: 'Real local models',
        name: `CLIP direct RGB tensor preparation · batch ${batchSize}`,
        description:
          'Converts worker-prepared 224×224 RGB bytes directly into the normalized NCHW tensor used by production indexing.',
        variantKey: `batch=${batchSize}`,
        parameters: { batchSize },
        iterations: batchSize >= 512 ? 3 : 5,
        warmupIterations: 1,
        operationsPerIteration: batchSize,
        tags: ['local-model'],
        setup: () => clipContext(batchSize, false),
        run: (context) => prepareClipPreparedVisionInputs(context.prepared, context.runtime),
      },
      {
        id: `models.clip.vision.${batchSize}`,
        suite: 'Real local models',
        name: `CLIP vision inference · batch ${batchSize}`,
        description:
          'Runs the actual ONNX vision projection model against production direct tensors prepared outside the measured section.',
        variantKey: `batch=${batchSize}`,
        parameters: { batchSize },
        iterations: batchSize >= 512 ? 3 : 5,
        warmupIterations: 1,
        operationsPerIteration: batchSize,
        tags: ['local-model'],
        setup: () => clipContext(batchSize, true),
        run: (context) => runClipVisionModel(context.inputs, context.runtime.visionModel),
      },
    );
  }
  for (const batchSize of [32, 128, 256, 512]) {
    definitions.push({
      id: `models.clip.end-to-end.${batchSize}`,
      suite: 'Real local models',
      name: `CLIP prepared-image embedding · batch ${batchSize}`,
      description:
        'Measures direct RGB tensor preparation, real ONNX inference, tensor conversion, and normalization together.',
      variantKey: `batch=${batchSize}`,
      parameters: { batchSize },
      iterations: batchSize >= 256 ? 3 : 5,
      warmupIterations: 1,
      operationsPerIteration: batchSize,
      tags: ['local-model'],
      setup: () => clipContext(batchSize, false),
      run: (context) => embedClipPreparedImages(context.prepared),
    });
  }
  return definitions;
}

/** Measures only local models; no cloud-provider transport is present in this suite. */
export const liveModelBenchmarks: BenchmarkDefinition<any>[] = [
  ...clipBenchmarks(),
  ...[1, 32, 128].map(
    (batchSize): BenchmarkDefinition<any> => ({
      id: `models.ollama.minilm.${batchSize}`,
      suite: 'Real local models',
      name: `Ollama MiniLM embedding · batch ${batchSize}`,
      description:
        'Measures the complete loopback HTTP and real Ollama embedding path used by text, document, and PDF indexing.',
      variantKey: `batch=${batchSize}`,
      parameters: { batchSize, model: FILE_EMBEDDING_MODEL },
      iterations: batchSize >= 128 ? 4 : 6,
      warmupIterations: 1,
      operationsPerIteration: batchSize,
      tags: ['local-model'],
      setup: () => ollamaContext(FILE_EMBEDDING_MODEL, batchSize),
      run: embedWithOllama,
    }),
  ),
  {
    id: 'models.ollama.launcher-embedding.32',
    suite: 'Real local models',
    name: 'Ollama launcher embedding · batch 32',
    description:
      'Measures the real local Qwen launcher embedding model through the loopback Ollama endpoint.',
    variantKey: 'batch=32',
    parameters: { batchSize: 32, model: LAUNCHER_EMBEDDING_MODEL },
    iterations: 5,
    warmupIterations: 1,
    operationsPerIteration: 32,
    tags: ['local-model'],
    setup: () => ollamaContext(LAUNCHER_EMBEDDING_MODEL, 32),
    run: async (context) => {
      const response = await fetch(`${LAUNCHER_OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: context.model,
          input: context.input,
          truncate: true,
          keep_alive: '10m',
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!response.ok)
        throw new Error(`Ollama launcher embedding returned HTTP ${response.status}`);
      return response.json();
    },
  },
  {
    id: 'models.ollama.analysis.chat',
    suite: 'Real local models',
    name: 'Ollama local analysis generation',
    description:
      'Measures one deterministic local chat generation through the fixed analysis model without image input or paid tokens.',
    parameters: { model: FILE_ANALYSIS_MODEL, outputTokens: 64 },
    iterations: 3,
    warmupIterations: 1,
    tags: ['local-model'],
    setup: () => ollamaContext(FILE_ANALYSIS_MODEL, 1),
    run: async (context) => {
      const response = await fetch(`${FILE_OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: context.model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: 'Return one short sentence describing semantic filesystem indexing.',
            },
          ],
          options: { temperature: 0, num_predict: 64 },
          keep_alive: '10m',
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!response.ok) throw new Error(`Ollama local chat returned HTTP ${response.status}`);
      return response.json();
    },
  },
  {
    id: 'models.local-provider.analysis.chat',
    suite: 'Real local models',
    name: 'Local provider adapter and Ollama generation',
    description:
      "Runs IRIS's production local-provider adapter, real loopback Ollama generation, usage normalization, and shared response shaping together.",
    parameters: { model: FILE_ANALYSIS_MODEL },
    iterations: 3,
    warmupIterations: 1,
    tags: ['local-model'],
    setup: () => ollamaContext(FILE_ANALYSIS_MODEL, 1),
    run: (context) =>
      callLocalLLM(
        [
          {
            role: 'user',
            content: 'Return one short sentence describing local benchmark isolation.',
          },
        ],
        FILE_OLLAMA_URL,
        context.model,
        fetch,
      ),
  },
];
