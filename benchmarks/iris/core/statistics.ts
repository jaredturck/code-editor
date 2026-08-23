/** Calculates deterministic percentile and dispersion summaries for benchmark samples. */

import type { BenchmarkStatistics } from './types.js'

/** Returns the linearly interpolated percentile from an already sorted sample collection. */
export function percentile(sortedValues: number[], fraction: number): number {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const position = Math.max(0, Math.min(1, fraction)) * (sortedValues.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

/** Summarizes elapsed-time samples without discarding slow-tail observations. */
export function summarizeSamples(samples: number[]): BenchmarkStatistics {
  const sorted = [...samples].sort((left, right) => left - right)
  const totalMs = sorted.reduce((total, value) => total + value, 0)
  const meanMs = sorted.length ? totalMs / sorted.length : 0
  const variance = sorted.length ? sorted.reduce((total, value) => total + (value - meanMs) ** 2, 0) / sorted.length : 0
  return {
    count: sorted.length,
    totalMs,
    meanMs,
    medianMs: percentile(sorted, 0.5),
    minMs: sorted[0] || 0,
    maxMs: sorted.at(-1) || 0,
    p90Ms: percentile(sorted, 0.9),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    standardDeviationMs: Math.sqrt(variance),
  }
}
