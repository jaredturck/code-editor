/** Verifies the benchmarkable concept math keeps deterministic spherical-clustering behavior. */

import { describe, expect, it } from 'vitest';
import {
  conceptDotRows,
  nearestConceptCentroid,
  normalizeConceptRowsInPlace,
  trainConceptCentroids,
} from '../../server/desktopBridge/services/fileConceptMath';

describe('file concept math', () => {
  it('normalizes contiguous vector rows in place', () => {
    const vectors = new Float32Array([3, 4, 0, 0, 0, 5]);

    normalizeConceptRowsInPlace(vectors, 3);

    const normalized = Array.from(vectors);
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
    expect(normalized.slice(2)).toEqual([0, 0, 0, 1]);
  });

  it('selects the strongest centroid by dot product', () => {
    const vector = new Float32Array([1, 0]);
    const centroids = new Float32Array([0, 1, 1, 0]);

    expect(conceptDotRows(vector, 0, centroids, 2, 2)).toBe(1);
    expect(nearestConceptCentroid(vector, 0, centroids, 2, 2)).toBe(1);
  });

  it('trains deterministic normalized centroids', () => {
    const sample = new Float32Array([1, 0, 0.9, 0.1, 0, 1, 0.1, 0.9]);

    const first = trainConceptCentroids(sample.slice(), 2, 2, 4, 17);
    const second = trainConceptCentroids(sample.slice(), 2, 2, 4, 17);

    expect(Array.from(first)).toEqual(Array.from(second));
    for (let offset = 0; offset < first.length; offset += 2) {
      expect(Math.hypot(first[offset], first[offset + 1])).toBeCloseTo(1, 5);
    }
  });
});
