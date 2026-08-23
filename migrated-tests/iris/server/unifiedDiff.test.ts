/**
 * Guards the LCS-based unified diff that backs files.diff and the files.edit auto-save preview.
 * The old positional diff mislabeled every line after an insertion as changed; these cases lock
 * in the minimal-edit behavior (single insertion, single deletion, replacement, no-op).
 */

import { describe, expect, it } from 'vitest'
import { buildUnifiedDiff } from '../../server/desktopBridge/shared/unifiedDiff'

describe('buildUnifiedDiff', () => {
  it('reports no change for identical content', () => {
    const result = buildUnifiedDiff('a\nb\nc\n', 'a\nb\nc\n')
    expect(result.unchanged).toBe(true)
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.diff).toBe('')
  })

  it('treats a single insertion as one added line, not a cascade', () => {
    const before = 'line1\nline2\nline3\n'
    const after = 'line1\nINSERTED\nline2\nline3\n'
    const result = buildUnifiedDiff(before, after)
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.hunks).toBe(1)
    expect(result.diff).toContain('+INSERTED')
    // Unchanged neighbours must appear as context, never as -/+ churn.
    expect(result.diff).not.toContain('-line2')
    expect(result.diff).not.toContain('-line3')
  })

  it('treats a single deletion as one removed line', () => {
    const result = buildUnifiedDiff('a\nb\nc\nd\n', 'a\nc\nd\n')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(1)
    expect(result.diff).toContain('-b')
  })

  it('counts a replacement as one add and one remove', () => {
    const result = buildUnifiedDiff('alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\n')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.diff).toContain('-beta')
    expect(result.diff).toContain('+BETA')
  })

  it('emits standard @@ hunk headers', () => {
    const result = buildUnifiedDiff('a\nb\nc\n', 'a\nb\nc\nd\n')
    expect(result.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
  })
})
