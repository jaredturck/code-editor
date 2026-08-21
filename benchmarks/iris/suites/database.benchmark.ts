/** Benchmarks the persistent benchmark database through IRIS's real encrypted repositories. */

import {
  clearEncryptedFileIndex,
  closeEncryptedDatabase,
  initializeEncryptedDatabase,
  readEncryptedFileSemantics,
  readEncryptedFilesystemNodes,
  writeEncryptedFileIndexMeta,
  writeEncryptedFileSemantics,
  writeEncryptedFilesystemNodes,
  type EncryptedFileSemanticInput,
  type EncryptedFilesystemNodeInput,
} from '../../../backend/desktopBridge/storage/encryptedDatabase.js';
import type { BenchmarkDefinition, BenchmarkEnvironment } from '../core/types.js';

interface DatabaseContext {
  environment: BenchmarkEnvironment;
  nodes: EncryptedFilesystemNodeInput[];
  semantics: EncryptedFileSemanticInput[];
}

/** Creates representative tree and semantic records against the retained benchmark database. */
async function createDatabaseContext(
  environment: BenchmarkEnvironment,
  recordCount: number,
): Promise<DatabaseContext> {
  await clearEncryptedFileIndex();
  const rootNode: EncryptedFilesystemNodeInput = {
    id: 'benchmark-root',
    parentId: null,
    nodeType: 'directory',
    contentKind: 'directory',
    sizeBytes: 0,
    modifiedAt: 1,
    indexedAt: 1,
    metadata: {
      name: 'Benchmark root',
      relativePath: '',
      sourceId: 'benchmark',
    },
  };
  const nodes = [rootNode];
  const semantics: EncryptedFileSemanticInput[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const id = `benchmark-file-${String(index).padStart(5, '0')}`;
    nodes.push({
      id,
      parentId: rootNode.id,
      nodeType: 'file',
      contentKind: index % 4 === 0 ? 'image' : 'text',
      sizeBytes: 4096 + index,
      modifiedAt: index + 1,
      indexedAt: 1,
      metadata: {
        name: `${id}.txt`,
        relativePath: `project/${id}.txt`,
        sourceId: 'benchmark',
        extension: '.txt',
      },
    });
    semantics.push({
      fileId: id,
      metadata: {
        semanticType: index % 4 === 0 ? 'image' : 'text',
        model: index % 4 === 0 ? 'clip' : 'minilm',
        sample: `Benchmark semantic record ${index}`,
      },
      embedding: Array.from(
        { length: 512 },
        (_, dimension) => Math.sin((index + 1) * (dimension + 1)) / Math.sqrt(512),
      ),
    });
  }
  return { environment, nodes, semantics };
}

/** Reopens the existing benchmark database to measure normal startup without recreating its schema. */
async function reopenPersistentDatabase(context: DatabaseContext): Promise<void> {
  await closeEncryptedDatabase();
  await initializeEncryptedDatabase({
    databasePath: context.environment.databasePath,
    masterKey: context.environment.databaseKey,
  });
}

/** Exposes real encrypted persistence costs without creating or deleting database files. */
export const databaseBenchmarks: BenchmarkDefinition<any>[] = [
  {
    id: 'database.sqlite.reopen-existing',
    suite: 'Encrypted database',
    name: 'Persistent benchmark database reopen',
    description:
      'Reopens the retained SQLite file, reapplies idempotent schema checks, compatibility indexes, WAL settings, and permissions.',
    iterations: 5,
    warmupIterations: 1,
    tags: ['database'],
    setup: (environment) => createDatabaseContext(environment, 1),
    run: reopenPersistentDatabase,
  },
  {
    id: 'database.filesystem-nodes.write.512',
    suite: 'Encrypted database',
    name: 'Filesystem node batch upsert · 512 files',
    description:
      'Encrypts metadata and upserts a parent-before-child filesystem batch in one transaction.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 513,
    tags: ['database'],
    setup: (environment) => createDatabaseContext(environment, 512),
    run: (context) => writeEncryptedFilesystemNodes(context.nodes),
  },
  {
    id: 'database.file-semantics.write.64',
    suite: 'Encrypted database',
    name: 'Semantic vector batch upsert · 64 vectors',
    description:
      'Encodes 512-dimensional vectors, encrypts metadata and embeddings, and performs serial SQLite upserts.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 64,
    tags: ['database'],
    setup: async (environment) => {
      const context = await createDatabaseContext(environment, 64);
      await writeEncryptedFilesystemNodes(context.nodes);
      return context;
    },
    run: (context) => writeEncryptedFileSemantics(context.semantics),
  },
  {
    id: 'database.file-semantics.write.512',
    suite: 'Encrypted database',
    name: 'Semantic vector batch upsert · 512 vectors',
    description:
      'Measures the complete encrypted persistence lane used after one production-sized CLIP batch.',
    iterations: 5,
    warmupIterations: 1,
    operationsPerIteration: 512,
    tags: ['database'],
    setup: async (environment) => {
      const context = await createDatabaseContext(environment, 512);
      await writeEncryptedFilesystemNodes(context.nodes);
      return context;
    },
    run: (context) => writeEncryptedFileSemantics(context.semantics),
  },
  {
    id: 'database.file-semantics.read.512',
    suite: 'Encrypted database',
    name: 'Semantic vector read/decrypt · 512 vectors',
    description:
      'Reads encrypted rows, authenticates payloads, reconstructs Float32 vectors, and parses metadata.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 512,
    tags: ['database'],
    setup: async (environment) => {
      const context = await createDatabaseContext(environment, 512);
      await writeEncryptedFilesystemNodes(context.nodes);
      await writeEncryptedFileSemantics(context.semantics);
      return context;
    },
    run: () => readEncryptedFileSemantics(),
  },
  {
    id: 'database.filesystem-nodes.read.512',
    suite: 'Encrypted database',
    name: 'Filesystem tree read/decrypt · 512 files',
    description:
      'Reads the encrypted tree and reconstructs all node metadata used during rescans and path resolution.',
    iterations: 8,
    warmupIterations: 2,
    operationsPerIteration: 513,
    tags: ['database'],
    setup: async (environment) => {
      const context = await createDatabaseContext(environment, 512);
      await writeEncryptedFilesystemNodes(context.nodes);
      return context;
    },
    run: () => readEncryptedFilesystemNodes(),
  },
  {
    id: 'database.index-meta.write',
    suite: 'Encrypted database',
    name: 'Index metadata finalization',
    description: 'Encrypts and upserts the Stage 8 index summary and locked source configuration.',
    iterations: 10,
    warmupIterations: 2,
    operationsPerIteration: 20,
    tags: ['database'],
    setup: (environment) => createDatabaseContext(environment, 1),
    run: async (_context, iteration) => {
      for (let index = 0; index < 20; index += 1) {
        await writeEncryptedFileIndexMeta({
          status: 'complete',
          schemaVersion: 11,
          nodeCount: 1_700_000,
          fileCount: 1_300_000,
          semanticCount: 300_000,
          generatedAt: iteration * 20 + index,
          sources: [{ id: 'benchmark', path: '/benchmark', label: 'Benchmark' }],
        });
      }
    },
  },
];
