/** Keeps dictated text from merging into surrounding note content while preserving raw words. */
export function insertTranscriptAtSelection(
  content: string,
  transcript: string,
  selectionStart: number,
  selectionEnd: number,
): { content: string; cursor: number } {
  const source = String(content || '')
  const text = String(transcript || '').trim()
  const start = Math.max(0, Math.min(Number(selectionStart) || 0, source.length))
  const end = Math.max(start, Math.min(Number(selectionEnd) || start, source.length))
  if (!text) return { content: source, cursor: start }

  const before = source.slice(0, start)
  const after = source.slice(end)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && !/^\s|^[,.;:!?)]/.test(after) ? ' ' : ''
  const inserted = `${prefix}${text}${suffix}`

  return {
    content: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  }
}
