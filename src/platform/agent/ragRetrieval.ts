/**
 * Query-time filesystem RAG helpers. File contents stay on disk: candidate files
 * are read on demand, split into temporary in-memory passages, ranked, and then
 * discarded when the tool call finishes.
 */

export interface RagCandidateFile {
  path: string
  name?: string
  summary?: string
  semanticScore?: number
  content: string
}

export interface RagPassage {
  path: string
  name: string
  startLine: number
  endLine: number
  content: string
  score: number
  semanticScore: number
  matchedTerms: string[]
}

interface TemporaryChunk {
  path: string
  name: string
  startLine: number
  endLine: number
  content: string
  semanticScore: number
  summary: string
}

const DEFAULT_CHUNK_LINES = 80
const DEFAULT_OVERLAP_LINES = 12
const DEFAULT_MAX_CHARS = 7000

function normalizeTerms(query: string): string[] {
  return Array.from(
    new Set(
      String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ).slice(0, 24)
}

function trimChunk(lines: string[], maxChars: number): string {
  const joined = lines.join('\n').trim()
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars).trimEnd()
}

export function buildTemporaryRagChunks(
  files: RagCandidateFile[],
  chunkLines = DEFAULT_CHUNK_LINES,
  overlapLines = DEFAULT_OVERLAP_LINES,
  maxChars = DEFAULT_MAX_CHARS,
): TemporaryChunk[] {
  const safeChunkLines = Math.max(20, Math.min(240, Math.round(chunkLines)))
  const safeOverlap = Math.max(0, Math.min(safeChunkLines - 1, Math.round(overlapLines)))
  const step = Math.max(1, safeChunkLines - safeOverlap)
  const chunks: TemporaryChunk[] = []

  for (const file of files) {
    const content = String(file.content || '')
    if (!content.trim()) continue
    const lines = content.split(/\r?\n/)
    for (let start = 0; start < lines.length; start += step) {
      const selected = lines.slice(start, start + safeChunkLines)
      const chunk = trimChunk(selected, maxChars)
      if (!chunk) continue
      chunks.push({
        path: file.path,
        name: String(file.name || file.path.split(/[\\/]/).pop() || file.path),
        startLine: start + 1,
        endLine: Math.min(lines.length, start + selected.length),
        content: chunk,
        semanticScore: Number(file.semanticScore) || 0,
        summary: String(file.summary || ''),
      })
      if (start + safeChunkLines >= lines.length) break
    }
  }

  return chunks
}

function scoreChunk(chunk: TemporaryChunk, terms: string[]): { score: number; matchedTerms: string[] } {
  const content = chunk.content.toLowerCase()
  const path = chunk.path.toLowerCase()
  const summary = chunk.summary.toLowerCase()
  const matchedTerms = terms.filter((term) => content.includes(term) || path.includes(term) || summary.includes(term))
  const contentMatches = matchedTerms.filter((term) => content.includes(term)).length
  const pathMatches = matchedTerms.filter((term) => path.includes(term)).length
  const summaryMatches = matchedTerms.filter((term) => summary.includes(term)).length
  const exactPhrase = terms.length > 1 && content.includes(terms.join(' ')) ? 2.5 : 0
  const density = terms.length ? matchedTerms.length / terms.length : 0
  const score =
    chunk.semanticScore * 4 +
    contentMatches * 1.4 +
    pathMatches * 1.8 +
    summaryMatches * 0.8 +
    density * 3 +
    exactPhrase
  return { score, matchedTerms }
}

export function rankRagPassages(query: string, files: RagCandidateFile[], maxPassages = 12): RagPassage[] {
  const terms = normalizeTerms(query)
  const chunks = buildTemporaryRagChunks(files)
  const ranked = chunks
    .map((chunk) => ({ chunk, ...scoreChunk(chunk, terms) }))
    .sort((left, right) => right.score - left.score)

  const selected: RagPassage[] = []
  const perFile = new Map<string, number>()
  for (const item of ranked) {
    const count = perFile.get(item.chunk.path) || 0
    if (count >= 3) continue
    selected.push({
      path: item.chunk.path,
      name: item.chunk.name,
      startLine: item.chunk.startLine,
      endLine: item.chunk.endLine,
      content: item.chunk.content,
      score: Math.round(item.score * 1000) / 1000,
      semanticScore: item.chunk.semanticScore,
      matchedTerms: item.matchedTerms,
    })
    perFile.set(item.chunk.path, count + 1)
    if (selected.length >= Math.max(1, Math.min(30, Math.round(maxPassages)))) break
  }
  return selected
}
