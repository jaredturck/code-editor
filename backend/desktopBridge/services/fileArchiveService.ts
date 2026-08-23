/**
 * Provides content-based ZIP package detection and a bounded generic archive fallback.
 * Known Office/OpenDocument packages are streamed by fileDocumentService; this module keeps
 * the cheap signature helpers and selects one text-like sample from an unknown ZIP.
 */

import fs from 'node:fs'
import { AsyncUnzipInflate, Unzip, UnzipPassThrough, strFromU8, unzipSync } from 'fflate'

const ZIP_SAMPLE_ENTRY_LIMIT = 20
const ZIP_SAMPLE_BYTES_PER_ENTRY = 512
const ZIP_SAMPLE_MAX_DEPTH = 1
const ZIP_TEXT_SCORE_THRESHOLD = 0.48
const ZIP_READ_CHUNK_BYTES = 64 * 1024
const OFFICE_MARKER_NAMES = new Set(['mimetype', 'META-INF/manifest.xml'])

export type OfficePackageType = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp'

export interface GenericZipTextResult {
  text: string
  entryName: string
  inspectedEntries: number
}

interface ZipTextCandidate {
  text: string
  entryName: string
  score: number
}

interface GenericZipState {
  inspectedEntries: number
  pendingEntries: number
  streamEnded: boolean
  settled: boolean
  candidates: ZipTextCandidate[]
}

function abortError(): Error {
  const error = new Error('Archive extraction was cancelled')
  error.name = 'AbortError'
  return error
}

function normalizedZipPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function zipPathDepth(value: string): number {
  return normalizedZipPath(value).split('/').filter(Boolean).length - 1
}

function isEligibleZipEntry(name: string, originalSize?: number): boolean {
  const normalized = normalizedZipPath(name)
  return Boolean(
    normalized && !normalized.endsWith('/') && zipPathDepth(normalized) <= ZIP_SAMPLE_MAX_DEPTH && originalSize !== 0,
  )
}

function textCandidateScore(buffer: Buffer, entryName: string): number {
  if (!buffer.length || buffer.includes(0)) return Number.NEGATIVE_INFINITY

  const text = buffer.toString('utf8')
  const replacementCount = text.split('\uFFFD').length - 1
  if (replacementCount / Math.max(1, text.length) > 0.02) {
    return Number.NEGATIVE_INFINITY
  }

  const characters = [...text]
  if (!characters.length) return Number.NEGATIVE_INFINITY

  let printableCount = 0
  let whitespaceCount = 0
  let controlCount = 0
  for (const character of characters) {
    const code = character.codePointAt(0) || 0
    if (character === '\n' || character === '\r' || character === '\t') {
      whitespaceCount += 1
      printableCount += 1
    } else if (code >= 32 && code !== 127) {
      printableCount += 1
    } else {
      controlCount += 1
    }
  }

  const alphaNumericCount = text.match(/[\p{L}\p{N}]/gu)?.length || 0
  const wordCount = text.match(/[\p{L}\p{N}]{2,}/gu)?.length || 0
  const frequencies = new Map<number, number>()
  for (const byte of buffer) {
    frequencies.set(byte, (frequencies.get(byte) || 0) + 1)
  }
  const dominantCount = Math.max(...frequencies.values())
  const dominantRatio = dominantCount / buffer.length
  const printableRatio = printableCount / characters.length
  const alphaNumericRatio = alphaNumericCount / characters.length
  const whitespaceRatio = whitespaceCount / characters.length
  const controlRatio = controlCount / characters.length
  const wordScore = Math.min(1, wordCount / 8)
  const whitespaceScore = Math.min(1, whitespaceRatio / 0.18)
  const repetitionPenalty = Math.max(0, dominantRatio - 0.35)
  const rootBonus = zipPathDepth(entryName) === 0 ? 0.03 : 0

  return (
    printableRatio * 0.35 +
    alphaNumericRatio * 0.4 +
    wordScore * 0.18 +
    whitespaceScore * 0.07 +
    rootBonus -
    controlRatio * 0.8 -
    repetitionPenalty * 0.6
  )
}

function normalizedCandidateText(buffer: Buffer): string {
  return buffer
    .toString('utf8')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function odfTypeFromMime(value: string): OfficePackageType | null {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('opendocument.text')) return 'odt'
  if (normalized.includes('opendocument.spreadsheet')) return 'ods'
  if (normalized.includes('opendocument.presentation')) return 'odp'
  return null
}

/** Checks the cheap content signature used by ZIP and ZIP-based office packages. */
export function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  )
}

/** Detects the Office/OpenDocument family from package contents for a parser retry. */
export function detectOfficePackageType(buffer: Buffer): OfficePackageType | null {
  if (!hasZipSignature(buffer)) return null
  const names = new Set<string>()
  let markerFiles: Record<string, Uint8Array> = {}

  try {
    markerFiles = unzipSync(buffer, {
      filter(file) {
        const name = normalizedZipPath(file.name)
        names.add(name)
        return OFFICE_MARKER_NAMES.has(name)
      },
    })
  } catch {
    return null
  }

  if (names.has('word/document.xml')) return 'docx'
  if (names.has('xl/workbook.xml')) return 'xlsx'
  if (names.has('ppt/presentation.xml')) return 'pptx'

  const mimeFile = markerFiles.mimetype
  if (mimeFile) {
    const detected = odfTypeFromMime(strFromU8(mimeFile))
    if (detected) return detected
  }

  const manifest = markerFiles['META-INF/manifest.xml']
  if (manifest) return odfTypeFromMime(strFromU8(manifest))
  return null
}

function bestZipCandidate(candidates: ZipTextCandidate[], inspectedEntries: number): GenericZipTextResult | null {
  candidates.sort((left, right) => right.score - left.score || left.entryName.localeCompare(right.entryName))
  const best = candidates[0]
  if (!best || best.score < ZIP_TEXT_SCORE_THRESHOLD) return null
  return {
    text: best.text,
    entryName: best.entryName,
    inspectedEntries,
  }
}

/**
 * Samples at most twenty root or one-level-deep entries and returns the single most
 * text-like 512-byte prefix. Entries are streamed and never extracted to disk.
 */
export async function extractGenericZipText(
  filePath: string,
  signal: AbortSignal,
): Promise<GenericZipTextResult | null> {
  if (signal.aborted) throw abortError()

  return new Promise((resolve, reject) => {
    const state: GenericZipState = {
      inspectedEntries: 0,
      pendingEntries: 0,
      streamEnded: false,
      settled: false,
      candidates: [],
    }
    const stream = fs.createReadStream(filePath, {
      highWaterMark: ZIP_READ_CHUNK_BYTES,
    })

    const finish = () => {
      if (state.settled) return
      if (!state.streamEnded && state.inspectedEntries < ZIP_SAMPLE_ENTRY_LIMIT) {
        return
      }
      if (state.pendingEntries > 0) return
      state.settled = true
      signal.removeEventListener('abort', cancel)
      stream.destroy()
      resolve(bestZipCandidate(state.candidates, state.inspectedEntries))
    }

    const fail = (error: unknown) => {
      if (state.settled) return
      state.settled = true
      signal.removeEventListener('abort', cancel)
      stream.destroy()
      reject(error)
    }

    const cancel = () => fail(abortError())
    signal.addEventListener('abort', cancel, { once: true })

    const unzip = new Unzip((file) => {
      if (
        state.settled ||
        state.inspectedEntries >= ZIP_SAMPLE_ENTRY_LIMIT ||
        !isEligibleZipEntry(file.name, file.originalSize)
      ) {
        return
      }

      state.inspectedEntries += 1
      state.pendingEntries += 1
      const chunks: Buffer[] = []
      let collectedBytes = 0
      let entryFinished = false

      const finishEntry = () => {
        if (entryFinished) return
        entryFinished = true
        state.pendingEntries -= 1
        const sample = Buffer.concat(chunks, collectedBytes)
        const text = normalizedCandidateText(sample)
        if (text) {
          state.candidates.push({
            text,
            entryName: normalizedZipPath(file.name),
            score: textCandidateScore(sample, file.name),
          })
        }
        finish()
      }

      file.ondata = (error, chunk, final) => {
        if (entryFinished) return
        if (error) {
          finishEntry()
          return
        }
        if (chunk?.length && collectedBytes < ZIP_SAMPLE_BYTES_PER_ENTRY) {
          const remaining = ZIP_SAMPLE_BYTES_PER_ENTRY - collectedBytes
          const sample = Buffer.from(chunk.subarray(0, remaining))
          chunks.push(sample)
          collectedBytes += sample.length
        }
        if (collectedBytes >= ZIP_SAMPLE_BYTES_PER_ENTRY || final) {
          if (!final) {
            const terminable = file as typeof file & { terminate?: () => void }
            terminable.terminate?.()
          }
          finishEntry()
        }
      }

      try {
        file.start()
      } catch {
        finishEntry()
      }
    })

    unzip.register(UnzipPassThrough)
    unzip.register(AsyncUnzipInflate)

    stream.on('data', (chunk) => {
      if (state.settled) return
      try {
        unzip.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, false)
      } catch (error) {
        fail(error)
      }
    })
    stream.on('end', () => {
      if (state.settled) return
      state.streamEnded = true
      try {
        unzip.push(new Uint8Array(), true)
      } catch (error) {
        fail(error)
        return
      }
      finish()
    })
    stream.on('error', fail)
  })
}
