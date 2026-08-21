/**
 * CPU worker for spherical concept clustering. Samples and centroids stay in contiguous
 * Float32Array buffers so the hot loops avoid object allocation and JavaScript number arrays.
 */

import { parentPort } from 'node:worker_threads';
import {
  conceptDotRows,
  nearestConceptCentroid,
  normalizeConceptRowsInPlace,
  trainConceptCentroids,
} from './fileConceptMath.js';
import type {
  FileConceptWorkerRequest,
  FileConceptWorkerResponse,
} from './fileConceptWorkerTypes.js';

const port = parentPort;
if (!port) throw new Error('Concept worker requires a parent port');

let sampleVectors = new Float32Array(0);
let sampleDimension = 0;
let modelDimension = 0;
let modelBroadCentroids = new Float32Array(0);
let modelLocalCentroids = new Float32Array(0);
let modelLocalOffsets = new Int32Array(0);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Concept worker failed');
}

function topBroadIndexes(vectors: Float32Array, vectorOffset: number, maximum: number): number[] {
  const broadCount = modelBroadCentroids.length / modelDimension;
  let firstIndex = -1;
  let firstScore = -Infinity;
  let secondIndex = -1;
  let secondScore = -Infinity;
  for (let broad = 0; broad < broadCount; broad += 1) {
    const score = conceptDotRows(
      vectors,
      vectorOffset,
      modelBroadCentroids,
      broad * modelDimension,
      modelDimension,
    );
    if (score > firstScore) {
      secondIndex = firstIndex;
      secondScore = firstScore;
      firstIndex = broad;
      firstScore = score;
    } else if (score > secondScore) {
      secondIndex = broad;
      secondScore = score;
    }
  }
  return maximum > 1 && secondIndex >= 0 ? [firstIndex, secondIndex] : [firstIndex];
}

function assignModel(
  vectors: Float32Array,
  maximumMemberships: number,
): {
  conceptIndexes: Int32Array;
  scores: Float32Array;
} {
  if (!modelDimension || !modelBroadCentroids.length || !modelLocalCentroids.length) {
    throw new Error('Concept model has not been initialized');
  }
  normalizeConceptRowsInPlace(vectors, modelDimension);
  const rowCount = vectors.length / modelDimension;
  const boundedMemberships = Math.max(1, Math.min(4, maximumMemberships));
  const conceptIndexes = new Int32Array(rowCount * boundedMemberships);
  conceptIndexes.fill(-1);
  const scores = new Float32Array(rowCount * boundedMemberships);
  scores.fill(-1);

  for (let row = 0; row < rowCount; row += 1) {
    const vectorOffset = row * modelDimension;
    const bestIndexes = new Int32Array(boundedMemberships);
    bestIndexes.fill(-1);
    const bestScores = new Float32Array(boundedMemberships);
    bestScores.fill(-Infinity);

    for (const broad of topBroadIndexes(vectors, vectorOffset, 2)) {
      if (broad < 0) continue;
      const start = modelLocalOffsets[broad];
      const end = modelLocalOffsets[broad + 1];
      for (let concept = start; concept < end; concept += 1) {
        const score = conceptDotRows(
          vectors,
          vectorOffset,
          modelLocalCentroids,
          concept * modelDimension,
          modelDimension,
        );
        for (let position = 0; position < boundedMemberships; position += 1) {
          if (score <= bestScores[position]) continue;
          for (let shift = boundedMemberships - 1; shift > position; shift -= 1) {
            bestScores[shift] = bestScores[shift - 1];
            bestIndexes[shift] = bestIndexes[shift - 1];
          }
          bestScores[position] = score;
          bestIndexes[position] = concept;
          break;
        }
      }
    }

    const strongest = bestScores[0];
    for (let position = 0; position < boundedMemberships; position += 1) {
      const score = bestScores[position];
      if (bestIndexes[position] < 0) break;
      if (position > 0 && (score < 0.1 || score < strongest - 0.08)) break;
      const target = row * boundedMemberships + position;
      conceptIndexes[target] = bestIndexes[position];
      scores[target] = score;
    }
  }

  return { conceptIndexes, scores };
}

port.on('message', (request: FileConceptWorkerRequest) => {
  try {
    if (request.type === 'initialize-sample') {
      sampleVectors = new Float32Array(request.vectors);
      sampleDimension = request.dimension;
      normalizeConceptRowsInPlace(sampleVectors, sampleDimension);
      const response: FileConceptWorkerResponse = {
        id: request.id,
        type: 'initialized',
      };
      port.postMessage(response);
      return;
    }

    if (request.type === 'broad-step') {
      if (!sampleDimension) throw new Error('Concept sample has not been initialized');
      const centroids = new Float32Array(request.centroids);
      const sums = new Float32Array(request.centroidCount * sampleDimension);
      const counts = new Int32Array(request.centroidCount);
      const rowCount = sampleVectors.length / sampleDimension;
      for (let row = 0; row < rowCount; row += 1) {
        const vectorOffset = row * sampleDimension;
        const nearest = nearestConceptCentroid(
          sampleVectors,
          vectorOffset,
          centroids,
          request.centroidCount,
          sampleDimension,
        );
        counts[nearest] += 1;
        const centroidOffset = nearest * sampleDimension;
        for (let column = 0; column < sampleDimension; column += 1) {
          sums[centroidOffset + column] += sampleVectors[vectorOffset + column];
        }
      }
      const response: FileConceptWorkerResponse = {
        id: request.id,
        type: 'broad-step',
        sums: sums.buffer as ArrayBuffer,
        counts: counts.buffer as ArrayBuffer,
      };
      port.postMessage(response, [sums.buffer as ArrayBuffer, counts.buffer as ArrayBuffer]);
      return;
    }

    if (request.type === 'broad-assignments') {
      if (!sampleDimension) throw new Error('Concept sample has not been initialized');
      const centroids = new Float32Array(request.centroids);
      const rowCount = sampleVectors.length / sampleDimension;
      const assignments = new Int32Array(rowCount);
      for (let row = 0; row < rowCount; row += 1) {
        assignments[row] = nearestConceptCentroid(
          sampleVectors,
          row * sampleDimension,
          centroids,
          request.centroidCount,
          sampleDimension,
        );
      }
      const response: FileConceptWorkerResponse = {
        id: request.id,
        type: 'broad-assignments',
        assignments: assignments.buffer as ArrayBuffer,
      };
      port.postMessage(response, [assignments.buffer as ArrayBuffer]);
      return;
    }

    if (request.type === 'train-local') {
      const vectors = new Float32Array(request.vectors);
      const centroids = trainConceptCentroids(
        vectors,
        request.dimension,
        request.centroidCount,
        request.iterations,
        request.seed,
      );
      const response: FileConceptWorkerResponse = {
        id: request.id,
        type: 'train-local',
        centroids: centroids.buffer as ArrayBuffer,
      };
      port.postMessage(response, [centroids.buffer as ArrayBuffer]);
      return;
    }

    if (request.type === 'set-model') {
      modelDimension = request.dimension;
      modelBroadCentroids = new Float32Array(request.broadCentroids);
      modelLocalCentroids = new Float32Array(request.localCentroids);
      modelLocalOffsets = new Int32Array(request.localOffsets);
      const response: FileConceptWorkerResponse = {
        id: request.id,
        type: 'model-set',
      };
      port.postMessage(response);
      return;
    }

    const vectors = new Float32Array(request.vectors);
    const { conceptIndexes, scores } = assignModel(vectors, request.maximumMemberships);
    const response: FileConceptWorkerResponse = {
      id: request.id,
      type: 'assign',
      conceptIndexes: conceptIndexes.buffer as ArrayBuffer,
      scores: scores.buffer as ArrayBuffer,
    };
    port.postMessage(response, [
      conceptIndexes.buffer as ArrayBuffer,
      scores.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    const response: FileConceptWorkerResponse = {
      id: request.id,
      type: 'error',
      error: errorMessage(error),
    };
    port.postMessage(response);
  }
});
