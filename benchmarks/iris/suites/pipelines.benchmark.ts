/** Benchmarks complete local indexing and launcher pipelines across model, encryption, and SQLite boundaries. */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { embedClipPreparedImages } from '../../../backend/desktopBridge/services/fileClipService.js';
import { prepareClipImage } from '../../../backend/desktopBridge/services/fileImagePreparation.js';
import {
  clearFileSemanticRuntimeCache,
  embedFileTexts,
  persistImageSemanticBatch,
} from '../../../backend/desktopBridge/services/fileSemanticService.js';
import {
  clearLauncherSemanticRuntimeCache,
  LAUNCHER_EMBEDDING_MODEL,
  searchLauncherSemanticIndex,
} from '../../../backend/desktopBridge/services/launcherSemanticService.js';
import {
  clearEncryptedFileIndex,
  saveEncryptedLauncherIndex,
  writeEncryptedFileSemantics,
  writeEncryptedFilesystemNodes,
  type EncryptedFilesystemNodeInput,
} from '../../../backend/desktopBridge/storage/encryptedDatabase.js';
import { createBenchmarkFixtureDirectory } from '../core/fixtures.js';
import { prepareBenchmarkModels, preparedModelAvailable } from '../core/localModels.js';
import type { BenchmarkDefinition, BenchmarkSkip } from '../core/types.js';

interface TextPipelineContext {
  inputs: string[];
  nodeIds: string[];
}

interface ImagePipelineContext {
  filePath: string;
  nodes: EncryptedFilesystemNodeInput[];
}

/** Builds one stable JPEG fixture reused by complete image pipeline measurements. */
async function ensurePipelineImageFixture(): Promise<string> {
  const root = await createBenchmarkFixtureDirectory('pipeline-image');
  const filePath = path.join(root, 'pipeline-source.jpg');
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > 1000) return filePath;
  } catch {
    // Create the fixture below.
  }
  const width = 1920;
  const height = 1080;
  const data = Buffer.alloc(width * height * 3);
  for (let index = 0; index < data.length; index += 3) {
    data[index] = (index / 3) % 251;
    data[index + 1] = (index / 7) % 241;
    data[index + 2] = (index / 13) % 239;
  }
  await sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 88 })
    .toFile(filePath);
  return filePath;
}

/** Prepares one real MiniLM-to-encrypted-SQLite workload with a bounded 64-file sample. */
async function textPipelineContext(): Promise<TextPipelineContext | BenchmarkSkip> {
  const models = await prepareBenchmarkModels();
  if (!preparedModelAvailable(models, 'all-minilm:22m')) {
    const model = models.find((entry) => entry.modelId === 'all-minilm:22m');
    return {
      skip: true,
      reason: model?.errorMessage || 'MiniLM is unavailable.',
    };
  }
  await clearEncryptedFileIndex();
  const root: EncryptedFilesystemNodeInput = {
    id: 'pipeline-text-root',
    parentId: null,
    nodeType: 'directory',
    contentKind: 'directory',
    sizeBytes: 0,
    modifiedAt: 1,
    indexedAt: 1,
    metadata: {
      name: 'Text pipeline',
      relativePath: '',
      sourceId: 'benchmark',
    },
  };
  const nodes: EncryptedFilesystemNodeInput[] = [root];
  const nodeIds: string[] = [];
  const inputs: string[] = [];
  for (let index = 0; index < 64; index += 1) {
    const id = `pipeline-text-${index}`;
    nodeIds.push(id);
    inputs.push(
      `File: benchmark-${index}.txt\nFolder: benchmark\n${'Representative semantic text content. '.repeat(24)}`,
    );
    nodes.push({
      id,
      parentId: root.id,
      nodeType: 'file',
      contentKind: 'text',
      sizeBytes: 4096,
      modifiedAt: index + 1,
      indexedAt: 1,
      metadata: {
        name: `benchmark-${index}.txt`,
        relativePath: `benchmark-${index}.txt`,
        sourceId: 'benchmark',
      },
    });
  }
  await writeEncryptedFilesystemNodes(nodes);
  return { inputs, nodeIds };
}

/** Prepares one real Sharp-to-CLIP-to-encrypted-SQLite image workload. */
async function imagePipelineContext(): Promise<ImagePipelineContext | BenchmarkSkip> {
  const models = await prepareBenchmarkModels();
  if (!preparedModelAvailable(models, 'Xenova/clip-vit-base-patch32')) {
    const model = models.find((entry) => entry.modelId === 'Xenova/clip-vit-base-patch32');
    return {
      skip: true,
      reason: model?.errorMessage || 'CLIP is unavailable.',
    };
  }
  await clearEncryptedFileIndex();
  const filePath = await ensurePipelineImageFixture();
  const root: EncryptedFilesystemNodeInput = {
    id: 'pipeline-image-root',
    parentId: null,
    nodeType: 'directory',
    contentKind: 'directory',
    sizeBytes: 0,
    modifiedAt: 1,
    indexedAt: 1,
    metadata: {
      name: 'Image pipeline',
      relativePath: '',
      sourceId: 'benchmark',
    },
  };
  const nodes: EncryptedFilesystemNodeInput[] = [root];
  for (let index = 0; index < 32; index += 1) {
    nodes.push({
      id: `pipeline-image-${index}`,
      parentId: root.id,
      nodeType: 'file',
      contentKind: 'image',
      sizeBytes: 1,
      modifiedAt: index + 1,
      indexedAt: 1,
      metadata: {
        name: `image-${index}.jpg`,
        relativePath: `image-${index}.jpg`,
        sourceId: 'benchmark',
      },
    });
  }
  await writeEncryptedFilesystemNodes(nodes);
  return { filePath, nodes: nodes.slice(1) };
}

/** Creates deterministic launcher applications whose query embedding is produced by the real model. */
async function launcherPipelineContext(): Promise<BenchmarkSkip | undefined> {
  const models = await prepareBenchmarkModels();
  if (!preparedModelAvailable(models, LAUNCHER_EMBEDDING_MODEL)) {
    const model = models.find((entry) => entry.modelId === LAUNCHER_EMBEDDING_MODEL);
    return {
      skip: true,
      reason: model?.errorMessage || 'Launcher embedding model is unavailable.',
    };
  }
  const applications = Array.from({ length: 256 }, (_, index) => ({
    id: `pipeline-launcher-${index}`,
    metadata: {
      name: `Benchmark Application ${index}`,
      description: index % 2 ? 'Code editor and developer tool' : 'Terminal and system utility',
      executable: `/usr/bin/benchmark-${index}`,
      args: [],
      categories: index % 2 ? ['Development'] : ['System'],
    },
    embedding: Array.from(
      { length: 1024 },
      (_, dimension) => Math.sin((index + 1) * (dimension + 1) * 0.001) / 32,
    ),
  }));
  await saveEncryptedLauncherIndex(
    {
      schemaVersion: 1,
      model: LAUNCHER_EMBEDDING_MODEL,
      applicationCount: applications.length,
      generatedAt: Date.now(),
    },
    applications,
  );
  await clearLauncherSemanticRuntimeCache();
  return undefined;
}

/** Measures complete representative pipelines rather than isolated wrappers alone. */
export const pipelineBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'pipeline.text.minilm-encrypt-sqlite.64',
    suite: 'Complete local pipelines',
    name: 'Text embedding to encrypted SQLite · 64 files',
    description:
      'Runs the production MiniLM embedding helper, constructs semantic rows, encrypts vectors and metadata, and commits them to SQLite.',
    variantKey: 'batch=64',
    parameters: { batchSize: 64 },
    iterations: 4,
    warmupIterations: 1,
    operationsPerIteration: 64,
    tags: ['local-model', 'database', 'filesystem'],
    setup: textPipelineContext,
    run: async (context, iteration) => {
      const embeddings = await embedFileTexts(context.inputs);
      await writeEncryptedFileSemantics(
        embeddings.map((embedding, index) => ({
          fileId: context.nodeIds[index],
          metadata: {
            semanticType: 'text',
            embeddingModel: 'all-minilm:22m',
            generatedAt: iteration,
          },
          embedding,
        })),
      );
      return embeddings;
    },
  },
  {
    id: 'pipeline.image.sharp-clip-encrypt-sqlite.32',
    suite: 'Complete local pipelines',
    name: 'Image preprocessing to encrypted SQLite · 32 images',
    description:
      'Runs real Sharp decode/resize work, real CLIP inference, semantic record construction, encryption, and SQLite persistence.',
    variantKey: 'batch=32',
    parameters: { batchSize: 32 },
    iterations: 3,
    warmupIterations: 1,
    operationsPerIteration: 32,
    tags: ['local-model', 'database', 'filesystem'],
    setup: imagePipelineContext,
    run: async (context: ImagePipelineContext) => {
      const prepared = await Promise.all(
        context.nodes.map(async (node: EncryptedFilesystemNodeInput) => ({
          node,
          image: await prepareClipImage(context.filePath),
        })),
      );
      const embeddings = await embedClipPreparedImages(prepared.map((item) => item.image));
      await persistImageSemanticBatch(prepared, embeddings);
      return embeddings;
    },
    teardown: () => clearFileSemanticRuntimeCache(),
  },
  {
    id: 'pipeline.launcher.query-model-decrypt-rank.256',
    suite: 'Complete local pipelines',
    name: 'Launcher query, decrypt, and rank · 256 applications',
    description:
      'Embeds a real local launcher query, decrypts the retained application vectors, calculates cosine scores, and returns ranked results.',
    variantKey: 'applications=256',
    parameters: { applications: 256 },
    iterations: 5,
    warmupIterations: 1,
    operationsPerIteration: 256,
    tags: ['local-model', 'database'],
    setup: launcherPipelineContext,
    run: () => searchLauncherSemanticIndex('open a terminal for software development', 20),
    teardown: () => clearLauncherSemanticRuntimeCache(),
  },
];
