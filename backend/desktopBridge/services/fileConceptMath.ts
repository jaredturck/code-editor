/**
 * Provides allocation-conscious spherical clustering primitives shared by concept workers and
 * offline benchmarks. Callers retain ownership of the contiguous Float32Array buffers.
 */

/** Normalizes every row in a contiguous vector matrix without allocating replacement rows. */
export function normalizeConceptRowsInPlace(vectors: Float32Array, dimension: number): void {
  if (!dimension || vectors.length % dimension !== 0) {
    throw new Error('Concept vectors have an invalid dimension');
  }
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

/** Calculates the dot product between two rows stored in contiguous vector matrices. */
export function conceptDotRows(
  left: Float32Array,
  leftOffset: number,
  right: Float32Array,
  rightOffset: number,
  dimension: number,
): number {
  let score = 0;
  for (let column = 0; column < dimension; column += 1) {
    score += left[leftOffset + column] * right[rightOffset + column];
  }
  return score;
}

/** Finds the strongest cosine-equivalent centroid for one already-normalized vector row. */
export function nearestConceptCentroid(
  vectors: Float32Array,
  vectorOffset: number,
  centroids: Float32Array,
  centroidCount: number,
  dimension: number,
): number {
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let centroid = 0; centroid < centroidCount; centroid += 1) {
    const score = conceptDotRows(vectors, vectorOffset, centroids, centroid * dimension, dimension);
    if (score > bestScore) {
      bestIndex = centroid;
      bestScore = score;
    }
  }
  return bestIndex;
}

/** Selects deterministic sample rows as the initial centroids for repeatable concept training. */
export function initializeConceptCentroids(
  vectors: Float32Array,
  dimension: number,
  centroidCount: number,
  seed: number,
): Float32Array {
  const rowCount = vectors.length / dimension;
  if (!rowCount || centroidCount < 1) throw new Error('Concept training sample is empty');
  const centroids = new Float32Array(centroidCount * dimension);
  const stride = Math.max(1, Math.floor(rowCount / centroidCount));
  for (let centroid = 0; centroid < centroidCount; centroid += 1) {
    const sourceRow = (Math.abs(seed) + centroid * stride + centroid * centroid * 17) % rowCount;
    centroids.set(
      vectors.subarray(sourceRow * dimension, sourceRow * dimension + dimension),
      centroid * dimension,
    );
  }
  normalizeConceptRowsInPlace(centroids, dimension);
  return centroids;
}

/** Trains one deterministic spherical k-means model for a local concept partition. */
export function trainConceptCentroids(
  vectors: Float32Array,
  dimension: number,
  centroidCount: number,
  iterations: number,
  seed: number,
): Float32Array {
  normalizeConceptRowsInPlace(vectors, dimension);
  const rowCount = vectors.length / dimension;
  const boundedCount = Math.max(1, Math.min(centroidCount, rowCount));
  let centroids = initializeConceptCentroids(vectors, dimension, boundedCount, seed);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = new Float32Array(boundedCount * dimension);
    const counts = new Int32Array(boundedCount);
    for (let row = 0; row < rowCount; row += 1) {
      const vectorOffset = row * dimension;
      const nearest = nearestConceptCentroid(
        vectors,
        vectorOffset,
        centroids,
        boundedCount,
        dimension,
      );
      counts[nearest] += 1;
      const centroidOffset = nearest * dimension;
      for (let column = 0; column < dimension; column += 1) {
        sums[centroidOffset + column] += vectors[vectorOffset + column];
      }
    }
    for (let centroid = 0; centroid < boundedCount; centroid += 1) {
      const centroidOffset = centroid * dimension;
      if (!counts[centroid]) {
        const sourceRow = (seed + iteration * 131 + centroid * 977) % rowCount;
        sums.set(
          vectors.subarray(sourceRow * dimension, sourceRow * dimension + dimension),
          centroidOffset,
        );
      }
    }
    normalizeConceptRowsInPlace(sums, dimension);
    centroids = sums;
  }
  return centroids;
}
