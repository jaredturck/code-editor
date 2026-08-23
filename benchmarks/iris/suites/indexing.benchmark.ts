/** Benchmarks the independently callable boundaries that make up the eight-stage file index. */

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  createClipRawImages,
  normalizeClipEmbeddings,
} from '../../../backend/desktopBridge/services/fileClipService.js'
import { extractDocumentText } from '../../../backend/desktopBridge/services/fileDocumentService.js'
import { prepareClipImage } from '../../../backend/desktopBridge/services/fileImagePreparation.js'
import { trainConceptCentroids } from '../../../backend/desktopBridge/services/fileConceptMath.js'
import { extractPdfText } from '../../../backend/desktopBridge/services/filePdfService.js'
import {
  appendVideoFrameSemanticRecords,
  createExtractedSemanticRecords,
  createImageSemanticRecords,
  createVideoFrameWorkItems,
  countEligibleFilesystemEntries,
} from '../../../backend/desktopBridge/services/fileSemanticService.js'
import {
  calculateVideoFrameBudget,
  calculateVideoThumbnailTimestamp,
  videoProbeTimestamps,
} from '../../../backend/desktopBridge/services/fileVideoService.js'
import {
  createDocxFixture,
  createFilesystemFixture,
  createPdfFixture,
  createBenchmarkFixtureDirectory,
  retainBenchmarkFixture,
} from '../core/fixtures.js'
import type { BenchmarkDefinition } from '../core/types.js'

interface DocumentContext {
  root: string
  filePath: string
  signal: AbortSignal
}

interface ImageContext {
  root: string
  filePath: string
}

interface ClipContext {
  prepared: Array<{
    data: Uint8Array
    width: number
    height: number
    channels: 3
  }>
  tensor: { tolist: () => number[][] }
  RawImage: new (data: Uint8Array, width: number, height: number, channels: number) => unknown
}

/** Creates an extracted document fixture and cancellation signal outside measured samples. */
async function documentContext(extension: 'docx' | 'pdf'): Promise<DocumentContext> {
  const root = await createBenchmarkFixtureDirectory(extension)
  const filePath = path.join(root, `sample.${extension}`)
  await fs.writeFile(filePath, extension === 'docx' ? createDocxFixture() : createPdfFixture())
  return { root, filePath, signal: new AbortController().signal }
}

/** Creates a moderately large source image whose production path must decode and crop it. */
async function imageContext(): Promise<ImageContext> {
  const root = await createBenchmarkFixtureDirectory('image')
  const filePath = path.join(root, 'source.jpg')
  const width = 2048
  const height = 1536
  const data = Buffer.alloc(width * height * 3)
  for (let index = 0; index < data.length; index += 3) {
    data[index] = (index / 3) % 251
    data[index + 1] = (index / 9) % 241
    data[index + 2] = (index / 27) % 239
  }
  await sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 88 })
    .toFile(filePath)
  return { root, filePath }
}

/** Creates deterministic synthetic CLIP inputs without loading model weights for offline runs. */
function clipContext(batchSize: number): ClipContext {
  class BenchmarkRawImage {
    constructor(
      readonly data: Uint8Array,
      readonly width: number,
      readonly height: number,
      readonly channels: number,
    ) {}
  }
  const prepared = Array.from({ length: batchSize }, (_, index) => ({
    data: new Uint8Array(224 * 224 * 3).fill(index % 251),
    width: 224,
    height: 224,
    channels: 3 as const,
  }))
  const tensorRows = Array.from({ length: batchSize }, (_, row) =>
    Array.from({ length: 512 }, (_, column) => ((row + column) % 127) / 127),
  )
  const tensor = { tolist: () => tensorRows }
  return {
    prepared,
    tensor,
    RawImage: BenchmarkRawImage,
  }
}

/** Creates structurally valid file nodes and embeddings for record-construction benchmarks. */
function semanticContext(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    node: {
      id: `node-${index}`,
      parentId: 'root',
      nodeType: 'file' as const,
      contentKind: 'image' as const,
      sizeBytes: 150_528,
      modifiedAt: index + 1,
      indexedAt: 1,
      metadata: {
        name: `image-${index}.jpg`,
        relativePath: `images/${index}.jpg`,
      },
    },
    image: {
      data: new Uint8Array(224 * 224 * 3),
      width: 224,
      height: 224,
      channels: 3 as const,
    },
  }))
  const embeddings = Array.from({ length: count }, (_, index) =>
    Array.from({ length: 512 }, (_, dimension) => ((index + dimension) % 97) / 97),
  )
  return { items, embeddings }
}

/** Measures each index-stage boundary without requiring models or external network services. */
export const indexingBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'index.stage1.preflight-scan',
    suite: 'Indexing stages',
    name: 'Stage 1 · Filesystem preflight scan',
    description:
      'Traverses and counts a deterministic 403-file tree using the production exclusion and mount-boundary rules.',
    iterations: 6,
    warmupIterations: 1,
    setup: () => createFilesystemFixture({ directories: 20, filesPerDirectory: 20 }),
    run: (context) =>
      countEligibleFilesystemEntries(
        [
          {
            id: 'benchmark',
            label: 'Benchmark fixture',
            path: context.root,
            kind: 'home',
            filesystem: 'fixture',
            device: 'fixture',
            size: 0,
            uuid: 'benchmark',
            removable: false,
            network: false,
            readOnly: false,
            available: true,
            alwaysSelected: true,
            selectedByDefault: true,
          },
        ],
        [],
      ),
    teardown: (context) => retainBenchmarkFixture(context.root),
  },
  {
    id: 'index.stage3.document-extraction.docx',
    suite: 'Indexing stages',
    name: 'Stage 3 · DOCX streaming extraction',
    description:
      'Opens the ZIP lazily and parses only the content-bearing Word XML until the bounded text target is reached.',
    iterations: 10,
    warmupIterations: 2,
    setup: () => documentContext('docx'),
    run: (context) => extractDocumentText(context.filePath, context.signal),
    teardown: (context) => retainBenchmarkFixture(context.root),
  },
  {
    id: 'index.stage4.pdf-extraction',
    suite: 'Indexing stages',
    name: 'Stage 4 · Searchable PDF extraction',
    description:
      'Uses the production ranged PDF.js transport and sequential text-layer extraction on a one-page fixture.',
    iterations: 8,
    warmupIterations: 2,
    setup: () => documentContext('pdf'),
    run: (context) => extractPdfText(context.filePath, context.signal),
    teardown: (context) => retainBenchmarkFixture(context.root),
  },
  {
    id: 'index.stage5.sharp-preparation',
    suite: 'Indexing stages',
    name: 'Stage 5 · Sharp decode and CLIP resize',
    description:
      'Decodes a 2048×1536 JPEG, applies orientation, crops to 224×224, converts to RGB, and creates a transferable buffer.',
    iterations: 10,
    warmupIterations: 2,
    setup: imageContext,
    run: (context) => prepareClipImage(context.filePath),
    teardown: (context) => retainBenchmarkFixture(context.root),
  },
  {
    id: 'index.stage5.clip-raw-image.512',
    suite: 'Indexing stages',
    name: 'Stage 5 · CLIP RawImage wrapping · 512',
    description: 'Wraps already-prepared RGB buffers in the exact RawImage boundary used before processor execution.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 512,
    setup: () => clipContext(512),
    run: (context) => createClipRawImages(context.prepared, context.RawImage),
  },
  {
    id: 'index.stage5.clip-normalization.512',
    suite: 'Indexing stages',
    name: 'Stage 5 · CLIP tensor conversion and normalization · 512',
    description: 'Converts 512 synthetic 512-dimensional rows and normalizes every vector in JavaScript.',
    iterations: 10,
    warmupIterations: 3,
    operationsPerIteration: 512,
    setup: () => clipContext(512),
    run: (context) => normalizeClipEmbeddings(context.tensor, 512),
  },
  {
    id: 'index.stage5.semantic-records.512',
    suite: 'Indexing stages',
    name: 'Stage 5 · Image semantic record construction · 512',
    description: 'Builds the metadata and embedding records passed from CLIP inference into encrypted persistence.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 512,
    setup: () => semanticContext(512),
    run: (context) => createImageSemanticRecords(context.items, context.embeddings, 1),
  },
  {
    id: 'index.stage2-4.extracted-records.512',
    suite: 'Indexing stages',
    name: 'Stages 2–4 · Extracted-text semantic records · 512',
    description: 'Builds persisted MiniLM records while preserving document and PDF extraction metadata.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 512,
    setup: () => {
      const group = Array.from({ length: 512 }, (_, index) => ({
        node: { id: `text-${index}` },
        input: `File ${index} semantic input`,
        metadata: {
          semanticType: 'document',
          sourceType: 'docx',
          sourceModifiedAt: index,
        },
      }))
      const embeddings = Array.from({ length: 512 }, () => [0.5, 0.5])
      return { group, embeddings }
    },
    run: (context) => createExtractedSemanticRecords(context.group, context.embeddings, 1),
  },
  {
    id: 'index.stage6.video-sampling-plan',
    suite: 'Indexing stages',
    name: 'Stage 6 · Long-video sampling plan',
    description: 'Calculates frame budget, probe timestamps, and thumbnail position for a four-hour video.',
    iterations: 15,
    warmupIterations: 4,
    operationsPerIteration: 1000,
    run: () => {
      let result: unknown
      for (let index = 0; index < 1000; index += 1) {
        const duration = 14_400 + index
        result = {
          budget: calculateVideoFrameBudget(duration),
          probes: videoProbeTimestamps(duration),
          thumbnail: calculateVideoThumbnailTimestamp(duration),
        }
      }
      return result
    },
  },
  {
    id: 'index.stage6.video-records.96',
    suite: 'Indexing stages',
    name: 'Stage 6 · Video-frame semantic records · 96',
    description: 'Reconnects CLIP results to sampled timestamps and creates independently searchable frame records.',
    iterations: 12,
    warmupIterations: 3,
    operationsPerIteration: 96,
    setup: () => {
      const node = semanticContext(1).items[0].node
      const frames = Array.from({ length: 96 }, (_, index) => ({
        timestampMs: index * 10_000,
        image: {
          data: new Uint8Array(224 * 224 * 3),
          width: 224,
          height: 224,
          channels: 3 as const,
        },
      }))
      const { workItems, frameByImage } = createVideoFrameWorkItems(node, frames)
      const embeddings = Array.from({ length: 96 }, () => Array(512).fill(1 / Math.sqrt(512)))
      return { workItems, frameByImage, embeddings }
    },
    run: (context) => {
      const records: any[] = []
      appendVideoFrameSemanticRecords({
        records,
        successful: context.workItems,
        embeddings: context.embeddings,
        frameByImage: context.frameByImage,
        durationMs: 960_000,
        generatedAt: 1,
      })
      return records
    },
  },
  {
    id: 'index.stage7.concept-training',
    suite: 'Indexing stages',
    name: 'Stage 7 · Spherical concept training',
    description: 'Runs four deterministic spherical k-means iterations over 1,024 normalized 512-dimensional vectors.',
    iterations: 6,
    warmupIterations: 1,
    operationsPerIteration: 1024,
    setup: () => {
      const vectors = new Float32Array(1024 * 512)
      for (let index = 0; index < vectors.length; index += 1) {
        vectors[index] = Math.sin(index * 0.017) + Math.cos(index * 0.013)
      }
      return { vectors }
    },
    run: (context, iteration) => trainConceptCentroids(context.vectors.slice(), 512, 16, 4, 17 + iteration),
  },
]
