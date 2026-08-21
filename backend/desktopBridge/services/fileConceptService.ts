/**
 * Builds persistent concept groups from existing MiniLM and CLIP vectors. The service never
 * re-embeds or reopens source files: it streams encrypted vectors twice, trains on a bounded
 * representative sample, and assigns all files through a hierarchical spherical-k-means model.
 */

import {
  countEncryptedFileConceptSources,
  finalizeEncryptedFileConceptGeneration,
  readEncryptedFileConcepts,
  readEncryptedFileConceptVectorPage,
  writeEncryptedFileConceptMemberships,
  writeEncryptedFileConcepts,
  type EncryptedFileConceptEmbeddingSpace,
  type EncryptedFileConceptMembershipInput,
  type EncryptedFileConceptVectorRecord,
} from '../storage/encryptedDatabase.js';
import { createFileConceptPool, type FileConceptPool } from './fileConceptPool.js';

export const FILE_CONCEPT_INDEX_VERSION = 1;

const TRAINING_SAMPLE_LIMIT = 20_000;
const VECTOR_PAGE_SIZE = 1_024;
const BROAD_ITERATIONS = 4;
const LOCAL_ITERATIONS = 4;
const MAX_BROAD_CENTROIDS = 128;
const MAX_LOCAL_CENTROIDS = 16;
const MAX_CONCEPTS_PER_SPACE = 2_000;
const MAX_MEMBERSHIPS_PER_VECTOR = 3;
const MAX_TRAINING_FRAMES_PER_VIDEO = 3;
const MAX_PENDING_ASSIGNMENTS_MULTIPLIER = 2;

export interface FileConceptBuildProgress {
  phase: string;
  completed: number;
  total: number;
  conceptCount: number;
  workerCount: number;
}

export interface FileConceptBuildResult {
  generation: string;
  conceptCount: number;
  miniLmConceptCount: number;
  clipConceptCount: number;
  sourceVectorCount: number;
  workerCount: number;
}

interface ConceptTrainingSample {
  vectors: Float32Array;
  dimension: number;
  processedVectors: number;
}

interface TrainedConceptModel {
  dimension: number;
  broadCentroids: Float32Array;
  localCentroids: Float32Array;
  localOffsets: Int32Array;
}

interface AssignmentPage {
  records: EncryptedFileConceptVectorRecord[];
  vectors: Float32Array;
}

interface AssignmentOutcome {
  records: EncryptedFileConceptVectorRecord[];
  conceptIndexes: Int32Array;
  scores: Float32Array;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Concept indexing was cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

function hashSeed(space: EncryptedFileConceptEmbeddingSpace): number {
  return space === 'minilm' ? 0x51f15e : 0xc11f00;
}

function nextRandom(state: { value: number }): number {
  let value = state.value | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value | 0;
  return (value >>> 0) / 0x1_0000_0000;
}

function normalizeRowsInPlace(vectors: Float32Array, dimension: number): void {
  const rowCount = vectors.length / dimension;
  for (let row = 0; row < rowCount; row += 1) {
    const offset = row * dimension;
    let magnitudeSquared = 0;
    for (let column = 0; column < dimension; column += 1) {
      const value = vectors[offset + column];
      magnitudeSquared += value * value;
    }
    const magnitude = Math.sqrt(magnitudeSquared);
    if (magnitude <= 1e-12) continue;
    const inverse = 1 / magnitude;
    for (let column = 0; column < dimension; column += 1) {
      vectors[offset + column] *= inverse;
    }
  }
}

function adaptiveConceptCount(fileCount: number, sampleCount: number): number {
  if (fileCount < 2 || sampleCount < 2) return 0;
  const desired = Math.round(Math.sqrt(fileCount) * 3);
  return Math.max(
    2,
    Math.min(MAX_CONCEPTS_PER_SPACE, desired, fileCount, Math.max(2, Math.floor(sampleCount / 4))),
  );
}

function adaptiveBroadCount(conceptCount: number, sampleCount: number): number {
  if (conceptCount < 2) return 1;
  return Math.max(
    2,
    Math.min(
      MAX_BROAD_CENTROIDS,
      Math.ceil(conceptCount / 12),
      Math.max(2, Math.floor(sampleCount / 8)),
    ),
  );
}

function initialCentroids(
  sample: Float32Array,
  dimension: number,
  centroidCount: number,
  seed: number,
): Float32Array {
  const rowCount = sample.length / dimension;
  const centroids = new Float32Array(centroidCount * dimension);
  const stride = Math.max(1, Math.floor(rowCount / centroidCount));
  for (let centroid = 0; centroid < centroidCount; centroid += 1) {
    const row = (seed + centroid * stride + centroid * centroid * 17) % rowCount;
    centroids.set(
      sample.subarray(row * dimension, row * dimension + dimension),
      centroid * dimension,
    );
  }
  normalizeRowsInPlace(centroids, dimension);
  return centroids;
}

async function* vectorPages(
  space: EncryptedFileConceptEmbeddingSpace,
  rootNodeId: string,
  signal: AbortSignal,
): AsyncGenerator<EncryptedFileConceptVectorRecord[]> {
  let afterId = '';
  while (true) {
    throwIfCancelled(signal);
    const page = await readEncryptedFileConceptVectorPage({
      embeddingSpace: space,
      source: 'file',
      rootNodeId,
      afterId,
      limit: VECTOR_PAGE_SIZE,
    });
    if (!page.length) break;
    afterId = page[page.length - 1].sourceSemanticId;
    yield page;
  }

  if (space !== 'clip') return;
  afterId = '';
  while (true) {
    throwIfCancelled(signal);
    const page = await readEncryptedFileConceptVectorPage({
      embeddingSpace: space,
      source: 'video',
      rootNodeId,
      afterId,
      limit: VECTOR_PAGE_SIZE,
    });
    if (!page.length) break;
    afterId = page[page.length - 1].sourceSemanticId;
    yield page;
  }
}

function representativeVideoFrames(
  records: EncryptedFileConceptVectorRecord[],
): EncryptedFileConceptVectorRecord[] {
  if (records.length <= MAX_TRAINING_FRAMES_PER_VIDEO) return records;
  const last = records.length - 1;
  return [records[0], records[Math.floor(last / 2)], records[last]];
}

async function collectTrainingSample(
  space: EncryptedFileConceptEmbeddingSpace,
  rootNodeId: string,
  signal: AbortSignal,
  onProcessed: (count: number) => void,
): Promise<ConceptTrainingSample> {
  const reservoir: Float32Array[] = [];
  const randomState = { value: hashSeed(space) };
  let considered = 0;
  let processedVectors = 0;
  let dimension = 0;
  let currentVideoFile = '';
  let currentVideoRecords: EncryptedFileConceptVectorRecord[] = [];

  const addCandidate = (record: EncryptedFileConceptVectorRecord) => {
    if (!dimension) dimension = record.embedding.length;
    if (record.embedding.length !== dimension) return;
    considered += 1;
    const copy = new Float32Array(record.embedding);
    if (reservoir.length < TRAINING_SAMPLE_LIMIT) {
      reservoir.push(copy);
      return;
    }
    const replacement = Math.floor(nextRandom(randomState) * considered);
    if (replacement < TRAINING_SAMPLE_LIMIT) reservoir[replacement] = copy;
  };

  const flushVideo = () => {
    for (const record of representativeVideoFrames(currentVideoRecords)) addCandidate(record);
    currentVideoRecords = [];
  };

  for await (const page of vectorPages(space, rootNodeId, signal)) {
    for (const record of page) {
      processedVectors += 1;
      if (typeof record.timestampMs !== 'number') {
        if (currentVideoRecords.length) flushVideo();
        currentVideoFile = '';
        addCandidate(record);
      } else {
        if (currentVideoFile && currentVideoFile !== record.fileId) flushVideo();
        currentVideoFile = record.fileId;
        currentVideoRecords.push(record);
      }
    }
    onProcessed(processedVectors);
  }
  if (currentVideoRecords.length) flushVideo();
  if (!reservoir.length || !dimension) {
    return { vectors: new Float32Array(0), dimension: 0, processedVectors };
  }

  const vectors = new Float32Array(reservoir.length * dimension);
  reservoir.forEach((vector, index) => vectors.set(vector, index * dimension));
  normalizeRowsInPlace(vectors, dimension);
  return { vectors, dimension, processedVectors };
}

function localClusterCounts(
  assignments: Int32Array,
  broadCount: number,
  targetConceptCount: number,
): Int32Array {
  const sampleCounts = new Int32Array(broadCount);
  for (const assignment of assignments) sampleCounts[assignment] += 1;
  const result = new Int32Array(broadCount);
  const sampleCount = assignments.length;
  for (let broad = 0; broad < broadCount; broad += 1) {
    const members = sampleCounts[broad];
    if (!members) continue;
    const proportional = Math.max(1, Math.round((targetConceptCount * members) / sampleCount));
    result[broad] = Math.max(
      1,
      Math.min(MAX_LOCAL_CENTROIDS, proportional, Math.max(1, Math.floor(members / 3))),
    );
  }
  return result;
}

function vectorsForBroadCluster(
  sample: Float32Array,
  dimension: number,
  assignments: Int32Array,
  broadIndex: number,
): Float32Array {
  let count = 0;
  for (const assignment of assignments) if (assignment === broadIndex) count += 1;
  const vectors = new Float32Array(count * dimension);
  let offset = 0;
  for (let row = 0; row < assignments.length; row += 1) {
    if (assignments[row] !== broadIndex) continue;
    vectors.set(sample.subarray(row * dimension, row * dimension + dimension), offset);
    offset += dimension;
  }
  return vectors;
}

async function trainModel(
  pool: FileConceptPool,
  sample: ConceptTrainingSample,
  fileCount: number,
  space: EncryptedFileConceptEmbeddingSpace,
  signal: AbortSignal,
): Promise<TrainedConceptModel | null> {
  const sampleCount = sample.vectors.length / sample.dimension;
  const targetConceptCount = adaptiveConceptCount(fileCount, sampleCount);
  if (!targetConceptCount) return null;
  const broadCount = adaptiveBroadCount(targetConceptCount, sampleCount);
  await pool.initializeSample(sample.vectors, sample.dimension);
  let broadCentroids = initialCentroids(
    sample.vectors,
    sample.dimension,
    broadCount,
    hashSeed(space),
  );

  for (let iteration = 0; iteration < BROAD_ITERATIONS; iteration += 1) {
    throwIfCancelled(signal);
    const { sums, counts } = await pool.broadStep(broadCentroids, broadCount, sample.dimension);
    for (let centroid = 0; centroid < broadCount; centroid += 1) {
      if (counts[centroid]) continue;
      const sourceRow = (hashSeed(space) + iteration * 131 + centroid * 977) % sampleCount;
      sums.set(
        sample.vectors.subarray(
          sourceRow * sample.dimension,
          sourceRow * sample.dimension + sample.dimension,
        ),
        centroid * sample.dimension,
      );
    }
    normalizeRowsInPlace(sums, sample.dimension);
    broadCentroids = sums;
  }

  const assignments = await pool.broadAssignments(broadCentroids, broadCount);
  const clusterCounts = localClusterCounts(assignments, broadCount, targetConceptCount);
  const jobs: Array<{
    broadIndex: number;
    vectors: Float32Array;
    dimension: number;
    centroidCount: number;
    iterations: number;
    seed: number;
  }> = [];
  for (let broad = 0; broad < broadCount; broad += 1) {
    if (!clusterCounts[broad]) continue;
    jobs.push({
      broadIndex: broad,
      vectors: vectorsForBroadCluster(sample.vectors, sample.dimension, assignments, broad),
      dimension: sample.dimension,
      centroidCount: clusterCounts[broad],
      iterations: LOCAL_ITERATIONS,
      seed: hashSeed(space) + broad * 1009,
    });
  }

  const trained = await pool.trainLocalClusters(jobs);
  const localOffsets = new Int32Array(broadCount + 1);
  const trainedByBroad = new Map<number, Float32Array>();
  jobs.forEach((job, index) => trainedByBroad.set(job.broadIndex, trained[index]));
  let totalLocalCentroids = 0;
  for (let broad = 0; broad < broadCount; broad += 1) {
    localOffsets[broad] = totalLocalCentroids;
    totalLocalCentroids += (trainedByBroad.get(broad)?.length || 0) / sample.dimension;
  }
  localOffsets[broadCount] = totalLocalCentroids;
  const localCentroids = new Float32Array(totalLocalCentroids * sample.dimension);
  let localOffset = 0;
  for (let broad = 0; broad < broadCount; broad += 1) {
    const centroids = trainedByBroad.get(broad);
    if (!centroids) continue;
    localCentroids.set(centroids, localOffset);
    localOffset += centroids.length;
  }
  return {
    dimension: sample.dimension,
    broadCentroids,
    localCentroids,
    localOffsets,
  };
}

function flattenPage(
  records: EncryptedFileConceptVectorRecord[],
  dimension: number,
): AssignmentPage {
  const validRecords = records.filter((record) => record.embedding.length === dimension);
  const vectors = new Float32Array(validRecords.length * dimension);
  validRecords.forEach((record, index) => vectors.set(record.embedding, index * dimension));
  return { records: validRecords, vectors };
}

async function assignSpace(
  pool: FileConceptPool,
  space: EncryptedFileConceptEmbeddingSpace,
  rootNodeId: string,
  generation: string,
  conceptIds: string[],
  model: TrainedConceptModel,
  signal: AbortSignal,
  onAssigned: (count: number) => void,
): Promise<void> {
  await pool.setModel(
    model.dimension,
    model.broadCentroids,
    model.localCentroids,
    model.localOffsets,
  );
  const maximumPending = Math.max(1, pool.workerCount * MAX_PENDING_ASSIGNMENTS_MULTIPLIER);
  let assignedVectors = 0;

  const saveOutcome = async (outcome: AssignmentOutcome) => {
    const memberships: EncryptedFileConceptMembershipInput[] = [];
    for (let row = 0; row < outcome.records.length; row += 1) {
      const record = outcome.records[row];
      for (let slot = 0; slot < MAX_MEMBERSHIPS_PER_VECTOR; slot += 1) {
        const offset = row * MAX_MEMBERSHIPS_PER_VECTOR + slot;
        const conceptIndex = outcome.conceptIndexes[offset];
        if (conceptIndex < 0 || conceptIndex >= conceptIds.length) continue;
        memberships.push({
          conceptId: conceptIds[conceptIndex],
          generation,
          fileId: record.fileId,
          sourceSemanticId: record.sourceSemanticId,
          timestampMs: record.timestampMs,
          similarity: outcome.scores[offset],
        });
      }
    }
    await writeEncryptedFileConceptMemberships(memberships);
    assignedVectors += outcome.records.length;
    onAssigned(assignedVectors);
  };

  const tracked = new Map<Promise<AssignmentOutcome>, Promise<AssignmentOutcome>>();
  const settleTracked = async () => {
    const completed = await Promise.race(
      [...tracked.entries()].map(([task]) => task.then((outcome) => ({ task, outcome }))),
    );
    tracked.delete(completed.task);
    await saveOutcome(completed.outcome);
  };

  for await (const records of vectorPages(space, rootNodeId, signal)) {
    throwIfCancelled(signal);
    const page = flattenPage(records, model.dimension);
    if (!page.records.length) continue;
    const task = pool
      .assign(page.vectors, MAX_MEMBERSHIPS_PER_VECTOR)
      .then((result) => ({ records: page.records, ...result }));
    tracked.set(task, task);
    if (tracked.size >= maximumPending) await settleTracked();
  }
  while (tracked.size) await settleTracked();
}

async function buildSpace(
  pool: FileConceptPool,
  generation: string,
  rootNodeId: string,
  space: EncryptedFileConceptEmbeddingSpace,
  progressOffset: number,
  totalProgress: number,
  signal: AbortSignal,
  onProgress: (progress: FileConceptBuildProgress) => void,
): Promise<{ conceptCount: number; vectorCount: number }> {
  const stats = await countEncryptedFileConceptSources(space, rootNodeId);
  if (stats.vectorCount < 2 || stats.fileCount < 2) {
    return { conceptCount: 0, vectorCount: stats.vectorCount };
  }

  const sample = await collectTrainingSample(space, rootNodeId, signal, (processed) => {
    onProgress({
      phase: `Sampling ${space === 'minilm' ? 'text' : 'visual'} embeddings for concepts`,
      completed: progressOffset + processed,
      total: totalProgress,
      conceptCount: 0,
      workerCount: pool.workerCount,
    });
  });
  throwIfCancelled(signal);
  onProgress({
    phase: `Training ${space === 'minilm' ? 'text' : 'visual'} concept centres`,
    completed: progressOffset + stats.vectorCount,
    total: totalProgress,
    conceptCount: 0,
    workerCount: pool.workerCount,
  });
  const model = await trainModel(pool, sample, stats.fileCount, space, signal);
  if (!model) return { conceptCount: 0, vectorCount: stats.vectorCount };

  const conceptCount = model.localCentroids.length / model.dimension;
  const conceptIds = Array.from(
    { length: conceptCount },
    (_, index) => `concept_${generation}_${space}_${index.toString(36)}`,
  );
  await writeEncryptedFileConcepts(
    conceptIds.map((id, index) => ({
      id,
      generation,
      embeddingSpace: space,
      metadata: {
        indexVersion: FILE_CONCEPT_INDEX_VERSION,
        sourceModelSpace: space,
        generatedAt: Date.now(),
      },
      centroid: model.localCentroids.slice(index * model.dimension, (index + 1) * model.dimension),
    })),
  );

  await assignSpace(pool, space, rootNodeId, generation, conceptIds, model, signal, (assigned) => {
    onProgress({
      phase: `Assigning ${space === 'minilm' ? 'text files' : 'images and videos'} to concepts`,
      completed: progressOffset + stats.vectorCount + assigned,
      total: totalProgress,
      conceptCount,
      workerCount: pool.workerCount,
    });
  });
  return { conceptCount, vectorCount: stats.vectorCount };
}

/** Rebuilds both independent concept spaces from already-persisted semantic vectors. */
export async function rebuildFileConceptIndex(options: {
  generation: string;
  rootNodeId: string;
  signal: AbortSignal;
  onProgress: (progress: FileConceptBuildProgress) => void;
}): Promise<FileConceptBuildResult> {
  const generation = String(options.generation || '').trim();
  if (!generation) throw new Error('Concept generation is required');
  const [miniStats, clipStats] = await Promise.all([
    countEncryptedFileConceptSources('minilm', options.rootNodeId),
    countEncryptedFileConceptSources('clip', options.rootNodeId),
  ]);
  const sourceVectorCount = miniStats.vectorCount + clipStats.vectorCount;
  const totalProgress = Math.max(1, sourceVectorCount * 2);
  const pool = createFileConceptPool();
  const cancel = () => void pool.close();
  options.signal.addEventListener('abort', cancel, { once: true });

  try {
    await buildSpace(
      pool,
      generation,
      options.rootNodeId,
      'minilm',
      0,
      totalProgress,
      options.signal,
      options.onProgress,
    );
    await buildSpace(
      pool,
      generation,
      options.rootNodeId,
      'clip',
      miniStats.vectorCount * 2,
      totalProgress,
      options.signal,
      options.onProgress,
    );
    const finalizedCount = await finalizeEncryptedFileConceptGeneration(generation);
    const finalizedConcepts = await readEncryptedFileConcepts(generation);
    return {
      generation,
      conceptCount: finalizedCount,
      miniLmConceptCount: finalizedConcepts.filter((concept) => concept.embeddingSpace === 'minilm')
        .length,
      clipConceptCount: finalizedConcepts.filter((concept) => concept.embeddingSpace === 'clip')
        .length,
      sourceVectorCount,
      workerCount: pool.workerCount,
    };
  } finally {
    options.signal.removeEventListener('abort', cancel);
    await pool.close();
  }
}
