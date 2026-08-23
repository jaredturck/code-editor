/**
 * Extracts a small searchable prefix from ZIP-based Office/OpenDocument packages.
 * Known packages are opened lazily, only content-bearing XML entries are decompressed,
 * and extraction stops as soon as enough useful text exists. Unknown ZIPs use the
 * bounded generic archive fallback.
 */

import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { extractGenericZipText, type OfficePackageType } from './fileArchiveService.js'

const DOCUMENT_TARGET_CHARS = 2048
const DOCUMENT_MAX_CHARS = 4096
const DOCUMENT_MAX_XML_BYTES = 2 * 1024 * 1024
const DOCUMENT_MAX_ZIP_ENTRIES = 20_000
const DOCUMENT_PARSE_TIMEOUT_MS = 5_000
const PRESENTATION_MAX_SLIDES = 8
const SPREADSHEET_MAX_SHEETS = 2
const SMALL_ENTRY_MAX_BYTES = 4096

export type DocumentExtractionMethod =
  'streaming-docx' | 'streaming-xlsx' | 'streaming-pptx' | 'streaming-odf' | 'zip-fallback'

export interface DocumentTextResult {
  text: string
  sourceType: OfficePackageType | 'zip'
  extractionMethod: DocumentExtractionMethod
  archiveEntry?: string
}

interface ZipPackage {
  zipFile: ZipFile
  entries: Map<string, Entry>
}

class TextCollector {
  private value = ''

  addText(value: string): void {
    if (!value || this.value.length >= DOCUMENT_MAX_CHARS) return
    this.value += value.slice(0, DOCUMENT_MAX_CHARS - this.value.length)
  }

  addBoundary(): void {
    if (!this.value || /\s$/.test(this.value)) return
    this.addText('\n')
  }

  reachedTarget(): boolean {
    return this.normalized().length >= DOCUMENT_TARGET_CHARS
  }

  normalized(): string {
    return this.value
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

function abortError(): Error {
  const error = new Error('Document extraction was cancelled')
  error.name = 'AbortError'
  return error
}

function normalizeZipPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function hasUsefulDocumentText(value: string): boolean {
  return (value.match(/[\p{L}\p{N}]/gu)?.length || 0) >= 4
}

function entryNumber(name: string): number {
  const match = name.match(/(\d+)(?:\.xml)?$/i)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function sortedEntries(entries: Iterable<Entry>, pattern: RegExp): Entry[] {
  return [...entries]
    .filter((entry) => pattern.test(normalizeZipPath(entry.fileName)))
    .sort(
      (left, right) =>
        entryNumber(left.fileName) - entryNumber(right.fileName) || left.fileName.localeCompare(right.fileName),
    )
}

function tagAttribute(tag: SaxesTagNS, localName: string): string {
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.local === localName || attribute.name === localName) {
      return attribute.value
    }
  }
  return ''
}

function openZip(filePath: string, signal: AbortSignal): Promise<ZipFile> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    yauzl.open(
      filePath,
      {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        signal.removeEventListener('abort', cancel)
        if (error || !zipFile) {
          reject(error || new Error('Unable to open ZIP package'))
          return
        }
        resolve(zipFile)
      },
    )
  })
}

function listZipEntries(zipFile: ZipFile, signal: AbortSignal): Promise<Map<string, Entry>> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>()
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', cancel)
      zipFile.removeListener('entry', onEntry)
      zipFile.removeListener('end', onEnd)
      zipFile.removeListener('error', onError)
    }
    const finish = (value: Map<string, Entry>) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const cancel = () => fail(abortError())
    const onError = (error: Error) => fail(error)
    const onEnd = () => finish(entries)
    const onEntry = (entry: Entry) => {
      const name = normalizeZipPath(entry.fileName)
      if (name && !name.endsWith('/')) entries.set(name, entry)
      if (entries.size >= DOCUMENT_MAX_ZIP_ENTRIES) {
        finish(entries)
        return
      }
      zipFile.readEntry()
    }

    signal.addEventListener('abort', cancel, { once: true })
    zipFile.on('entry', onEntry)
    zipFile.once('end', onEnd)
    zipFile.once('error', onError)
    zipFile.readEntry()
  })
}

async function openZipPackage(filePath: string, signal: AbortSignal): Promise<ZipPackage> {
  const zipFile = await openZip(filePath, signal)
  try {
    const entries = await listZipEntries(zipFile, signal)
    return { zipFile, entries }
  } catch (error) {
    zipFile.close()
    throw error
  }
}

function openEntryStream(zipFile: ZipFile, entry: Entry, signal: AbortSignal): Promise<Readable> {
  if (signal.aborted) return Promise.reject(abortError())
  if (entry.isEncrypted()) return Promise.reject(new Error('Encrypted ZIP entry'))
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    zipFile.openReadStream(entry, (error, stream) => {
      signal.removeEventListener('abort', cancel)
      if (error || !stream) {
        reject(error || new Error('Unable to read ZIP entry'))
        return
      }
      resolve(stream)
    })
  })
}

async function readSmallEntry(zipFile: ZipFile, entry: Entry, signal: AbortSignal): Promise<string> {
  const stream = await openEntryStream(zipFile, entry, signal)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const cleanup = () => signal.removeEventListener('abort', cancel)
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, size).toString('utf8'))
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const cancel = () => {
      stream.destroy()
      fail(abortError())
    }

    signal.addEventListener('abort', cancel, { once: true })
    stream.on('data', (chunk: Buffer) => {
      if (size >= SMALL_ENTRY_MAX_BYTES) return
      const remaining = SMALL_ENTRY_MAX_BYTES - size
      const part = Buffer.from(chunk.subarray(0, remaining))
      chunks.push(part)
      size += part.length
      if (size >= SMALL_ENTRY_MAX_BYTES) stream.destroy()
    })
    stream.once('end', finish)
    stream.once('close', finish)
    stream.once('error', fail)
  })
}

interface XmlExtractionOptions {
  onOpen?: (tag: SaxesTagNS, collector: TextCollector) => void
  onText: (text: string, collector: TextCollector) => void
  onClose?: (tag: SaxesTagNS, collector: TextCollector) => void
}

async function readXmlEntry(
  zipFile: ZipFile,
  entry: Entry,
  collector: TextCollector,
  options: XmlExtractionOptions,
  signal: AbortSignal,
): Promise<void> {
  const stream = await openEntryStream(zipFile, entry, signal)
  await new Promise<void>((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    const parser = new SaxesParser({ xmlns: true })
    let decompressedBytes = 0
    let settled = false

    const cleanup = () => signal.removeEventListener('abort', cancel)
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const cancel = () => {
      stream.destroy()
      fail(abortError())
    }

    parser.on('opentag', (tag) => options.onOpen?.(tag, collector))
    parser.on('text', (text) => options.onText(text, collector))
    parser.on('cdata', (text) => options.onText(text, collector))
    parser.on('closetag', (tag) => options.onClose?.(tag, collector))
    parser.on('error', () => {
      stream.destroy()
      finish()
    })

    signal.addEventListener('abort', cancel, { once: true })
    stream.on('data', (chunk: Buffer) => {
      if (settled) return
      decompressedBytes += chunk.length
      try {
        parser.write(decoder.write(chunk))
      } catch {
        stream.destroy()
        finish()
        return
      }
      if (collector.reachedTarget() || decompressedBytes >= DOCUMENT_MAX_XML_BYTES) {
        stream.destroy()
        finish()
      }
    })
    stream.once('end', () => {
      if (settled) return
      try {
        const tail = decoder.end()
        if (tail) parser.write(tail)
        parser.close()
      } catch {
        // Collected text remains usable even when trailing XML is malformed.
      }
      finish()
    })
    stream.once('close', finish)
    stream.once('error', fail)
  })
}

async function extractDocx(pkg: ZipPackage, signal: AbortSignal): Promise<string> {
  const entry = pkg.entries.get('word/document.xml')
  if (!entry) return ''
  const collector = new TextCollector()
  let captureText = false
  await readXmlEntry(
    pkg.zipFile,
    entry,
    collector,
    {
      onOpen(tag) {
        if (tag.local === 't') captureText = true
        if (tag.local === 'tab') collector.addText(' ')
      },
      onText(text) {
        if (captureText) collector.addText(text)
      },
      onClose(tag) {
        if (tag.local === 't') captureText = false
        if (tag.local === 'p' || tag.local === 'tr') {
          collector.addBoundary()
        }
      },
    },
    signal,
  )
  return collector.normalized()
}

async function extractPptx(pkg: ZipPackage, signal: AbortSignal): Promise<string> {
  const slides = sortedEntries(pkg.entries.values(), /^ppt\/slides\/slide\d+\.xml$/i).slice(0, PRESENTATION_MAX_SLIDES)
  const collector = new TextCollector()

  for (const entry of slides) {
    if (collector.reachedTarget()) break
    let captureText = false
    await readXmlEntry(
      pkg.zipFile,
      entry,
      collector,
      {
        onOpen(tag) {
          if (tag.local === 't') captureText = true
        },
        onText(text) {
          if (captureText) collector.addText(text)
        },
        onClose(tag) {
          if (tag.local === 't') captureText = false
          if (tag.local === 'p') collector.addBoundary()
        },
      },
      signal,
    )
    collector.addBoundary()
  }
  return collector.normalized()
}

async function extractWorkbookNames(pkg: ZipPackage, collector: TextCollector, signal: AbortSignal): Promise<void> {
  const workbook = pkg.entries.get('xl/workbook.xml')
  if (!workbook) return
  await readXmlEntry(
    pkg.zipFile,
    workbook,
    collector,
    {
      onOpen(tag) {
        if (tag.local !== 'sheet') return
        const name = tagAttribute(tag, 'name')
        if (name) {
          collector.addText(name)
          collector.addBoundary()
        }
      },
      onText() {},
    },
    signal,
  )
}

async function extractSharedStrings(pkg: ZipPackage, collector: TextCollector, signal: AbortSignal): Promise<void> {
  const entry = pkg.entries.get('xl/sharedStrings.xml')
  if (!entry) return
  let captureText = false
  await readXmlEntry(
    pkg.zipFile,
    entry,
    collector,
    {
      onOpen(tag) {
        if (tag.local === 't') captureText = true
      },
      onText(text) {
        if (captureText) collector.addText(text)
      },
      onClose(tag) {
        if (tag.local === 't') captureText = false
        if (tag.local === 'si') collector.addBoundary()
      },
    },
    signal,
  )
}

async function extractWorksheet(
  pkg: ZipPackage,
  entry: Entry,
  collector: TextCollector,
  signal: AbortSignal,
): Promise<void> {
  let cellType = ''
  let capture: 'text' | 'value' | 'formula' | '' = ''
  await readXmlEntry(
    pkg.zipFile,
    entry,
    collector,
    {
      onOpen(tag) {
        if (tag.local === 'c') cellType = tagAttribute(tag, 't')
        if (tag.local === 't') capture = 'text'
        if (tag.local === 'v' && cellType !== 's') capture = 'value'
        if (tag.local === 'f') capture = 'formula'
      },
      onText(text) {
        if (capture) collector.addText(text)
      },
      onClose(tag) {
        if (tag.local === 't' || tag.local === 'v' || tag.local === 'f') {
          capture = ''
        }
        if (tag.local === 'c') {
          cellType = ''
          collector.addBoundary()
        }
      },
    },
    signal,
  )
}

async function extractXlsx(pkg: ZipPackage, signal: AbortSignal): Promise<string> {
  const collector = new TextCollector()
  await extractWorkbookNames(pkg, collector, signal)
  if (!collector.reachedTarget()) {
    await extractSharedStrings(pkg, collector, signal)
  }
  if (!collector.reachedTarget()) {
    const sheets = sortedEntries(pkg.entries.values(), /^xl\/worksheets\/sheet\d+\.xml$/i).slice(
      0,
      SPREADSHEET_MAX_SHEETS,
    )
    for (const sheet of sheets) {
      if (collector.reachedTarget()) break
      await extractWorksheet(pkg, sheet, collector, signal)
    }
  }
  return collector.normalized()
}

async function extractOdf(pkg: ZipPackage, signal: AbortSignal): Promise<string> {
  const entry = pkg.entries.get('content.xml')
  if (!entry) return ''
  const collector = new TextCollector()
  let captureDepth = 0
  let depth = 0

  await readXmlEntry(
    pkg.zipFile,
    entry,
    collector,
    {
      onOpen(tag) {
        depth += 1
        if (!captureDepth && (tag.local === 'p' || tag.local === 'h')) {
          captureDepth = depth
        }
        if (captureDepth && (tag.local === 's' || tag.local === 'tab')) {
          collector.addText(' ')
        }
      },
      onText(text) {
        if (captureDepth) collector.addText(text)
      },
      onClose() {
        if (captureDepth === depth) {
          captureDepth = 0
          collector.addBoundary()
        }
        depth = Math.max(0, depth - 1)
      },
    },
    signal,
  )
  return collector.normalized()
}

async function detectPackageType(pkg: ZipPackage, signal: AbortSignal): Promise<OfficePackageType | null> {
  if (pkg.entries.has('word/document.xml')) return 'docx'
  if (pkg.entries.has('xl/workbook.xml')) return 'xlsx'
  if (pkg.entries.has('ppt/presentation.xml')) return 'pptx'
  if (!pkg.entries.has('content.xml')) return null

  const mimeEntry = pkg.entries.get('mimetype')
  const manifestEntry = pkg.entries.get('META-INF/manifest.xml')
  const mime = mimeEntry
    ? await readSmallEntry(pkg.zipFile, mimeEntry, signal)
    : manifestEntry
      ? await readSmallEntry(pkg.zipFile, manifestEntry, signal)
      : ''
  const normalized = mime.toLowerCase()
  if (normalized.includes('opendocument.text')) return 'odt'
  if (normalized.includes('opendocument.spreadsheet')) return 'ods'
  if (normalized.includes('opendocument.presentation')) return 'odp'
  return null
}

async function extractKnownPackage(
  pkg: ZipPackage,
  sourceType: OfficePackageType,
  signal: AbortSignal,
): Promise<string> {
  if (sourceType === 'docx') return extractDocx(pkg, signal)
  if (sourceType === 'xlsx') return extractXlsx(pkg, signal)
  if (sourceType === 'pptx') return extractPptx(pkg, signal)
  return extractOdf(pkg, signal)
}

async function extractDocumentTextInternal(filePath: string, signal: AbortSignal): Promise<DocumentTextResult | null> {
  let pkg: ZipPackage | null = null
  try {
    pkg = await openZipPackage(filePath, signal)
    const sourceType = await detectPackageType(pkg, signal)
    if (sourceType) {
      const text = await extractKnownPackage(pkg, sourceType, signal)
      if (hasUsefulDocumentText(text)) {
        return {
          text,
          sourceType,
          extractionMethod:
            sourceType === 'docx'
              ? 'streaming-docx'
              : sourceType === 'xlsx'
                ? 'streaming-xlsx'
                : sourceType === 'pptx'
                  ? 'streaming-pptx'
                  : 'streaming-odf',
        }
      }
    }
  } catch (error) {
    if (signal.aborted) throw abortError()
    if (error instanceof Error && error.name === 'AbortError') throw error
  } finally {
    pkg?.zipFile.close()
  }

  const fallback = await extractGenericZipText(filePath, signal).catch((error: unknown) => {
    if (signal.aborted) throw abortError()
    if (error instanceof Error && error.name === 'AbortError') throw error
    return null
  })
  if (!fallback) return null
  return {
    text: fallback.text,
    sourceType: 'zip',
    extractionMethod: 'zip-fallback',
    archiveEntry: fallback.entryName,
  }
}

/**
 * Extracts only enough document text for semantic indexing. The file is never unpacked to
 * disk and known package XML streams are stopped as soon as the target text exists.
 */
export async function extractDocumentText(filePath: string, signal: AbortSignal): Promise<DocumentTextResult | null> {
  if (signal.aborted) throw abortError()
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, DOCUMENT_PARSE_TIMEOUT_MS)
  signal.addEventListener('abort', forwardAbort, { once: true })

  try {
    return await extractDocumentTextInternal(filePath, controller.signal)
  } catch (error) {
    if (signal.aborted) throw abortError()
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      return null
    }
    return null
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', forwardAbort)
  }
}
