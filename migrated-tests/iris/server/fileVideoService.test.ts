import { describe, expect, it } from 'vitest'
import {
  calculateVideoFrameBudget,
  calculateVideoThumbnailTimestamp,
  videoProbeTimestamps,
} from '../../server/desktopBridge/services/fileVideoService'

describe('file video service', () => {
  it('uses dense sampling for short videos and logarithmic growth for long videos', () => {
    expect(calculateVideoFrameBudget(0.2)).toBe(1)
    expect(calculateVideoFrameBudget(5)).toBe(2)
    expect(calculateVideoFrameBudget(30)).toBe(10)
    expect(calculateVideoFrameBudget(60)).toBe(20)
    expect(calculateVideoFrameBudget(180)).toBe(30)
    expect(calculateVideoFrameBudget(600)).toBe(40)
    expect(calculateVideoFrameBudget(7200)).toBe(62)
    expect(calculateVideoFrameBudget(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('keeps short scene probes dense while capping extreme videos', () => {
    const short = videoProbeTimestamps(10)
    expect(short).toHaveLength(20)
    expect(short[0]).toBeGreaterThan(0)
    expect(short.at(-1)).toBeLessThan(10)

    const long = videoProbeTimestamps(24 * 60 * 60)
    expect(long).toHaveLength(600)
    expect(long[0]).toBeGreaterThan(0)
    expect(long.at(-1)).toBeLessThan(24 * 60 * 60)
  })

  it('chooses an early thumbnail frame without using frame zero', () => {
    expect(calculateVideoThumbnailTimestamp(0.5)).toBe(0.25)
    expect(calculateVideoThumbnailTimestamp(2)).toBe(1)
    expect(calculateVideoThumbnailTimestamp(4)).toBe(1)
    expect(calculateVideoThumbnailTimestamp(10)).toBe(2.5)
    expect(calculateVideoThumbnailTimestamp(60)).toBe(5)
    expect(calculateVideoThumbnailTimestamp(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
