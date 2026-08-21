/**
 * Produces an accurate, hunk-grouped unified diff between two text blobs.
 *
 * The previous power/diff route compared lines positionally (line i vs line i), which mislabels
 * every line after a single insertion or deletion as "changed". This module computes a real
 * longest-common-subsequence (LCS) alignment and emits standard `@@` hunks, so the diff the model
 * (and the chat timeline) sees reflects the minimal edit — the foundation both files.diff and the
 * exact-replace files.edit tool rely on for accuracy.
 */

export interface UnifiedDiffOptions {
  contextLines?: number;
  fromLabel?: string;
  toLabel?: string;
}

export interface UnifiedDiffResult {
  diff: string;
  added: number;
  removed: number;
  /** Number of distinct change hunks — a quick "how surgical was this edit" signal. */
  hunks: number;
  /** True when both inputs are identical. */
  unchanged: boolean;
}

type Op = 'eq' | 'add' | 'del';
interface DiffLine {
  op: Op;
  text: string;
}

/** Splits text into lines without inventing a trailing empty line for a final newline. */
function toLines(text: string): string[] {
  if (text === '') return [];
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // A trailing newline yields a final '' element; drop it so line counts match the editor.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Classic LCS over two line arrays. Inputs are bounded by the read/write caps upstream, so the
 * O(n*m) table is acceptable; we still cap the table to avoid pathological memory on huge files
 * and fall back to a coarse replace-all diff beyond the cap.
 */
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;

  // Guard: a full LCS table over very large files is wasteful. Beyond ~4M cells, emit a simple
  // delete-all / add-all diff rather than risk a multi-second stall inside the bridge.
  if (n * m > 4_000_000) {
    return [
      ...oldLines.map((text): DiffLine => ({ op: 'del', text })),
      ...newLines.map((text): DiffLine => ({ op: 'add', text })),
    ];
  }

  // lcs[i][j] = length of LCS of oldLines[i:] and newLines[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ op: 'eq', text: oldLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: 'del', text: oldLines[i] });
      i++;
    } else {
      out.push({ op: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', text: oldLines[i++] });
  while (j < m) out.push({ op: 'add', text: newLines[j++] });
  return out;
}

/** Builds a unified diff string with `@@` hunk headers and surrounding context. */
export function buildUnifiedDiff(
  oldText: string,
  newText: string,
  options: UnifiedDiffOptions = {},
): UnifiedDiffResult {
  const contextLines = Math.max(0, Math.min(10, Number(options.contextLines ?? 3)));
  const fromLabel = options.fromLabel || 'a';
  const toLabel = options.toLabel || 'b';

  if (oldText === newText) {
    return { diff: '', added: 0, removed: 0, hunks: 0, unchanged: true };
  }

  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  const ops = diffLines(oldLines, newLines);

  // Mark which op indices are "interesting" (a change) and which are eq, then group changes into
  // hunks, padding each with up to `contextLines` of surrounding equal lines.
  const changeIdx: number[] = [];
  ops.forEach((line, idx) => {
    if (line.op !== 'eq') changeIdx.push(idx);
  });
  if (changeIdx.length === 0) {
    return { diff: '', added: 0, removed: 0, hunks: 0, unchanged: true };
  }

  interface Hunk {
    start: number;
    end: number;
  }
  const hunks: Hunk[] = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  let added = 0;
  let removed = 0;
  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];

  // Track 1-based line numbers in the old and new files as we walk the op stream.
  const oldLineAt: number[] = new Array(ops.length);
  const newLineAt: number[] = new Array(ops.length);
  let oldCursor = 1;
  let newCursor = 1;
  ops.forEach((line, idx) => {
    oldLineAt[idx] = oldCursor;
    newLineAt[idx] = newCursor;
    if (line.op === 'eq') {
      oldCursor++;
      newCursor++;
    } else if (line.op === 'del') {
      oldCursor++;
    } else {
      newCursor++;
    }
  });

  for (const hunk of hunks) {
    let oldCount = 0;
    let newCount = 0;
    for (let idx = hunk.start; idx <= hunk.end; idx++) {
      if (ops[idx].op !== 'add') oldCount++;
      if (ops[idx].op !== 'del') newCount++;
    }
    const oldStart = oldCount === 0 ? oldLineAt[hunk.start] - 1 : oldLineAt[hunk.start];
    const newStart = newCount === 0 ? newLineAt[hunk.start] - 1 : newLineAt[hunk.start];
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let idx = hunk.start; idx <= hunk.end; idx++) {
      const { op, text } = ops[idx];
      if (op === 'eq') lines.push(` ${text}`);
      else if (op === 'del') {
        lines.push(`-${text}`);
        removed++;
      } else {
        lines.push(`+${text}`);
        added++;
      }
    }
  }

  return {
    diff: lines.join('\n'),
    added,
    removed,
    hunks: hunks.length,
    unchanged: false,
  };
}
