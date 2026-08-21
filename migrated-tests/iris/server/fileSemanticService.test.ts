/**
 * Covers the staged semantic filesystem index: classified tree persistence, plain text,
 * documents, PDFs, calibrated MiniLM/CLIP embeddings, ranking, and rescans.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxFixture, pdfFixture } from '../fixtures/documentFixtures';

const thumbnail = vi.hoisted(() => ({
  create: vi.fn(async () => ({
    dataUrl: 'data:image/png;base64,dGlueQ==',
    width: 224,
    height: 224,
    modifiedAt: 1,
  })),
}));

vi.mock('../../server/desktopBridge/services/fileBrowserService.js', () => ({
  createFileThumbnail: thumbnail.create,
}));

/** Keeps semantic-index tests scoped to their temporary home fixture instead of mounted drives. */
vi.mock('../../server/desktopBridge/services/fileIndexSourceService.js', () => ({
  discoverFileIndexSources: vi.fn(async (homePath: string) => [
    {
      id: 'home',
      label: 'Home',
      path: await fs.realpath(homePath),
      kind: 'home',
      filesystem: '',
      device: '',
      size: 0,
      uuid: '',
      removable: false,
      network: false,
      readOnly: false,
      available: true,
      alwaysSelected: true,
      selectedByDefault: true,
    },
  ]),
  resolveSelectedFileIndexSources: vi.fn(async (homePath: string) => {
    const source = {
      id: 'home',
      label: 'Home',
      path: await fs.realpath(homePath),
      kind: 'home',
      filesystem: '',
      device: '',
      size: 0,
      uuid: '',
      removable: false,
      network: false,
      readOnly: false,
      available: true,
      alwaysSelected: true,
      selectedByDefault: true,
    };
    return { sources: [source], discovered: [source] };
  }),
  fileIndexSourcesFromMeta: (meta: Record<string, unknown> | null) =>
    Array.isArray(meta?.sources) ? meta.sources : [],
}));

const clip = vi.hoisted(() => ({
  installed: true,
  install: vi.fn(async () => undefined),
  clear: vi.fn(() => undefined),
  embedPrepared: vi.fn(async (images: Array<{ data: Uint8Array }>) =>
    images.map((image) =>
      image.data[0] === 1 ? [1, 0, ...Array(510).fill(0)] : [0, 1, ...Array(510).fill(0)],
    ),
  ),
  embedText: vi.fn(async (text: string) =>
    text.toLowerCase().includes('cat')
      ? [1, 0, ...Array(510).fill(0)]
      : [0, 1, ...Array(510).fill(0)],
  ),
}));

vi.mock('../../server/desktopBridge/services/fileClipService.js', () => ({
  FILE_CLIP_MODEL: 'Xenova/clip-vit-base-patch32',
  FILE_CLIP_DEFAULT_BATCH_SIZE: 256,
  isFileClipModelInstalled: vi.fn(async () => clip.installed),
  installFileClipModel: clip.install,
  clearFileClipRuntime: clip.clear,
  embedClipPreparedImages: clip.embedPrepared,
  embedClipText: clip.embedText,
}));

const documentExtraction = vi.hoisted(() => ({
  extract: vi.fn(),
}));

vi.mock('../../server/desktopBridge/services/fileDocumentService.js', () => ({
  extractDocumentText: documentExtraction.extract,
}));

const pdfExtraction = vi.hoisted(() => ({
  extract: vi.fn(),
}));

vi.mock('../../server/desktopBridge/services/filePdfService.js', () => ({
  extractPdfText: pdfExtraction.extract,
}));

const extractionPool = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
}));

vi.mock('../../server/desktopBridge/services/fileExtractionPool.js', () => ({
  createFileExtractionPool: () => ({
    workerCount: 4,
    extract: (kind: 'document' | 'pdf', filePath: string) =>
      kind === 'pdf'
        ? pdfExtraction.extract(filePath, new AbortController().signal)
        : documentExtraction.extract(filePath, new AbortController().signal),
    close: extractionPool.close,
  }),
}));

const imageProcessing = vi.hoisted(() => ({
  prepare: vi.fn(async (filePath: string) => ({
    data: new Uint8Array([filePath.toLowerCase().includes('cat') ? 1 : 2]),
    width: 224,
    height: 224,
    channels: 3 as const,
  })),
  close: vi.fn(async () => undefined),
}));

vi.mock('../../server/desktopBridge/services/fileImageProcessingPool.js', () => ({
  createFileImageProcessingPool: () => ({
    workerCount: 8,
    prepare: imageProcessing.prepare,
    close: imageProcessing.close,
  }),
}));

const imageQueueBudget = vi.hoisted(() => ({
  resolve: vi.fn(async () => 320),
}));

vi.mock('../../server/desktopBridge/services/fileImageQueueBudget.js', () => ({
  resolvePreparedImageQueueCapacity: imageQueueBudget.resolve,
}));

const videoExtraction = vi.hoisted(() => ({
  available: vi.fn(async () => undefined),
  extract: vi.fn(
    async (): Promise<{
      durationMs: number;
      frames: Array<{
        timestampMs: number;
        image: {
          data: Uint8Array;
          width: number;
          height: number;
          channels: 3;
        };
      }>;
    }> => ({ durationMs: 0, frames: [] }),
  ),
}));

vi.mock('../../server/desktopBridge/services/fileVideoService.js', () => ({
  ensureVideoIndexingAvailable: videoExtraction.available,
  extractVideoFramesForIndex: videoExtraction.extract,
}));

const conceptBuilder = vi.hoisted(() => ({
  build: vi.fn(),
}));

vi.mock('../../server/desktopBridge/services/fileConceptService.js', () => ({
  FILE_CONCEPT_INDEX_VERSION: 1,
  rebuildFileConceptIndex: conceptBuilder.build,
}));

interface MockNode {
  id: string;
  parentId: string | null;
  nodeType: 'file' | 'directory';
  contentKind: 'directory' | 'text' | 'document' | 'pdf' | 'image' | 'video' | 'binary';
  sizeBytes: number;
  modifiedAt: number;
  indexedAt: number;
  metadata: Record<string, unknown>;
}

const storage = vi.hoisted(() => ({
  meta: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  nodes: new Map<string, MockNode>(),
  semantics: new Map<
    string,
    { fileId: string; metadata: Record<string, unknown>; embedding: number[] }
  >(),
  videoSemantics: new Map<
    string,
    {
      semanticId: string;
      fileId: string;
      timestampMs: number;
      metadata: Record<string, unknown>;
      embedding: number[];
    }
  >(),
  concepts: new Map<
    string,
    {
      id: string;
      generation: string;
      embeddingSpace: 'minilm' | 'clip';
      metadata: Record<string, unknown>;
      centroid: Float32Array;
      memberCount: number;
      cohesion: number;
    }
  >(),
  conceptMemberships: new Map<
    string,
    {
      conceptId: string;
      generation: string;
      fileId: string;
      sourceSemanticId: string;
      timestampMs?: number;
      similarity: number;
    }
  >(),
}));

vi.mock('../../server/desktopBridge/storage/encryptedDatabase.js', () => ({
  clearEncryptedFileIndex: vi.fn(async () => {
    storage.meta = null;
    storage.nodes.clear();
    storage.semantics.clear();
    storage.videoSemantics.clear();
    storage.concepts.clear();
    storage.conceptMemberships.clear();
  }),
  writeEncryptedFileIndexMeta: vi.fn(async (meta: Record<string, unknown>) => {
    storage.meta = meta;
  }),
  readEncryptedFileIndexMeta: vi.fn(async () => storage.meta),
  writeEncryptedFileEmbeddingProfile: vi.fn(async (profile: Record<string, unknown>) => {
    storage.profile = profile;
  }),
  readEncryptedFileEmbeddingProfile: vi.fn(async () => storage.profile),
  writeEncryptedFilesystemNodes: vi.fn(async (nodes: MockNode[]) => {
    for (const node of nodes) storage.nodes.set(node.id, node);
  }),
  readEncryptedFilesystemNodes: vi.fn(async () => [...storage.nodes.values()]),
  readEncryptedFilesystemNodePage: vi.fn(
    async (options: {
      contentKind: string;
      indexedAt?: number;
      minSizeBytes?: number;
      afterId?: string;
      limit: number;
      orderBySize?: boolean;
    }) => {
      let nodes = [...storage.nodes.values()].filter(
        (node) =>
          node.nodeType === 'file' &&
          node.contentKind === options.contentKind &&
          node.sizeBytes >= Number(options.minSizeBytes || 0) &&
          (typeof options.indexedAt !== 'number' || node.indexedAt === options.indexedAt),
      );
      if (options.orderBySize) {
        nodes.sort(
          (left, right) => right.sizeBytes - left.sizeBytes || left.id.localeCompare(right.id),
        );
      } else {
        nodes.sort((left, right) => left.id.localeCompare(right.id));
        if (options.afterId) {
          nodes = nodes.filter((node) => node.id > String(options.afterId));
        }
      }
      return nodes.slice(0, options.limit);
    },
  ),
  countEncryptedFilesystemNodes: vi.fn(
    async (options: { contentKind: string; indexedAt?: number }) =>
      [...storage.nodes.values()].filter(
        (node) =>
          node.nodeType === 'file' &&
          node.contentKind === options.contentKind &&
          (typeof options.indexedAt !== 'number' || node.indexedAt === options.indexedAt),
      ).length,
  ),
  writeEncryptedFileSemantics: vi.fn(
    async (
      records: Array<{
        fileId: string;
        metadata: Record<string, unknown>;
        embedding: number[];
      }>,
    ) => {
      for (const record of records) storage.semantics.set(record.fileId, record);
    },
  ),
  readEncryptedFileSemantics: vi.fn(async () => [...storage.semantics.values()]),
  writeEncryptedVideoFrameSemantics: vi.fn(
    async (
      records: Array<{
        semanticId: string;
        fileId: string;
        timestampMs: number;
        metadata: Record<string, unknown>;
        embedding: number[];
      }>,
    ) => {
      for (const record of records) storage.videoSemantics.set(record.semanticId, record);
    },
  ),
  readEncryptedVideoFrameSemantics: vi.fn(async () => [...storage.videoSemantics.values()]),
  readEncryptedFileConcepts: vi.fn(async (generation: string) =>
    [...storage.concepts.values()].filter((concept) => concept.generation === generation),
  ),
  readEncryptedFileConceptMemberships: vi.fn(
    async (conceptIds: string[], limitPerConcept: number) => {
      const result = [];
      for (const conceptId of conceptIds) {
        result.push(
          ...[...storage.conceptMemberships.values()]
            .filter((membership) => membership.conceptId === conceptId)
            .sort((left, right) => right.similarity - left.similarity)
            .slice(0, limitPerConcept),
        );
      }
      return result;
    },
  ),
  deleteEncryptedFileConceptGenerationsExcept: vi.fn(async (generation: string) => {
    for (const [id, concept] of storage.concepts) {
      if (concept.generation !== generation) storage.concepts.delete(id);
    }
    for (const [key, membership] of storage.conceptMemberships) {
      if (membership.generation !== generation) storage.conceptMemberships.delete(key);
    }
  }),
  deleteEncryptedFileSemantics: vi.fn(async (fileIds: string[]) => {
    for (const fileId of fileIds) {
      storage.semantics.delete(fileId);
      for (const [semanticId, record] of storage.videoSemantics) {
        if (record.fileId === fileId) storage.videoSemantics.delete(semanticId);
      }
      for (const [key, membership] of storage.conceptMemberships) {
        if (membership.fileId === fileId) storage.conceptMemberships.delete(key);
      }
    }
  }),
  deleteEncryptedFilesystemNodes: vi.fn(async (nodeIds: string[]) => {
    const pending = [...nodeIds];
    while (pending.length) {
      const id = String(pending.pop() || '');
      for (const node of storage.nodes.values()) {
        if (node.parentId === id) pending.push(node.id);
      }
      storage.nodes.delete(id);
      storage.semantics.delete(id);
      for (const [semanticId, record] of storage.videoSemantics) {
        if (record.fileId === id) storage.videoSemantics.delete(semanticId);
      }
      for (const [key, membership] of storage.conceptMemberships) {
        if (membership.fileId === id) storage.conceptMemberships.delete(key);
      }
    }
  }),
}));

const temporaryRoots: string[] = [];

function ollamaResponse(data: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => '',
  };
}

function mockOllama() {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/api/tags')) {
      return ollamaResponse({
        models: [{ name: 'qwen3-vl:4b-instruct' }, { name: 'all-minilm:22m' }],
      });
    }
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(String(options?.body || '{}'));
      const prompt = String(body.messages?.[0]?.content || '');
      let content = 'A photograph of a cat sleeping on a sofa indoors.';
      if (prompt.includes('Analyze this complete image file')) {
        content = '## Image analysis\n\nA cat is sleeping indoors.';
      } else if (prompt.includes('Analyze the complete contents')) {
        content = '## File analysis\n\nThe complete file is explained.';
      } else if (prompt.includes('Analyze section')) {
        content = 'Section details from the complete file.';
      } else if (prompt.includes('Combine these section analyses')) {
        content = '## Combined analysis\n\nThe complete large file is explained.';
      }
      return ollamaResponse({ message: { content } });
    }
    if (url.endsWith('/api/embed')) {
      const body = JSON.parse(String(options?.body || '{}'));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return ollamaResponse({
        embeddings: inputs.map((value: unknown) =>
          String(value || '')
            .toLowerCase()
            .includes('calculator')
            ? [1, 0]
            : [0, 1],
        ),
      });
    }
    throw new Error(`Unexpected Ollama request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function waitForIndex(
  service: typeof import('../../server/desktopBridge/services/fileSemanticService'),
  root: string,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = await service.getFileSemanticStatus(root, false);
    if (status.indexStatus === 'ready') return status;
    if (status.indexStatus === 'error') {
      throw new Error(status.error || 'index failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for semantic filesystem index');
}

beforeEach(() => {
  storage.meta = null;
  storage.profile = null;
  storage.nodes.clear();
  storage.semantics.clear();
  storage.videoSemantics.clear();
  storage.concepts.clear();
  storage.conceptMemberships.clear();
  vi.restoreAllMocks();
  thumbnail.create.mockClear();
  clip.installed = true;
  clip.install.mockClear();
  clip.clear.mockClear();
  clip.embedPrepared.mockClear();
  clip.embedText.mockClear();
  documentExtraction.extract.mockReset();
  documentExtraction.extract.mockImplementation(async () => ({
    text: 'Office document semantic content',
    sourceType: 'docx',
    extractionMethod: 'streaming-docx',
  }));
  pdfExtraction.extract.mockReset();
  extractionPool.close.mockClear();
  imageProcessing.prepare.mockReset();
  imageProcessing.prepare.mockImplementation(async (filePath: string) => ({
    data: new Uint8Array([filePath.toLowerCase().includes('cat') ? 1 : 2]),
    width: 224,
    height: 224,
    channels: 3 as const,
  }));
  imageProcessing.close.mockClear();
  imageQueueBudget.resolve.mockClear();
  imageQueueBudget.resolve.mockResolvedValue(320);
  videoExtraction.available.mockClear();
  videoExtraction.extract.mockReset();
  videoExtraction.extract.mockImplementation(async () => ({
    durationMs: 0,
    frames: [],
  }));
  conceptBuilder.build.mockReset();
  conceptBuilder.build.mockImplementation(
    async ({
      generation,
      onProgress,
    }: {
      generation: string;
      onProgress: (value: {
        phase: string;
        completed: number;
        total: number;
        conceptCount: number;
        workerCount: number;
      }) => void;
    }) => {
      const grouped = new Map<
        string,
        Array<{
          fileId: string;
          sourceSemanticId: string;
          timestampMs?: number;
          embedding: number[];
          space: 'minilm' | 'clip';
        }>
      >();
      for (const semantic of storage.semantics.values()) {
        const space = semantic.metadata.semanticType === 'image' ? 'clip' : 'minilm';
        const strongest = semantic.embedding[0] >= semantic.embedding[1] ? 0 : 1;
        const key = `${space}:${strongest}`;
        const records = grouped.get(key) || [];
        records.push({
          fileId: semantic.fileId,
          sourceSemanticId: semantic.fileId,
          embedding: semantic.embedding,
          space,
        });
        grouped.set(key, records);
      }
      for (const semantic of storage.videoSemantics.values()) {
        const strongest = semantic.embedding[0] >= semantic.embedding[1] ? 0 : 1;
        const key = `clip:${strongest}`;
        const records = grouped.get(key) || [];
        records.push({
          fileId: semantic.fileId,
          sourceSemanticId: semantic.semanticId,
          timestampMs: semantic.timestampMs,
          embedding: semantic.embedding,
          space: 'clip',
        });
        grouped.set(key, records);
      }
      let conceptCount = 0;
      let miniLmConceptCount = 0;
      let clipConceptCount = 0;
      for (const [key, records] of grouped) {
        const uniqueFiles = new Set(records.map((record) => record.fileId));
        if (uniqueFiles.size < 2) continue;
        const id = `concept_${generation}_${conceptCount}`;
        const centroid = new Float32Array(records[0].embedding);
        const space = records[0].space;
        storage.concepts.set(id, {
          id,
          generation,
          embeddingSpace: space,
          metadata: { key },
          centroid,
          memberCount: uniqueFiles.size,
          cohesion: 1,
        });
        for (const record of records) {
          storage.conceptMemberships.set(`${id}:${record.fileId}`, {
            conceptId: id,
            generation,
            fileId: record.fileId,
            sourceSemanticId: record.sourceSemanticId,
            timestampMs: record.timestampMs,
            similarity: 1,
          });
        }
        conceptCount += 1;
        if (space === 'minilm') miniLmConceptCount += 1;
        else clipConceptCount += 1;
      }
      onProgress({
        phase: 'Assigning files to concepts',
        completed: storage.semantics.size + storage.videoSemantics.size,
        total: Math.max(1, storage.semantics.size + storage.videoSemantics.size),
        conceptCount,
        workerCount: 4,
      });
      return {
        generation,
        conceptCount,
        miniLmConceptCount,
        clipConceptCount,
        sourceVectorCount: storage.semantics.size + storage.videoSemantics.size,
        workerCount: 4,
      };
    },
  );
  pdfExtraction.extract.mockImplementation(async () => ({
    text: 'PDF semantic content',
    sourceType: 'pdf',
    extractionMethod: 'pdfjs-ranged-pages',
    pagesRead: 1,
  }));
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('file semantic service', () => {
  it('classifies the tree once and embeds compact text representations with MiniLM', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-index-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'project'));
    await fs.writeFile(
      path.join(root, 'project', 'calculator.py'),
      'def calculate(left, right):\n    return left + right\n',
    );
    await fs.writeFile(path.join(root, 'cat.png'), Buffer.from('fake image bytes'));
    await fs.writeFile(path.join(root, 'archive.bin'), Buffer.from([0, 1, 2, 3]));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'dependency.js'), 'ignored');
    const fetchMock = mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    const status = await waitForIndex(service, root);

    expect(status).toMatchObject({
      indexStatus: 'ready',
      embeddingModel: 'all-minilm:22m',
      fileCount: 3,
      semanticCount: 2,
      failedCount: 0,
    });
    const nodesByName = new Map(
      [...storage.nodes.values()].map((node) => [node.metadata.name, node]),
    );
    expect(nodesByName.get('calculator.py')?.contentKind).toBe('text');
    expect(nodesByName.get('cat.png')?.contentKind).toBe('image');
    expect(nodesByName.get('archive.bin')?.contentKind).toBe('binary');
    expect(nodesByName.has('dependency.js')).toBe(false);
    expect(
      [...storage.semantics.values()].map((record) => record.metadata.semanticType).sort(),
    ).toEqual(['image', 'text']);
    expect(imageProcessing.prepare).toHaveBeenCalledWith(path.join(root, 'cat.png'));
    expect(clip.embedPrepared).toHaveBeenCalled();
    expect(thumbnail.create).not.toHaveBeenCalled();

    const chatBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/chat'))
      .map(([, options]) => JSON.parse(String(options?.body || '{}')));
    expect(chatBodies).toHaveLength(0);

    const embedBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/embed'))
      .map(([, options]) => JSON.parse(String(options?.body || '{}')));
    expect(embedBodies.every((body) => body.model === 'all-minilm:22m')).toBe(true);
    expect(
      embedBodies.some((body) =>
        (Array.isArray(body.input) ? body.input : [body.input]).some((input: unknown) => {
          const text = String(input);
          return (
            text.includes('File: calculator.py') &&
            text.includes('Folder: project') &&
            text.includes('def calculate(left, right): return left + right')
          );
        }),
      ),
    ).toBe(true);

    const calculatorResults = await service.searchFileSemanticIndex(
      'calculator app in Python',
      5,
      'text',
    );
    expect(calculatorResults[0]).toMatchObject({
      name: 'calculator.py',
      semanticType: 'text',
    });

    const imageResults = await service.searchFileSemanticIndex('cat', 5, 'image');
    expect(imageResults[0]).toMatchObject({
      name: 'cat.png',
      semanticType: 'image',
    });
  });

  it('reports document progress after each completed extraction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-document-progress-'));
    temporaryRoots.push(root);
    const fastPath = path.join(root, 'fast-document');
    const slowPath = path.join(root, 'slow-document');
    await fs.writeFile(fastPath, docxFixture('Fast document phrase'));
    await fs.writeFile(slowPath, docxFixture('Slow document phrase'));

    let releaseSlowDocument: () => void = () => {};
    let markSlowDocumentStarted: () => void = () => {};
    const slowDocumentStarted = new Promise<void>((resolve) => {
      markSlowDocumentStarted = resolve;
    });
    const slowDocumentRelease = new Promise<void>((resolve) => {
      releaseSlowDocument = resolve;
    });
    documentExtraction.extract.mockImplementation(async (filePath: string) => {
      if (filePath === slowPath) {
        markSlowDocumentStarted();
        await slowDocumentRelease;
      }
      return {
        text: 'Office document semantic content',
        sourceType: 'docx',
        extractionMethod: 'streaming-docx',
      };
    });

    mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await slowDocumentStarted;
    await vi.waitFor(async () => {
      const status = await service.getFileSemanticStatus(root, false);
      expect(status).toMatchObject({
        indexStatus: 'building',
        stage: 'Stage 3 of 8 · Extracting and embedding documents',
        stageProcessed: 1,
        stageIndexed: 1,
        stageFileTotal: 2,
        stageWorkerCount: 4,
      });
    });

    releaseSlowDocument();
    await waitForIndex(service, root);
  });

  it('runs documents and PDFs as distinct content-based indexing stages', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-document-stages-'));
    temporaryRoots.push(root);
    const documentPath = path.join(root, 'office-package');
    const pdfPath = path.join(root, 'portable-document.data');
    await fs.writeFile(documentPath, docxFixture('Office stage phrase'));
    await fs.writeFile(pdfPath, pdfFixture('PDF stage phrase'));

    let releaseDocument: () => void = () => {};
    let markDocumentStarted: () => void = () => {};
    const documentStarted = new Promise<void>((resolve) => {
      markDocumentStarted = resolve;
    });
    const documentRelease = new Promise<void>((resolve) => {
      releaseDocument = resolve;
    });
    documentExtraction.extract.mockImplementationOnce(async () => {
      markDocumentStarted();
      await documentRelease;
      return {
        text: 'Office stage phrase',
        sourceType: 'docx',
        extractionMethod: 'streaming-docx',
      };
    });

    let releasePdf: () => void = () => {};
    let markPdfStarted: () => void = () => {};
    const pdfStarted = new Promise<void>((resolve) => {
      markPdfStarted = resolve;
    });
    const pdfRelease = new Promise<void>((resolve) => {
      releasePdf = resolve;
    });
    pdfExtraction.extract.mockImplementationOnce(async () => {
      markPdfStarted();
      await pdfRelease;
      return {
        text: 'PDF stage phrase',
        sourceType: 'pdf',
        extractionMethod: 'pdfjs-ranged-pages',
        pagesRead: 1,
      };
    });

    mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await documentStarted;
    expect(await service.getFileSemanticStatus(root, false)).toMatchObject({
      indexStatus: 'building',
      stage: 'Stage 3 of 8 · Extracting and embedding documents',
    });

    releaseDocument();
    await pdfStarted;
    expect(await service.getFileSemanticStatus(root, false)).toMatchObject({
      indexStatus: 'building',
      stage: 'Stage 4 of 8 · Extracting and embedding PDF files',
    });

    releasePdf();
    const status = await waitForIndex(service, root);
    expect(status).toMatchObject({
      indexStatus: 'ready',
      semanticCount: 2,
      failedCount: 0,
    });

    const nodesByName = new Map(
      [...storage.nodes.values()].map((node) => [node.metadata.name, node]),
    );
    expect(nodesByName.get('office-package')?.contentKind).toBe('document');
    expect(nodesByName.get('portable-document.data')?.contentKind).toBe('pdf');
    expect(documentExtraction.extract).toHaveBeenCalledWith(documentPath, expect.any(AbortSignal));
    expect(pdfExtraction.extract).toHaveBeenCalledWith(pdfPath, expect.any(AbortSignal));

    const semanticsByName = new Map(
      [...storage.semantics.values()].map((record) => [
        storage.nodes.get(record.fileId)?.metadata.name,
        record,
      ]),
    );
    expect(semanticsByName.get('office-package')?.metadata).toMatchObject({
      semanticType: 'text',
      sourceKind: 'document',
      documentType: 'docx',
      extractionMethod: 'streaming-docx',
    });
    expect(semanticsByName.get('portable-document.data')?.metadata).toMatchObject({
      semanticType: 'text',
      sourceKind: 'pdf',
      documentType: 'pdf',
      extractionMethod: 'pdfjs-ranged-pages',
      pagesRead: 1,
    });
  });

  it('normalizes MiniLM and CLIP score distributions before mixed ranking', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-normalization-'));
    temporaryRoots.push(root);
    await Promise.all([
      fs.writeFile(path.join(root, 'text-a.txt'), 'anime character notes'),
      fs.writeFile(path.join(root, 'text-b.txt'), 'character design notes'),
      fs.writeFile(path.join(root, 'text-c.txt'), 'general notes'),
      fs.writeFile(path.join(root, 'anime.png'), Buffer.from('image one')),
      fs.writeFile(path.join(root, 'portrait.png'), Buffer.from('image two')),
      fs.writeFile(path.join(root, 'landscape.png'), Buffer.from('image three')),
    ]);
    const fetchMock = mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await waitForIndex(service, root);

    const scoresByName = new Map([
      ['text-a.txt', 0.6],
      ['text-b.txt', 0.59],
      ['text-c.txt', 0.58],
      ['anime.png', 0.35],
      ['portrait.png', 0.05],
      ['landscape.png', 0],
    ]);
    for (const semantic of storage.semantics.values()) {
      const name = String(storage.nodes.get(semantic.fileId)?.metadata.name || '');
      const score = Number(scoresByName.get(name) || 0);
      const length = semantic.metadata.semanticType === 'image' ? 512 : 2;
      semantic.embedding = [
        score,
        Math.sqrt(Math.max(0, 1 - score ** 2)),
        ...Array(Math.max(0, length - 2)).fill(0),
      ];
    }
    await service.clearFileSemanticRuntimeCache();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/embed')) {
        return ollamaResponse({ embeddings: [[1, 0]] });
      }
      if (url.endsWith('/api/tags')) {
        return ollamaResponse({
          models: [{ name: 'qwen3-vl:4b-instruct' }, { name: 'all-minilm:22m' }],
        });
      }
      throw new Error(`Unexpected Ollama request: ${url}`);
    });
    clip.embedText.mockResolvedValue([1, 0, ...Array(510).fill(0)]);

    const mixed = await service.searchFileSemanticIndex('anime girl', 6);
    const topText = mixed.find((result) => result.semanticType === 'text')!;

    expect(mixed[0]).toMatchObject({
      name: 'anime.png',
      semanticType: 'image',
    });
    expect(mixed[0].rawScore).toBeLessThan(topText.rawScore!);
    expect(mixed[0].score).toBeGreaterThan(topText.score);

    const images = await service.searchFileSemanticIndex('anime girl', 6, 'image');
    expect(images).toHaveLength(3);
    expect(images.every((result) => result.semanticType === 'image')).toBe(true);

    const text = await service.searchFileSemanticIndex('anime girl', 6, 'text');
    expect(text).toHaveLength(3);
    expect(text.every((result) => result.semanticType === 'text')).toBe(true);
  });

  it('stores independent video-frame embeddings and returns the best matching timestamp', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-video-index-'));
    temporaryRoots.push(root);
    const videoPath = path.join(root, 'holiday.mp4');
    await fs.writeFile(videoPath, Buffer.from('fake video bytes'));
    mockOllama();
    videoExtraction.extract.mockImplementation(async () => ({
      durationMs: 20_000,
      frames: [
        {
          timestampMs: 5_000,
          image: {
            data: new Uint8Array([2]),
            width: 224,
            height: 224,
            channels: 3 as const,
          },
        },
        {
          timestampMs: 15_000,
          image: {
            data: new Uint8Array([3]),
            width: 224,
            height: 224,
            channels: 3 as const,
          },
        },
      ],
    }));
    clip.embedPrepared.mockImplementation(async (images) =>
      images.map((image) =>
        image.data[0] === 3 ? [0, 0, 1, ...Array(509).fill(0)] : [0, 1, 0, ...Array(509).fill(0)],
      ),
    );
    clip.embedText.mockImplementation(async (text: string) =>
      text.toLowerCase().includes('lamborghini')
        ? [0, 0, 1, ...Array(509).fill(0)]
        : [0, 1, 0, ...Array(509).fill(0)],
    );
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    const status = await waitForIndex(service, root);

    expect(status).toMatchObject({
      indexStatus: 'ready',
      semanticCount: 2,
      failedCount: 0,
    });
    expect(storage.videoSemantics).toHaveLength(2);
    const results = await service.searchFileSemanticIndex('Lamborghini', 5, 'video');
    expect(results).toEqual([
      expect.objectContaining({
        name: 'holiday.mp4',
        semanticType: 'video',
        timestampMs: 15_000,
      }),
    ]);
  });

  it('keeps a bounded preprocessing backlog ahead of a blocked CLIP batch', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-image-queue-'));
    temporaryRoots.push(root);
    await Promise.all(
      Array.from({ length: 700 }, (_, index) =>
        fs.writeFile(path.join(root, `image-${String(index).padStart(4, '0')}.png`), 'image'),
      ),
    );
    mockOllama();

    let releaseEmbedding: () => void = () => {};
    let markEmbeddingStarted: () => void = () => {};
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve;
    });
    const embeddingRelease = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    let firstBatchSize = 0;
    clip.embedPrepared.mockImplementationOnce(async (images) => {
      firstBatchSize = images.length;
      markEmbeddingStarted();
      await embeddingRelease;
      return images.map(() => [1, 0, ...Array(510).fill(0)]);
    });
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await embeddingStarted;
    await vi.waitFor(() => {
      expect(imageProcessing.prepare.mock.calls.length).toBeGreaterThanOrEqual(500);
      expect(imageProcessing.prepare.mock.calls.length).toBeLessThan(700);
    });
    expect(firstBatchSize).toBe(256);

    releaseEmbedding();
    const status = await waitForIndex(service, root);
    expect(status).toMatchObject({
      indexStatus: 'ready',
      semanticCount: 700,
      failedCount: 0,
    });
    expect(imageQueueBudget.resolve).toHaveBeenCalledWith(8, 256);
  }, 20_000);

  it('skips an unreadable image without aborting the remaining image index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-invalid-image-'));
    temporaryRoots.push(root);
    const badImagePath = path.join(root, 'bad.png');
    const goodImagePath = path.join(root, 'good.png');
    await fs.writeFile(badImagePath, Buffer.from('not an image'));
    await fs.writeFile(goodImagePath, Buffer.from('fake image bytes'));
    mockOllama();
    imageProcessing.prepare.mockImplementation(async (filePath: string) => {
      if (filePath === badImagePath) {
        throw new Error('Input buffer contains unsupported image format');
      }
      return {
        data: new Uint8Array([2]),
        width: 224,
        height: 224,
        channels: 3 as const,
      };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    const status = await waitForIndex(service, root);

    expect(status).toMatchObject({
      indexStatus: 'ready',
      semanticCount: 1,
      failedCount: 1,
    });
    expect([...storage.semantics.values()].map((record) => record.fileId)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      `Skipping unreadable image: ${badImagePath}`,
      expect.any(Error),
    );
  });

  it('samples the beginning, middle, and end while keeping the content representation compact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-sample-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'documents'));
    const prefix = 'HEAD_TITLE\nclass ExampleApp\n';
    const middleMarker = 'MIDDLE_MARKER';
    const endMarker = 'END_CALL()';
    const middlePadding = 'a'.repeat(500 - prefix.length);
    const tailPadding = 'b'.repeat(
      1000 - prefix.length - middlePadding.length - middleMarker.length - endMarker.length,
    );
    await fs.writeFile(
      path.join(root, 'documents', 'sample.txt'),
      `${prefix}${middlePadding}${middleMarker}${tailPadding}${endMarker}`,
    );
    const fetchMock = mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await waitForIndex(service, root);

    const inputs = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/embed'))
      .flatMap(([, options]) => {
        const body = JSON.parse(String(options?.body || '{}'));
        return Array.isArray(body.input) ? body.input : [body.input];
      })
      .map(String);
    const input = inputs.find((value) => value.includes('File: sample.txt'));

    expect(input).toContain('Folder: documents');
    expect(input).toContain('HEAD_TITLE class ExampleApp');
    expect(input).toContain(middleMarker);
    expect(input).toContain(endMarker);
    expect(input).not.toMatch(/\s{2,}/);
    const content = String(input).split('\n').slice(2).join('\n');
    expect(content.length).toBeLessThanOrEqual(256);
  });

  it('calibrates the largest stable compact-input batch and persists the profile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-calibration-'));
    temporaryRoots.push(root);
    for (let index = 0; index < 40; index += 1) {
      await fs.writeFile(
        path.join(root, `large-${String(index).padStart(2, '0')}.txt`),
        `${`full sample ${index} `.repeat(700)}\n`,
      );
    }
    const batchSizes: number[] = [];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return ollamaResponse({
          models: [{ name: 'all-minilm:22m' }],
        });
      }
      if (url.endsWith('/api/embed')) {
        const body = JSON.parse(String(options?.body || '{}'));
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        batchSizes.push(inputs.length);
        if (inputs.length > 24) {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            text: async () => JSON.stringify({ error: 'CUDA out of memory' }),
          };
        }
        return ollamaResponse({ embeddings: inputs.map(() => [1, 0]) });
      }
      throw new Error(`Unexpected Ollama request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    const status = await waitForIndex(service, root);

    expect(status.embeddingBatchSize).toBe(24);
    expect(storage.profile).toMatchObject({
      model: 'all-minilm:22m',
      sampleBytes: 256,
      batchSize: 24,
      confirmationRuns: 1,
    });
    expect(batchSizes.some((size) => size > 24)).toBe(true);
    expect(batchSizes.filter((size) => size === 24).length).toBeGreaterThan(0);
  });

  it('reduces the calibration batch when Ollama drops an oversized socket', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-socket-calibration-'));
    temporaryRoots.push(root);
    for (let index = 0; index < 16; index += 1) {
      await fs.writeFile(
        path.join(root, `sample-${index}.txt`),
        `sample ${index} ${'content '.repeat(80)}`,
      );
    }
    const batchSizes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/api/tags')) {
          return ollamaResponse({ models: [{ name: 'all-minilm:22m' }] });
        }
        if (url.endsWith('/api/embed')) {
          const body = JSON.parse(String(options?.body || '{}'));
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          batchSizes.push(inputs.length);
          if (inputs.length > 8) {
            const error = new TypeError('fetch failed') as TypeError & {
              cause?: { code: string; message: string };
            };
            error.cause = {
              code: 'UND_ERR_SOCKET',
              message: 'other side closed',
            };
            throw error;
          }
          return ollamaResponse({ embeddings: inputs.map(() => [1, 0]) });
        }
        throw new Error(`Unexpected Ollama request: ${url}`);
      }),
    );
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    const status = await waitForIndex(service, root);

    expect(status.embeddingBatchSize).toBe(8);
    expect(batchSizes).toContain(16);
    expect(batchSizes).toContain(8);
  });

  it('estimates remaining indexing time from recent completed batches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-eta-'));
    temporaryRoots.push(root);
    for (let index = 0; index < 4; index += 1) {
      await fs.writeFile(path.join(root, `file-${index}.txt`), `searchable content ${index}`);
    }
    storage.profile = {
      schemaVersion: 1,
      model: 'all-minilm:22m',
      sampleBytes: 256,
      inputFormatVersion: 3,
      batchSize: 2,
      calibratedAt: Date.now(),
      confirmationRuns: 1,
    };

    let embedCalls = 0;
    let releaseSecondBatch: () => void = () => {};
    let markSecondBatchStarted: () => void = () => {};
    const secondBatchStarted = new Promise<void>((resolve) => {
      markSecondBatchStarted = resolve;
    });
    const secondBatchRelease = new Promise<void>((resolve) => {
      releaseSecondBatch = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/api/tags')) {
          return ollamaResponse({ models: [{ name: 'all-minilm:22m' }] });
        }
        if (url.endsWith('/api/embed')) {
          embedCalls += 1;
          const body = JSON.parse(String(options?.body || '{}'));
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          if (embedCalls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          } else if (embedCalls === 2) {
            markSecondBatchStarted();
            await secondBatchRelease;
          }
          return ollamaResponse({ embeddings: inputs.map(() => [1, 0]) });
        }
        throw new Error(`Unexpected Ollama request: ${url}`);
      }),
    );
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await secondBatchStarted;
    const status = await service.getFileSemanticStatus(root, false);

    expect(status).toMatchObject({
      indexStatus: 'building',
      stage: 'Stage 2 of 8 · Embedding text files',
      completed: 2,
      total: 4,
    });
    expect(status.estimatedRemainingMs).toBeGreaterThan(0);

    releaseSecondBatch();
    await waitForIndex(service, root);
  });

  it('installs MiniLM and prepares the CLIP image model for filesystem indexing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-model-install-'));
    temporaryRoots.push(root);
    const installed = new Set<string>();
    const pulled: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/api/tags')) {
          return ollamaResponse({
            models: [...installed].map((name) => ({ name })),
          });
        }
        if (url.endsWith('/api/pull')) {
          const body = JSON.parse(String(options?.body || '{}'));
          pulled.push(String(body.model || ''));
          installed.add(String(body.model || ''));
          return ollamaResponse({ status: 'success' });
        }
        throw new Error(`Unexpected Ollama request: ${url}`);
      }),
    );
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    const status = await service.installFileSemanticModels(root);

    expect(pulled).toEqual(['all-minilm:22m']);
    expect(clip.install).toHaveBeenCalled();
    expect(status.embeddingModelInstalled).toBe(true);
    expect(status.imageModelInstalled).toBe(true);
  });

  it('keeps CLIP preparation failures in semantic index status', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-model-error-'));
    temporaryRoots.push(root);
    mockOllama();
    clip.installed = false;
    clip.install.mockRejectedValueOnce(new Error('IRIS could not prepare the CLIP image model'));
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await expect(service.installFileSemanticModels(root)).rejects.toThrow(
      'IRIS could not prepare the CLIP image model',
    );

    const status = await service.getFileSemanticStatus(root, false);
    expect(status.indexStatus).toBe('error');
    expect(status.error).toBe('IRIS could not prepare the CLIP image model');
  });

  it('preflights eligible files without writing index records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-preflight-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'Documents'));
    await fs.writeFile(path.join(root, 'Documents', 'notes.txt'), 'hello');
    await fs.mkdir(path.join(root, '.cache'));
    await fs.writeFile(path.join(root, '.cache', 'cached.bin'), 'ignored');
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    const result = await service.preflightFileSemanticIndex(root, true);

    expect(result).toMatchObject({
      rootPath: root,
      directoryCount: 2,
      fileCount: 1,
      nodeCount: 3,
      requiresConfirmation: false,
    });
    expect(storage.meta).toBeNull();
    expect(storage.nodes.size).toBe(0);
  });

  it('returns selected-file neighbors and deterministic concept groups', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-concepts-'));
    temporaryRoots.push(root);
    const catPath = path.join(root, 'cat-care.md');
    await fs.writeFile(catPath, 'cat feeding schedule and indoor cat care\n');
    await fs.writeFile(path.join(root, 'cat-notes.txt'), 'notes about feeding cats\n');
    await fs.writeFile(path.join(root, 'calculator.py'), 'print(1)\n');
    mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await waitForIndex(service, root);

    const similar = await service.findSimilarFiles(catPath, 10);
    const concepts = await service.searchFileSemanticConcepts('cat files', 4, 8);

    expect(similar[0]).toMatchObject({
      name: 'cat-notes.txt',
      semanticType: 'text',
    });
    expect(concepts[0]).toMatchObject({ title: 'Cat · Documents & Text' });
    expect(concepts[0].results.map((result) => result.name)).toEqual(
      expect.arrayContaining(['cat-care.md', 'cat-notes.txt']),
    );
  });

  it('keeps the larger analysis model separate from indexing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-analysis-'));
    temporaryRoots.push(root);
    const largePath = path.join(root, 'large.py');
    const imagePath = path.join(root, 'holiday.png');
    await fs.writeFile(largePath, `start marker\n${'x'.repeat(700000)}\nend marker`);
    await fs.writeFile(imagePath, Buffer.from('fake image bytes'));
    const fetchMock = mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    const textAnalysis = await service.analyzeFileWithOllama(largePath);
    const imageAnalysis = await service.analyzeFileWithOllama(imagePath);

    expect(textAnalysis).toMatchObject({
      fileType: 'text',
      model: 'qwen3-vl:4b-instruct',
      markdown: expect.stringContaining('Combined analysis'),
    });
    expect(imageAnalysis).toMatchObject({
      fileType: 'image',
      model: 'qwen3-vl:4b-instruct',
      markdown: expect.stringContaining('Image analysis'),
    });
    const chatBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/chat'))
      .map(([, options]) => JSON.parse(String(options?.body || '{}')));
    expect(chatBodies.every((body) => body.model === 'qwen3-vl:4b-instruct')).toBe(true);
  });

  it('cancels an active embedding request and reports a cancelled index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-cancel-'));
    temporaryRoots.push(root);
    await fs.writeFile(path.join(root, 'large.txt'), 'content to embed\n');

    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return ollamaResponse({
          models: [{ name: 'all-minilm:22m' }],
        });
      }
      if (url.endsWith('/api/embed')) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          const abort = () => reject(new Error('aborted'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      throw new Error(`Unexpected Ollama request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/embed'))) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const status = await service.cancelFileSemanticIndex(root);

    expect(status.indexStatus).toBe('cancelled');
    expect(storage.meta).toBeNull();
    expect(storage.nodes.size).toBe(0);
    expect(storage.semantics.size).toBe(0);
  });

  it('rescans without re-embedding unchanged files and reclassifies changed files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-rescan-'));
    temporaryRoots.push(root);
    const calculatorPath = path.join(root, 'calculator.py');
    const notesPath = path.join(root, 'notes.txt');
    await fs.writeFile(calculatorPath, 'print(1)\n');
    const fetchMock = mockOllama();
    const service = await import('../../server/desktopBridge/services/fileSemanticService');

    await service.rebuildFileSemanticIndex(root);
    await waitForIndex(service, root);
    const initialEmbedCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/api/embed'),
    ).length;

    await service.rescanFileSemanticIndex(root);
    await waitForIndex(service, root);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/embed')).length).toBe(
      initialEmbedCalls,
    );

    await fs.writeFile(calculatorPath, Buffer.from([0, 1, 2, 3]));
    await fs.utimes(calculatorPath, new Date(), new Date(Date.now() + 2000));
    await fs.writeFile(notesPath, 'cats are excellent pets\n');
    await service.rescanFileSemanticIndex(root);
    await waitForIndex(service, root);

    const nodesByName = new Map(
      [...storage.nodes.values()].map((node) => [node.metadata.name, node]),
    );
    expect(nodesByName.get('calculator.py')?.contentKind).toBe('binary');
    expect(nodesByName.get('notes.txt')?.contentKind).toBe('text');
    expect(
      [...storage.semantics.values()].some(
        (record) => record.fileId === nodesByName.get('calculator.py')?.id,
      ),
    ).toBe(false);
  });
});
