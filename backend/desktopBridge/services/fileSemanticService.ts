/**
 * Builds and searches IRIS's encrypted semantic filesystem index. The pipeline keeps
 * filesystem scanning, plain text, ZIP-based documents, PDFs, images, and videos in distinct
 * stages while documents and PDFs reuse MiniLM and visual media reuse the CLIP space.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  clearEncryptedFileIndex,
  countEncryptedFilesystemNodes,
  deleteEncryptedFileConceptGenerationsExcept,
  deleteEncryptedFileSemantics,
  deleteEncryptedFilesystemNodes,
  readEncryptedFileConceptMemberships,
  readEncryptedFileConcepts,
  readEncryptedFileEmbeddingProfile,
  readEncryptedFileIndexMeta,
  readEncryptedFileSemantics,
  readEncryptedVideoFrameSemantics,
  readEncryptedFilesystemNodePage,
  readEncryptedFilesystemNodes,
  writeEncryptedFileEmbeddingProfile,
  writeEncryptedFileIndexMeta,
  writeEncryptedFileSemantics,
  writeEncryptedVideoFrameSemantics,
  writeEncryptedFilesystemNodes,
  type EncryptedFileSemanticInput,
  type EncryptedFileConceptEmbeddingSpace,
  type EncryptedFileConceptRecord,
  type EncryptedVideoFrameSemanticInput,
  type EncryptedFilesystemContentKind,
  type EncryptedFilesystemNodeInput,
  type EncryptedFilesystemNodeRecord,
} from '../storage/encryptedDatabase.js'
import { isExcludedDirectoryName, pathContainsExcludedDirectory } from '../shared/fileExclusions.js'
import {
  FILE_CLIP_DEFAULT_BATCH_SIZE,
  FILE_CLIP_MODEL,
  clearFileClipRuntime,
  embedClipPreparedImages,
  embedClipText,
  installFileClipModel,
  isFileClipModelInstalled,
} from './fileClipService.js'
import { hasZipSignature } from './fileArchiveService.js'
import { createFileExtractionPool, type FileExtractionPool } from './fileExtractionPool.js'
import type { FileExtractionKind, FileExtractionResult } from './fileExtractionWorkerTypes.js'
import { createFileImageProcessingPool, type FileImageProcessingPool } from './fileImageProcessingPool.js'
import type { PreparedClipImage } from './fileImageProcessingWorkerTypes.js'
import { FileImageQueue } from './fileImageQueue.js'
import { resolvePreparedImageQueueCapacity } from './fileImageQueueBudget.js'
import { ensureVideoIndexingAvailable, extractVideoFramesForIndex } from './fileVideoService.js'
import {
  FILE_CONCEPT_INDEX_VERSION,
  rebuildFileConceptIndex,
  type FileConceptBuildResult,
} from './fileConceptService.js'
import {
  discoverFileIndexSources,
  fileIndexSourcesFromMeta,
  resolveSelectedFileIndexSources,
  type FileIndexSource,
} from './fileIndexSourceService.js'

export const FILE_IMAGE_DESCRIPTION_MODEL = FILE_CLIP_MODEL
export const FILE_ANALYSIS_MODEL = 'qwen3-vl:4b-instruct'
export const FILE_VISION_MODEL = FILE_ANALYSIS_MODEL
export const FILE_EMBEDDING_MODEL = 'all-minilm:22m'
export const FILE_OLLAMA_URL = 'http://127.0.0.1:11434'

const INDEX_SCHEMA_VERSION = 12
const EMBEDDING_PROFILE_SCHEMA_VERSION = 1
const TEXT_EMBEDDING_INPUT_VERSION = 3
const MAX_TEXT_BYTES = 256
const TEXT_SAMPLE_HEAD_BYTES = 152
const TEXT_SAMPLE_MIDDLE_BYTES = 64
const TEXT_SAMPLE_TAIL_BYTES = 38
const FILE_CLASSIFICATION_BYTES = 1024
const EMBEDDING_CALIBRATION_START_SIZE = 1024
const EMBEDDING_CALIBRATION_CONFIRMATION_RUNS = 1
const EMBEDDING_ETA_WINDOW_SIZE = 5
const STAGE_ETA_WINDOW_SIZE = 64
const EXTRACTED_EMBEDDING_BATCH_SIZE = 128
const EXTRACTED_NODE_PAGE_SIZE = 512
const MAX_ANALYSIS_CHARS = 16000
const ANALYSIS_SINGLE_PASS_CHARS = 500000
const ANALYSIS_CHUNK_CHARS = 350000
const ANALYSIS_COMBINE_GROUP_SIZE = 16
const TEXT_DETECTION_BYTES = 64 * 1024
const NODE_WRITE_BATCH_SIZE = 512
const TEXT_FILE_PREPARE_CONCURRENCY = 64
const TEXT_PERSISTENCE_PENDING_BATCHES = 2
const MODEL_STATUS_CACHE_MS = 3000
const OLLAMA_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const OLLAMA_PULL_TIMEOUT_MS = 60 * 60 * 1000
const DOCUMENT_INPUT_FORMAT_VERSION = 2
const PDF_INPUT_FORMAT_VERSION = 2
const IMAGE_INPUT_FORMAT_VERSION = 2
const VIDEO_INPUT_FORMAT_VERSION = 1
const INDEX_STAGE_COUNT = 8
export const FILE_INDEX_LARGE_SCAN_THRESHOLD = 1_000_000
const PREFLIGHT_CACHE_MS = 10 * 60 * 1000
const PROTECTED_LINUX_PATHS = [
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/lost+found',
  '/opt',
  '/proc',
  '/run',
  '/sbin',
  '/snap',
  '/sys',
  '/usr',
  '/var',
]

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm'])

const PDF_EXTENSIONS = new Set(['.pdf'])

const DOCUMENT_EXTENSIONS = new Set(['.docx', '.odp', '.ods', '.odt', '.pptx', '.xlsx', '.zip'])

export type FileSemanticIndexStatus = 'missing' | 'building' | 'ready' | 'error' | 'cancelled'

export interface FileSemanticStatus {
  sources: FileIndexSource[]
  ollamaAvailable: boolean
  imageModelInstalled: boolean
  embeddingModelInstalled: boolean
  imageModel: string
  embeddingModel: string
  embeddingBatchSize?: number
  indexStatus: FileSemanticIndexStatus
  nodeCount: number
  fileCount: number
  semanticCount: number
  conceptCount?: number
  skippedCount: number
  failedCount: number
  generatedAt?: number
  stage?: string
  completed?: number
  total?: number
  estimatedRemainingMs?: number
  stageProcessed?: number
  stageIndexed?: number
  stageFileTotal?: number
  stageWorkerCount?: number
  error?: string
}

export interface FileSemanticPreflight {
  rootPath: string
  sources: Array<
    FileIndexSource & {
      nodeCount: number
      directoryCount: number
      fileCount: number
      skippedCount: number
    }
  >
  nodeCount: number
  directoryCount: number
  fileCount: number
  skippedCount: number
  warningThreshold: number
  requiresConfirmation: boolean
  scannedAt: number
}

export interface FileSemanticSearchResult {
  id: string
  name: string
  path: string
  relativePath: string
  nodeType: 'file'
  size: number
  modifiedAt: number
  summary: string
  semanticType: 'text' | 'image' | 'video'
  timestampMs?: number
  score: number
  rawScore?: number
}

export type FileSemanticSearchKind = 'all' | 'text' | 'image' | 'video'

export interface FileAnalysisResult {
  path: string
  name: string
  fileType: 'text' | 'image'
  markdown: string
  model: string
}

export interface FileSemanticConceptGroup {
  id: string
  title: string
  results: FileSemanticSearchResult[]
}

interface RuntimeIndexState {
  status: FileSemanticIndexStatus
  mode: 'rebuild' | 'rescan' | ''
  stage: string
  completed: number
  total: number
  nodeCount: number
  fileCount: number
  semanticCount: number
  conceptCount: number
  skippedCount: number
  failedCount: number
  error: string
  embeddingBatchSize: number
  estimatedRemainingMs?: number
  stageProcessed?: number
  stageIndexed?: number
  stageFileTotal?: number
  stageWorkerCount?: number
}

interface OllamaModelState {
  available: boolean
  installed: Set<string>
  checkedAt: number
}

type FileContentKind = EncryptedFilesystemContentKind

interface FileNodeMetadata extends Record<string, unknown> {
  name: string
  nodeType: 'file' | 'directory'
  contentKind: FileContentKind
  size: number
  modifiedAt: number
  indexedAt: number
  sourceId: string
  sourcePath: string
  relativePath: string
}

interface ExistingNode {
  id: string
  parentId: string | null
  metadata: FileNodeMetadata
  relativePath: string
}

interface FilesystemSnapshot {
  rootNodeId: string
  sources: FileIndexSource[]
  scanId: number
  nodesToWrite: EncryptedFilesystemNodeInput[]
  changedFileIds: string[]
  reusedNodeIds: Set<string>
  absolutePathsById: Map<string, string>
  relativePathsById: Map<string, string>
  nodeCount: number
  fileCount: number
  skippedCount: number
}

interface FileEmbeddingProfile extends Record<string, unknown> {
  schemaVersion: number
  model: string
  sampleBytes: number
  inputFormatVersion: number
  batchSize: number
  calibratedAt: number
  confirmationRuns: number
}

interface EmbeddingBatchTiming {
  durationMs: number
  fileCount: number
}

interface StageProgressTiming {
  completed: number
  recordedAt: number
}

interface PreparedTextFile {
  node: EncryptedFilesystemNodeRecord
  input: string
}

interface PreparedTextPage {
  nodes: EncryptedFilesystemNodeRecord[]
  prepared: PreparedTextFile[]
  failedCount: number
  afterId: string
}

interface PreparedExtractedFile {
  node: EncryptedFilesystemNodeRecord
  input: string
  metadata: Record<string, unknown>
}

type ExtractedFileText = Exclude<FileExtractionResult, null>

interface SearchCacheRecord extends FileSemanticSearchResult {
  embedding: number[]
  embeddingSpace: string
  sourceSemanticId: string
}

interface RankedSearchCandidate {
  record: SearchCacheRecord
  rawScore: number
  score: number
}

interface RankedConceptCandidate {
  concept: EncryptedFileConceptRecord
  rawScore: number
  score: number
}

interface CachedPreflight {
  key: string
  result: FileSemanticPreflight
  checkedAt: number
}

class FileIndexCancelledError extends Error {
  constructor() {
    super('Filesystem indexing was cancelled')
    this.name = 'FileIndexCancelledError'
  }
}

class OllamaRequestError extends Error {
  status: number
  responseText: string

  constructor(message: string, status: number, responseText: string) {
    super(message)
    this.name = 'OllamaRequestError'
    this.status = status
    this.responseText = responseText
  }
}

let runtimeIndexState: RuntimeIndexState = emptyRuntimeState()
let runtimeIndexSources: FileIndexSource[] = []
let activeIndexPromise: Promise<void> | null = null
let activeAbortController: AbortController | null = null
let indexGeneration = 0
let cachedModelState: OllamaModelState | null = null
let cachedSearchRecords: SearchCacheRecord[] | null = null
let cachedPreflight: CachedPreflight | null = null
let recentEmbeddingBatchTimings: EmbeddingBatchTiming[] = []
let recentStageProgressTimings: StageProgressTiming[] = []

function emptyRuntimeState(): RuntimeIndexState {
  return {
    status: 'missing',
    mode: '',
    stage: '',
    completed: 0,
    total: 0,
    nodeCount: 0,
    fileCount: 0,
    semanticCount: 0,
    conceptCount: 0,
    skippedCount: 0,
    failedCount: 0,
    error: '',
    embeddingBatchSize: 0,
    estimatedRemainingMs: undefined,
    stageProcessed: undefined,
    stageIndexed: undefined,
    stageFileTotal: undefined,
    stageWorkerCount: undefined,
  }
}

function indexStage(step: number, label: string): string {
  return `Stage ${step} of ${INDEX_STAGE_COUNT} · ${label}`
}

function runtimeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function setRuntimeIndexError(error: unknown, fallback: string): void {
  runtimeIndexState = {
    ...emptyRuntimeState(),
    status: 'error',
    error: runtimeErrorMessage(error, fallback),
  }
}

function resetEmbeddingEta(): void {
  recentEmbeddingBatchTimings = []
  clearDetailedStageProgress()
  runtimeIndexState.estimatedRemainingMs = undefined
}

function resetExtractedStageProgress(fileTotal: number, workerCount: number): void {
  const now = performance.now()
  recentStageProgressTimings = [{ completed: 0, recordedAt: now }]
  runtimeIndexState.completed = 0
  runtimeIndexState.total = fileTotal * 2
  runtimeIndexState.stageProcessed = 0
  runtimeIndexState.stageIndexed = 0
  runtimeIndexState.stageFileTotal = fileTotal
  runtimeIndexState.stageWorkerCount = workerCount
  runtimeIndexState.estimatedRemainingMs = undefined
}

function updateExtractedStageProgress(processed: number, indexed: number, finalized: number, fileTotal: number): void {
  const completed = Math.min(fileTotal * 2, processed + finalized)
  runtimeIndexState.completed = completed
  runtimeIndexState.total = fileTotal * 2
  runtimeIndexState.stageProcessed = processed
  runtimeIndexState.stageIndexed = indexed
  runtimeIndexState.stageFileTotal = fileTotal

  const previous = recentStageProgressTimings.at(-1)
  if (!previous || previous.completed !== finalized) {
    recentStageProgressTimings.push({
      completed: finalized,
      recordedAt: performance.now(),
    })
    if (recentStageProgressTimings.length > STAGE_ETA_WINDOW_SIZE) {
      recentStageProgressTimings.shift()
    }
  }

  const first = recentStageProgressTimings[0]
  const last = recentStageProgressTimings.at(-1)
  const completedInWindow = last && first ? last.completed - first.completed : 0
  const durationMs = last && first ? last.recordedAt - first.recordedAt : 0
  const remaining = Math.max(0, fileTotal - finalized)
  runtimeIndexState.estimatedRemainingMs =
    completedInWindow > 0 && durationMs > 0
      ? Math.max(0, Math.round((durationMs / completedInWindow) * remaining))
      : undefined
}

function clearDetailedStageProgress(): void {
  recentStageProgressTimings = []
  runtimeIndexState.stageProcessed = undefined
  runtimeIndexState.stageIndexed = undefined
  runtimeIndexState.stageFileTotal = undefined
  runtimeIndexState.stageWorkerCount = undefined
}

function recordEmbeddingBatchTiming(durationMs: number, fileCount: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0 || fileCount <= 0) return
  recentEmbeddingBatchTimings.push({ durationMs, fileCount })
  if (recentEmbeddingBatchTimings.length > EMBEDDING_ETA_WINDOW_SIZE) {
    recentEmbeddingBatchTimings.shift()
  }
}

function updateEmbeddingEta(completed: number, total: number): void {
  const remaining = Math.max(0, total - completed)
  const windowDuration = recentEmbeddingBatchTimings.reduce((sum, item) => sum + item.durationMs, 0)
  const windowFiles = recentEmbeddingBatchTimings.reduce((sum, item) => sum + item.fileCount, 0)
  runtimeIndexState.estimatedRemainingMs = windowFiles
    ? Math.max(0, Math.round((windowDuration / windowFiles) * remaining))
    : undefined
}

function normalizedOllamaUrl(): string {
  const url = new URL(FILE_OLLAMA_URL)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Semantic file search requires the local Ollama service')
  }
  return url.origin
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function responseError(response: Response, fallback: string): Promise<OllamaRequestError> {
  const text = await response.text().catch(() => '')
  let detail = text
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    detail = String(parsed.error || text)
  } catch {
    // Plain-text Ollama errors are already useful.
  }
  const message = detail ? `${fallback}: ${detail.slice(0, 500)}` : fallback
  return new OllamaRequestError(message, response.status, detail)
}

function isOllamaCapacityError(error: unknown): boolean {
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    const cause = (
      error as TypeError & {
        cause?: { code?: unknown; message?: unknown }
      }
    ).cause
    const code = String(cause?.code || '').toUpperCase()
    const message = String(cause?.message || '').toLowerCase()
    return (
      ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code) ||
      message.includes('socket') ||
      message.includes('connection reset') ||
      message.includes('other side closed')
    )
  }
  if (!(error instanceof OllamaRequestError)) return false
  if (error.status === 413) return true
  const message = `${error.message}
${error.responseText}`.toLowerCase()
  return [
    'out of memory',
    'insufficient memory',
    'cannot allocate memory',
    'failed to allocate',
    'resource exhausted',
    'cuda out of memory',
    'cuda error',
    'vram',
  ].some((value) => message.includes(value))
}

function normalizedModelName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function modelIsInstalled(installed: Set<string>, model: string): boolean {
  const expected = normalizedModelName(model)
  return [...installed].some((name) => name === expected || name.startsWith(`${expected}@`))
}

async function readOllamaModelState(force = false): Promise<OllamaModelState> {
  if (!force && cachedModelState && Date.now() - cachedModelState.checkedAt < MODEL_STATUS_CACHE_MS) {
    return cachedModelState
  }

  try {
    const response = await fetchWithTimeout(`${normalizedOllamaUrl()}/api/tags`, { method: 'GET' }, 4000)
    if (!response.ok) throw new Error('Ollama model listing failed')
    const data = (await response.json().catch(() => ({}))) as {
      models?: Array<{ name?: unknown; model?: unknown }>
    }
    const installed = new Set(
      Array.isArray(data.models)
        ? data.models.map((model) => normalizedModelName(model.name || model.model)).filter(Boolean)
        : [],
    )
    cachedModelState = { available: true, installed, checkedAt: Date.now() }
  } catch {
    cachedModelState = {
      available: false,
      installed: new Set(),
      checkedAt: Date.now(),
    }
  }
  return cachedModelState
}

async function pullModel(model: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${normalizedOllamaUrl()}/api/pull`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false }),
    },
    OLLAMA_PULL_TIMEOUT_MS,
  )
  if (!response.ok) throw await responseError(response, `Ollama model download failed for ${model}`)
  const result = (await response.json().catch(() => ({}))) as {
    error?: unknown
  }
  if (result.error) {
    throw new Error(`Ollama model download failed for ${model}: ${String(result.error)}`)
  }
}

function cleanModelText(value: unknown, maxChars: number): string {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .slice(0, maxChars)
}

function isLikelyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_DETECTION_BYTES))
  if (!sample.length) return true
  let controlBytes = 0
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlBytes += 1
    }
  }
  if (controlBytes / sample.length > 0.01) return false
  const decoded = sample.toString('utf8')
  const replacements = decoded.split('\uFFFD').length - 1
  return replacements / Math.max(1, decoded.length) <= 0.01
}

async function readTextIndexSample(handle: fs.FileHandle, size: number): Promise<string> {
  if (size <= 0) return ''

  if (size <= MAX_TEXT_BYTES) {
    const buffer = Buffer.alloc(size)
    const read = await handle.read(buffer, 0, size, 0)
    return normalizeEmbeddingSample(buffer.subarray(0, read.bytesRead).toString('utf8'))
  }

  const head = Buffer.alloc(TEXT_SAMPLE_HEAD_BYTES)
  const middle = Buffer.alloc(TEXT_SAMPLE_MIDDLE_BYTES)
  const tail = Buffer.alloc(TEXT_SAMPLE_TAIL_BYTES)
  const middleOffset = Math.max(0, Math.floor(size / 2 - TEXT_SAMPLE_MIDDLE_BYTES / 2))
  const tailOffset = Math.max(0, size - TEXT_SAMPLE_TAIL_BYTES)
  const [headRead, middleRead, tailRead] = await Promise.all([
    handle.read(head, 0, head.length, 0),
    handle.read(middle, 0, middle.length, middleOffset),
    handle.read(tail, 0, tail.length, tailOffset),
  ])

  return normalizeEmbeddingSample(
    [
      head.subarray(0, headRead.bytesRead).toString('utf8'),
      middle.subarray(0, middleRead.bytesRead).toString('utf8'),
      tail.subarray(0, tailRead.bytesRead).toString('utf8'),
    ].join(' '),
  )
}

function normalizeEmbeddingSample(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const bytes = Buffer.from(normalized, 'utf8')
  if (bytes.length <= MAX_TEXT_BYTES) return normalized
  return bytes
    .subarray(0, MAX_TEXT_BYTES)
    .toString('utf8')
    .replace(/\uFFFD+$/g, '')
    .trim()
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.indexOf('%PDF-') >= 0
}

async function classifyFileContent(filename: string, absolutePath: string): Promise<FileContentKind> {
  if (isImageFile(filename)) return 'image'
  if (isVideoFile(filename)) return 'video'
  const extension = path.extname(filename).toLowerCase()
  if (PDF_EXTENSIONS.has(extension)) return 'pdf'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  const handle = await fs.open(absolutePath, 'r')
  try {
    const buffer = Buffer.alloc(FILE_CLASSIFICATION_BYTES)
    const read = await handle.read(buffer, 0, FILE_CLASSIFICATION_BYTES, 0)
    const sample = buffer.subarray(0, read.bytesRead)
    if (hasPdfSignature(sample)) return 'pdf'
    if (hasZipSignature(sample)) return 'document'
    return isLikelyText(sample) ? 'text' : 'binary'
  } finally {
    await handle.close()
  }
}

function sampledExtractedText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const bytes = Buffer.from(normalized, 'utf8')
  if (bytes.length <= MAX_TEXT_BYTES) return normalized
  const middleOffset = Math.max(0, Math.floor(bytes.length / 2 - TEXT_SAMPLE_MIDDLE_BYTES / 2))
  return normalizeEmbeddingSample(
    Buffer.concat([
      bytes.subarray(0, TEXT_SAMPLE_HEAD_BYTES),
      Buffer.from(' '),
      bytes.subarray(middleOffset, middleOffset + TEXT_SAMPLE_MIDDLE_BYTES),
      Buffer.from(' '),
      bytes.subarray(bytes.length - TEXT_SAMPLE_TAIL_BYTES),
    ]).toString('utf8'),
  )
}

function extractedEmbeddingInput(
  name: string,
  parentDirectory: string,
  sample: string,
  sourceType: string,
  archiveEntry?: string,
): string {
  return [
    `File: ${name}`,
    `Folder: ${parentDirectory}`,
    `Type: ${sourceType}`,
    archiveEntry ? `Archive entry: ${archiveEntry}` : '',
    sample,
  ]
    .filter(Boolean)
    .join('\n')
}

function textEmbeddingInput(name: string, parentDirectory: string, sample: string): string {
  return [`File: ${name}`, `Folder: ${parentDirectory}`, sample].filter(Boolean).join('\n')
}

interface OllamaGenerationOptions {
  model: string
  maxChars: number
  errorLabel: string
  signal?: AbortSignal
  numCtx?: number
  numPredict?: number
  think?: boolean
}

async function generateAnalysis(prompt: string, images: string[] = []): Promise<string> {
  return generateOllamaText(prompt, images, {
    model: FILE_ANALYSIS_MODEL,
    maxChars: MAX_ANALYSIS_CHARS,
    errorLabel: 'Ollama file analysis failed',
  })
}

async function generateOllamaText(prompt: string, images: string[], options: OllamaGenerationOptions): Promise<string> {
  const modelOptions: Record<string, number> = {
    temperature: 0.2,
    num_ctx: options.numCtx || 262144,
  }
  if (options.numPredict) modelOptions.num_predict = options.numPredict
  const response = await fetchWithTimeout(
    `${normalizedOllamaUrl()}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        keep_alive: '10m',
        ...(typeof options.think === 'boolean' ? { think: options.think } : {}),
        messages: [
          {
            role: 'user',
            content: prompt,
            ...(images.length ? { images } : {}),
          },
        ],
        options: modelOptions,
      }),
    },
    OLLAMA_REQUEST_TIMEOUT_MS,
    options.signal,
  )
  if (!response.ok) throw await responseError(response, options.errorLabel)
  const result = (await response.json().catch(() => ({}))) as {
    message?: { content?: unknown }
    response?: unknown
  }
  const text = cleanModelText(result.message?.content || result.response, options.maxChars)
  if (!text) throw new Error('Ollama returned an empty response')
  return text
}

/** Embeds one production MiniLM text batch for indexing and isolated benchmark pipelines. */
export async function embedFileTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!texts.length) return []
  const response = await fetchWithTimeout(
    `${normalizedOllamaUrl()}/api/embed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FILE_EMBEDDING_MODEL,
        input: texts.length === 1 ? texts[0] : texts,
        truncate: true,
        keep_alive: '10m',
      }),
    },
    OLLAMA_REQUEST_TIMEOUT_MS,
    signal,
  )
  if (!response.ok) throw await responseError(response, 'Ollama file embedding failed')
  const result = (await response.json().catch(() => ({}))) as {
    embeddings?: unknown
    embedding?: unknown
  }
  const rawEmbeddings = Array.isArray(result.embeddings)
    ? Array.isArray(result.embeddings[0])
      ? result.embeddings
      : [result.embeddings]
    : Array.isArray(result.embedding)
      ? [result.embedding]
      : []
  const embeddings = rawEmbeddings.map((raw) =>
    Array.isArray(raw)
      ? normalizedVector(raw.map((value) => Number(value)).filter((value) => Number.isFinite(value)))
      : [],
  )
  if (embeddings.length !== texts.length || embeddings.some((item) => !item.length)) {
    throw new Error('Ollama returned an invalid file embedding batch')
  }
  return embeddings
}

async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const embeddings = await embedFileTexts([text], signal)
  return embeddings[0]
}

function normalizedVector(values: number[]): number[] {
  let lengthSquared = 0
  for (const value of values) lengthSquared += value * value
  const length = Math.sqrt(lengthSquared)
  if (!length) return values.map(() => 0)
  return values.map((value) => value / length)
}

function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (!left.length || left.length !== right.length) return -1
  const length = left.length
  let dot = 0
  let leftLength = 0
  let rightLength = 0
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftLength += left[index] * left[index]
    rightLength += right[index] * right[index]
  }
  if (!leftLength || !rightLength) return -1
  return dot / Math.sqrt(leftLength * rightLength)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function standardDeviation(values: number[], center: number): number {
  if (values.length < 2) return 0
  let variance = 0
  for (const value of values) variance += (value - center) ** 2
  return Math.sqrt(variance / values.length)
}

function normalizedSearchCandidates(records: SearchCacheRecord[], embedding: number[]): RankedSearchCandidate[] {
  const candidates = records
    .map((record) => ({
      record,
      rawScore: cosineSimilarity(embedding, record.embedding),
      score: 0,
    }))
    .filter((candidate) => candidate.rawScore > -1)
    .sort((left, right) => right.rawScore - left.rawScore || left.record.name.localeCompare(right.record.name))
  if (!candidates.length) return []

  const rawScores = candidates.map((candidate) => candidate.rawScore)
  const center = median(rawScores)
  const medianAbsoluteDeviation = median(rawScores.map((score) => Math.abs(score - center)))
  const robustScale = medianAbsoluteDeviation * 1.4826
  const fallbackScale = standardDeviation(rawScores, center)
  const scale = robustScale > 0.000001 ? robustScale : fallbackScale
  const rankDenominator = Math.max(1, candidates.length - 1)

  return candidates.map((candidate, index) => {
    const zScore = scale > 0.000001 ? Math.max(-8, Math.min(8, (candidate.rawScore - center) / scale)) : 0
    const distributionScore = 1 / (1 + Math.exp(-1.702 * zScore))
    const rankScore = 1 - index / rankDenominator
    return {
      ...candidate,
      score: distributionScore * 0.9 + rankScore * 0.1,
    }
  })
}

function assertActive(generation: number, signal: AbortSignal): void {
  if (generation !== indexGeneration || signal.aborted) throw new FileIndexCancelledError()
}

function nodeMetadata(value: Record<string, unknown>): FileNodeMetadata {
  const nodeType = value.nodeType === 'directory' ? 'directory' : 'file'
  const rawContentKind = String(value.contentKind || '')
  const contentKind: FileContentKind =
    rawContentKind === 'text' ||
    rawContentKind === 'document' ||
    rawContentKind === 'pdf' ||
    rawContentKind === 'image' ||
    rawContentKind === 'video' ||
    rawContentKind === 'binary'
      ? rawContentKind
      : nodeType === 'directory'
        ? 'directory'
        : 'binary'
  return {
    name: String(value.name || ''),
    nodeType,
    contentKind,
    size: Math.max(0, Number(value.size) || 0),
    modifiedAt: Math.max(0, Number(value.modifiedAt) || 0),
    indexedAt: Math.max(0, Number(value.indexedAt) || 0),
    sourceId: String(value.sourceId || ''),
    sourcePath: String(value.sourcePath || ''),
    relativePath: String(value.relativePath || ''),
  }
}

function sameNodeMetadata(left: FileNodeMetadata, right: FileNodeMetadata): boolean {
  return (
    left.name === right.name &&
    left.nodeType === right.nodeType &&
    left.contentKind === right.contentKind &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.sourceId === right.sourceId &&
    left.sourcePath === right.sourcePath &&
    left.relativePath === right.relativePath
  )
}

function fileNodeId(): string {
  return `file_${randomUUID().replace(/-/g, '')}`
}

function shouldSkipProtectedPath(rootPath: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootPath, absolutePath)
  if (process.platform !== 'linux') return false
  const normalizedPath = path.resolve(absolutePath)
  return PROTECTED_LINUX_PATHS.some(
    (protectedPath) => normalizedPath === protectedPath || normalizedPath.startsWith(`${protectedPath}${path.sep}`),
  )
}

function sourceNodeKey(sourceId: string, relativePath: string): string {
  return relativePath ? `${sourceId}:${relativePath}` : `source:${sourceId}`
}

function nestedMountPaths(source: FileIndexSource, discovered: FileIndexSource[]): Set<string> {
  return new Set(
    discovered
      .filter((candidate) => candidate.path !== source.path && candidate.path.startsWith(`${source.path}${path.sep}`))
      .map((candidate) => candidate.path),
  )
}

async function countEligibleSourceEntries(
  source: FileIndexSource,
  discovered: FileIndexSource[],
): Promise<FileSemanticPreflight['sources'][number]> {
  const stack = [source.path]
  const blockedMounts = nestedMountPaths(source, discovered)
  let directoryCount = 1
  let fileCount = 0
  let skippedCount = 0

  while (stack.length) {
    const directory = stack.pop()
    if (!directory) break
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      skippedCount += 1
      continue
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (
        blockedMounts.has(absolutePath) ||
        entry.isSymbolicLink() ||
        shouldSkipProtectedPath(source.path, absolutePath) ||
        (entry.isDirectory() && isExcludedDirectoryName(entry.name))
      ) {
        skippedCount += 1
        continue
      }
      if (entry.isDirectory()) {
        directoryCount += 1
        stack.push(absolutePath)
      } else if (entry.isFile()) {
        fileCount += 1
      } else {
        skippedCount += 1
      }
    }
  }

  return {
    ...source,
    nodeCount: directoryCount + fileCount,
    directoryCount,
    fileCount,
    skippedCount,
  }
}

/** Counts eligible nodes within an explicit source set without discovering unrelated mounts. */
export async function countEligibleFilesystemEntries(
  sources: FileIndexSource[],
  discovered: FileIndexSource[],
): Promise<FileSemanticPreflight> {
  const sourceCounts = await Promise.all(sources.map((source) => countEligibleSourceEntries(source, discovered)))
  const directoryCount = sourceCounts.reduce((total, source) => total + source.directoryCount, 0)
  const fileCount = sourceCounts.reduce((total, source) => total + source.fileCount, 0)
  const skippedCount = sourceCounts.reduce((total, source) => total + source.skippedCount, 0)
  return {
    rootPath: sources[0]?.path || '',
    sources: sourceCounts,
    nodeCount: directoryCount + fileCount,
    directoryCount,
    fileCount,
    skippedCount,
    warningThreshold: FILE_INDEX_LARGE_SCAN_THRESHOLD,
    requiresConfirmation: fileCount >= FILE_INDEX_LARGE_SCAN_THRESHOLD,
    scannedAt: Date.now(),
  }
}

function existingNodesByPath(nodes: EncryptedFilesystemNodeRecord[], rootNodeId: string): Map<string, ExistingNode> {
  const result = new Map<string, ExistingNode>()
  for (const node of nodes) {
    const metadata = nodeMetadata(node.metadata)
    const key = node.id === rootNodeId ? 'virtual' : sourceNodeKey(metadata.sourceId, metadata.relativePath)
    result.set(key, {
      id: node.id,
      parentId: node.parentId,
      metadata,
      relativePath: metadata.relativePath,
    })
  }
  return result
}

async function collectFilesystemSnapshot(
  sources: FileIndexSource[],
  discovered: FileIndexSource[],
  rootNodeId: string,
  existingByPath: Map<string, ExistingNode>,
  generation: number,
  signal: AbortSignal,
): Promise<FilesystemSnapshot> {
  const scanId = Date.now()
  const existingRoot = existingByPath.get('virtual')
  const rootMetadata: FileNodeMetadata = {
    name: 'Indexed locations',
    nodeType: 'directory',
    contentKind: 'directory',
    size: 0,
    modifiedAt: scanId,
    indexedAt: existingRoot?.metadata.indexedAt || scanId,
    sourceId: '',
    sourcePath: '',
    relativePath: '',
  }
  const nodesToWrite: EncryptedFilesystemNodeInput[] = []
  let scanOrder = 0
  if (!existingRoot || !sameNodeMetadata(existingRoot.metadata, rootMetadata)) {
    nodesToWrite.push({
      id: rootNodeId,
      parentId: null,
      nodeType: 'directory',
      contentKind: 'directory',
      sizeBytes: 0,
      modifiedAt: rootMetadata.modifiedAt,
      indexedAt: rootMetadata.indexedAt,
      scanOrder,
      metadata: rootMetadata,
    })
  }

  const reusedNodeIds = new Set<string>(existingRoot ? [rootNodeId] : [])
  const absolutePathsById = new Map<string, string>()
  const relativePathsById = new Map<string, string>([[rootNodeId, '']])
  const changedFileIds: string[] = []
  let nodeCount = 1
  let fileCount = 0
  let skippedCount = 0

  for (const source of sources) {
    assertActive(generation, signal)
    if (!source.available) {
      for (const existing of existingByPath.values()) {
        if (existing.metadata.sourceId !== source.id) continue
        reusedNodeIds.add(existing.id)
        nodeCount += 1
        if (existing.metadata.nodeType === 'file') fileCount += 1
      }
      skippedCount += 1
      continue
    }
    const sourceStats = await fs.stat(source.path)
    const sourceKey = sourceNodeKey(source.id, '')
    const existingSource = existingByPath.get(sourceKey)
    const sourceNodeId = existingSource?.id || fileNodeId()
    const sourceMetadata: FileNodeMetadata = {
      name: source.label,
      nodeType: 'directory',
      contentKind: 'directory',
      size: 0,
      modifiedAt: sourceStats.mtimeMs,
      indexedAt: existingSource?.metadata.indexedAt || scanId,
      sourceId: source.id,
      sourcePath: source.path,
      relativePath: '',
    }
    if (!existingSource || !sameNodeMetadata(existingSource.metadata, sourceMetadata)) {
      nodesToWrite.push({
        id: sourceNodeId,
        parentId: rootNodeId,
        nodeType: 'directory',
        contentKind: 'directory',
        sizeBytes: 0,
        modifiedAt: sourceStats.mtimeMs,
        indexedAt: sourceMetadata.indexedAt,
        scanOrder: ++scanOrder,
        metadata: sourceMetadata,
      })
    }
    if (existingSource) reusedNodeIds.add(existingSource.id)
    absolutePathsById.set(sourceNodeId, source.path)
    relativePathsById.set(sourceNodeId, '')
    nodeCount += 1

    const blockedMounts = nestedMountPaths(source, discovered)
    const stack: Array<{
      absolutePath: string
      relativePath: string
      id: string
    }> = [{ absolutePath: source.path, relativePath: '', id: sourceNodeId }]

    while (stack.length) {
      assertActive(generation, signal)
      const directory = stack.pop()
      if (!directory) break
      let entries
      try {
        entries = await fs.readdir(directory.absolutePath, {
          withFileTypes: true,
        })
      } catch {
        skippedCount += 1
        continue
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      const childDirectories: Array<{
        absolutePath: string
        relativePath: string
        id: string
      }> = []

      for (const entry of entries) {
        assertActive(generation, signal)
        const absolutePath = path.join(directory.absolutePath, entry.name)
        if (
          blockedMounts.has(absolutePath) ||
          entry.isSymbolicLink() ||
          shouldSkipProtectedPath(source.path, absolutePath) ||
          (entry.isDirectory() && isExcludedDirectoryName(entry.name))
        ) {
          skippedCount += 1
          continue
        }
        if (!entry.isDirectory() && !entry.isFile()) {
          skippedCount += 1
          continue
        }
        let stats
        try {
          stats = await fs.lstat(absolutePath)
        } catch {
          skippedCount += 1
          continue
        }
        const relativePath = directory.relativePath ? path.join(directory.relativePath, entry.name) : entry.name
        const nodeType = entry.isDirectory() ? 'directory' : 'file'
        const existing = existingByPath.get(sourceNodeKey(source.id, relativePath))
        const reusable = existing && existing.metadata.nodeType === nodeType ? existing : null
        const id = reusable?.id || fileNodeId()
        const size = nodeType === 'file' ? stats.size : 0
        const fileChanged =
          !reusable || reusable.metadata.size !== size || reusable.metadata.modifiedAt !== stats.mtimeMs
        let contentKind: FileContentKind = 'directory'
        if (nodeType === 'file') {
          if (!fileChanged) contentKind = reusable?.metadata.contentKind || 'binary'
          else {
            try {
              contentKind = await classifyFileContent(entry.name, absolutePath)
            } catch {
              contentKind = 'binary'
              skippedCount += 1
            }
          }
        }
        const currentScanOrder = ++scanOrder
        const metadata: FileNodeMetadata = {
          name: entry.name,
          nodeType,
          contentKind,
          size,
          modifiedAt: stats.mtimeMs,
          indexedAt: fileChanged ? scanId : reusable?.metadata.indexedAt || scanId,
          sourceId: source.id,
          sourcePath: source.path,
          relativePath,
        }
        const changed = !reusable || !sameNodeMetadata(reusable.metadata, metadata)
        if (reusable) reusedNodeIds.add(reusable.id)
        if (changed) {
          nodesToWrite.push({
            id,
            parentId: directory.id,
            nodeType,
            contentKind,
            sizeBytes: size,
            modifiedAt: stats.mtimeMs,
            indexedAt: metadata.indexedAt,
            scanOrder: currentScanOrder,
            metadata,
          })
        }
        absolutePathsById.set(id, absolutePath)
        relativePathsById.set(id, relativePath)
        nodeCount += 1
        if (nodeType === 'directory') childDirectories.push({ absolutePath, relativePath, id })
        else {
          fileCount += 1
          if (fileChanged) changedFileIds.push(id)
        }
      }
      for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
        stack.push(childDirectories[index])
      }
      runtimeIndexState.nodeCount = nodeCount
      runtimeIndexState.fileCount = fileCount
      runtimeIndexState.skippedCount = skippedCount
      runtimeIndexState.completed = nodeCount
    }
  }

  return {
    rootNodeId,
    sources,
    scanId,
    nodesToWrite,
    changedFileIds,
    reusedNodeIds,
    absolutePathsById,
    relativePathsById,
    nodeCount,
    fileCount,
    skippedCount,
  }
}

async function writeNodeBatches(
  nodes: EncryptedFilesystemNodeInput[],
  generation: number,
  signal: AbortSignal,
): Promise<void> {
  for (let start = 0; start < nodes.length; start += NODE_WRITE_BATCH_SIZE) {
    assertActive(generation, signal)
    await writeEncryptedFilesystemNodes(nodes.slice(start, start + NODE_WRITE_BATCH_SIZE))
  }
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

function splitTextForAnalysis(content: string): string[] {
  if (content.length <= ANALYSIS_SINGLE_PASS_CHARS) return [content]
  const chunks: string[] = []
  let offset = 0
  while (offset < content.length) {
    let end = Math.min(content.length, offset + ANALYSIS_CHUNK_CHARS)
    if (end < content.length) {
      const newline = content.lastIndexOf('\n', end)
      if (newline > offset + ANALYSIS_CHUNK_CHARS / 2) end = newline + 1
    }
    chunks.push(content.slice(offset, end))
    offset = end
  }
  return chunks
}

async function combineAnalysisSections(filename: string, sections: string[]): Promise<string> {
  let current = sections
  while (current.length > 1) {
    const next: string[] = []
    for (let start = 0; start < current.length; start += ANALYSIS_COMBINE_GROUP_SIZE) {
      const group = current.slice(start, start + ANALYSIS_COMBINE_GROUP_SIZE)
      const prompt = [
        `Combine these section analyses into one coherent analysis of ${filename}.`,
        'Preserve the important behavior and purpose from every section.',
        'Return concise Markdown with a short heading and two or three useful paragraphs. Use bullets or code formatting only when they improve clarity.',
        'Do not mention that the file was processed in sections.',
        '',
        ...group.map((section, index) => `Section analysis ${index + 1}:\n${section}`),
      ].join('\n\n')
      next.push(await generateAnalysis(prompt))
    }
    current = next
  }
  return current[0] || ''
}

async function analyzeTextContent(filename: string, content: string): Promise<string> {
  const chunks = splitTextForAnalysis(content)
  if (chunks.length === 1) {
    return generateAnalysis(
      [
        `Analyze the complete contents of this file: ${filename}`,
        'Explain what the file contains or does and the important behavior a person should understand.',
        'Return concise Markdown with a short heading and two or three useful paragraphs. Use bullets or code formatting only when they improve clarity.',
        'Do not return JSON and do not include hidden reasoning.',
        '',
        chunks[0],
      ].join('\n'),
    )
  }

  const sections: string[] = []
  for (let index = 0; index < chunks.length; index += 1) {
    sections.push(
      await generateAnalysis(
        [
          `Analyze section ${index + 1} of ${chunks.length} from the complete file ${filename}.`,
          'Capture the purpose, behavior, and important details present in this section so they can be combined into a final whole-file analysis.',
          'Return concise Markdown notes. Do not return JSON and do not include hidden reasoning.',
          '',
          chunks[index],
        ].join('\n'),
      ),
    )
  }
  return combineAnalysisSections(filename, sections)
}

/** Reads and analyzes the complete selected file through the fixed local Ollama model. */
export async function analyzeFileWithOllama(filePath: string): Promise<FileAnalysisResult> {
  await verifyAnalysisModelInstalled()
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) throw new Error('AI Analyze requires a file')
  const name = path.basename(filePath)

  if (isImageFile(name)) {
    const image = await fs.readFile(filePath)
    const markdown = await generateAnalysis(
      [
        `Analyze this complete image file: ${name}`,
        'Explain what is visible, including important people, animals, objects, setting, activity, scenery, landmarks, and readable text when apparent.',
        'Return concise Markdown with a short heading and two or three useful paragraphs. Use bullets only when they improve clarity.',
        'Do not return JSON and do not include hidden reasoning.',
      ].join('\n'),
      [image.toString('base64')],
    )
    return {
      path: filePath,
      name,
      fileType: 'image',
      markdown,
      model: FILE_ANALYSIS_MODEL,
    }
  }

  const buffer = await fs.readFile(filePath)
  if (!isLikelyText(buffer)) {
    throw new Error('AI Analyze currently supports text files and images')
  }
  const content = buffer.toString('utf8').replace(/\r\n?/g, '\n')
  const markdown = await analyzeTextContent(name, content)
  return {
    path: filePath,
    name,
    fileType: 'text',
    markdown,
    model: FILE_ANALYSIS_MODEL,
  }
}

function embeddingProfileIsCurrent(value: Record<string, unknown> | null): value is FileEmbeddingProfile {
  return Boolean(
    value &&
    Number(value.schemaVersion) === EMBEDDING_PROFILE_SCHEMA_VERSION &&
    String(value.model || '') === FILE_EMBEDDING_MODEL &&
    Number(value.sampleBytes) === MAX_TEXT_BYTES &&
    Number(value.inputFormatVersion) === TEXT_EMBEDDING_INPUT_VERSION &&
    Number(value.batchSize) >= 1,
  )
}

async function embeddingBatchFits(inputs: string[], batchSize: number, signal: AbortSignal): Promise<boolean> {
  try {
    await embedFileTexts(inputs.slice(0, batchSize), signal)
    return true
  } catch (error) {
    if (isOllamaCapacityError(error)) return false
    throw error
  }
}

async function calibrationInputs(
  snapshot: FilesystemSnapshot,
  generation: number,
  signal: AbortSignal,
): Promise<string[]> {
  const nodes = await readEncryptedFilesystemNodePage({
    contentKind: 'text',
    indexedAt: snapshot.scanId,
    minSizeBytes: MAX_TEXT_BYTES,
    limit: EMBEDDING_CALIBRATION_START_SIZE,
    orderBySize: true,
  })
  const inputs: string[] = []

  for (const node of nodes) {
    assertActive(generation, signal)
    const absolutePath = snapshot.absolutePathsById.get(node.id)
    if (!absolutePath) continue
    try {
      const handle = await fs.open(absolutePath, 'r')
      try {
        const stats = await handle.stat()
        if (stats.size < MAX_TEXT_BYTES) continue
        const sample = await readTextIndexSample(handle, stats.size)
        const metadata = nodeMetadata(node.metadata)
        const parentDirectory = path.basename(path.dirname(absolutePath))
        inputs.push(textEmbeddingInput(metadata.name, parentDirectory, sample))
      } finally {
        await handle.close()
      }
    } catch {
      // The filesystem can change between the tree scan and calibration.
    }
  }

  return inputs
}

async function calibrateEmbeddingBatchSize(
  snapshot: FilesystemSnapshot,
  generation: number,
  signal: AbortSignal,
): Promise<FileEmbeddingProfile> {
  runtimeIndexState.stage = indexStage(2, 'Calibrating MiniLM batch size')
  runtimeIndexState.completed = 0
  runtimeIndexState.total = 0
  const inputs = await calibrationInputs(snapshot, generation, signal)
  let batchSize = Math.min(EMBEDDING_CALIBRATION_START_SIZE, inputs.length)

  if (batchSize) {
    let failedSize = 0
    while (batchSize >= 1) {
      assertActive(generation, signal)
      runtimeIndexState.stage = indexStage(2, `Testing MiniLM batch size (${batchSize} files)`)
      runtimeIndexState.completed = 0
      runtimeIndexState.total = 0
      if (await embeddingBatchFits(inputs, batchSize, signal)) break
      failedSize = batchSize
      if (batchSize === 1) {
        throw new Error('The embedding model could not process one full-size file sample')
      }
      batchSize = Math.max(1, Math.floor(batchSize / 2))
    }

    if (failedSize > batchSize + 1) {
      let low = batchSize
      let high = failedSize - 1
      while (low < high) {
        assertActive(generation, signal)
        const middle = Math.ceil((low + high) / 2)
        runtimeIndexState.stage = indexStage(2, `Testing MiniLM batch size (${middle} files)`)
        if (await embeddingBatchFits(inputs, middle, signal)) low = middle
        else high = middle - 1
      }
      batchSize = low
    }

    let confirmed = 0
    while (confirmed < EMBEDDING_CALIBRATION_CONFIRMATION_RUNS) {
      assertActive(generation, signal)
      runtimeIndexState.stage = indexStage(2, `Confirming MiniLM batch size (${batchSize} files)`)
      if (await embeddingBatchFits(inputs, batchSize, signal)) {
        confirmed += 1
        runtimeIndexState.completed = confirmed
        runtimeIndexState.total = EMBEDDING_CALIBRATION_CONFIRMATION_RUNS
        continue
      }
      if (batchSize === 1) {
        throw new Error('The embedding model could not confirm a stable batch size')
      }
      batchSize = Math.max(1, Math.floor(batchSize * 0.8))
      confirmed = 0
    }
  } else {
    batchSize = 1
  }

  const profile: FileEmbeddingProfile = {
    schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
    model: FILE_EMBEDDING_MODEL,
    sampleBytes: MAX_TEXT_BYTES,
    inputFormatVersion: TEXT_EMBEDDING_INPUT_VERSION,
    batchSize,
    calibratedAt: Date.now(),
    confirmationRuns: EMBEDDING_CALIBRATION_CONFIRMATION_RUNS,
  }
  await writeEncryptedFileEmbeddingProfile(profile)
  runtimeIndexState.embeddingBatchSize = batchSize
  return profile
}

async function resolveEmbeddingProfile(
  snapshot: FilesystemSnapshot,
  generation: number,
  signal: AbortSignal,
): Promise<FileEmbeddingProfile> {
  const stored = await readEncryptedFileEmbeddingProfile()
  if (embeddingProfileIsCurrent(stored)) {
    runtimeIndexState.embeddingBatchSize = stored.batchSize
    return stored
  }
  return calibrateEmbeddingBatchSize(snapshot, generation, signal)
}

async function reduceEmbeddingProfile(profile: FileEmbeddingProfile): Promise<FileEmbeddingProfile> {
  if (profile.batchSize <= 1) {
    throw new Error('The embedding model ran out of memory for a single file')
  }
  const next = {
    ...profile,
    batchSize: Math.max(1, Math.floor(profile.batchSize / 2)),
    calibratedAt: Date.now(),
  }
  await writeEncryptedFileEmbeddingProfile(next)
  runtimeIndexState.embeddingBatchSize = next.batchSize
  return next
}

async function prepareTextFile(
  snapshot: FilesystemSnapshot,
  node: EncryptedFilesystemNodeRecord,
): Promise<PreparedTextFile> {
  const absolutePath = snapshot.absolutePathsById.get(node.id)
  if (!absolutePath) {
    throw new Error('Indexed file path is unavailable')
  }
  const handle = await fs.open(absolutePath, 'r')
  try {
    const stats = await handle.stat()
    if (stats.size !== node.sizeBytes || stats.mtimeMs !== node.modifiedAt) {
      throw new Error('File changed after the filesystem scan')
    }
    const sample = await readTextIndexSample(handle, stats.size)
    const metadata = nodeMetadata(node.metadata)
    const parentDirectory = path.basename(path.dirname(absolutePath))
    return {
      node,
      input: textEmbeddingInput(metadata.name, parentDirectory, sample),
    }
  } finally {
    await handle.close()
  }
}

interface TextPersistenceQueue {
  enqueue(records: EncryptedFileSemanticInput[]): Promise<void>
  drain(): Promise<void>
  throwIfFailed(): void
}

async function prepareTextPage(
  snapshot: FilesystemSnapshot,
  afterId: string,
  limit: number,
): Promise<PreparedTextPage> {
  const nodes = await readEncryptedFilesystemNodePage({
    contentKind: 'text',
    indexedAt: snapshot.scanId,
    afterId,
    limit,
  })
  const prepared: PreparedTextFile[] = []
  let failedCount = 0

  for (let start = 0; start < nodes.length; start += TEXT_FILE_PREPARE_CONCURRENCY) {
    const outcomes = await Promise.all(
      nodes
        .slice(start, start + TEXT_FILE_PREPARE_CONCURRENCY)
        .map((node) => prepareTextFile(snapshot, node).catch(() => null)),
    )
    for (const item of outcomes) {
      if (item) prepared.push(item)
      else failedCount += 1
    }
  }

  return {
    nodes,
    prepared,
    failedCount,
    afterId: nodes[nodes.length - 1]?.id || afterId,
  }
}

function createTextPersistenceQueue(
  maximumPendingBatches: number,
  onPersisted: (count: number) => void,
): TextPersistenceQueue {
  const slotWaiters: Array<() => void> = []
  let pendingBatches = 0
  let failure: unknown
  let chain: Promise<void> = Promise.resolve()

  const notifySlot = () => {
    const waiter = slotWaiters.shift()
    waiter?.()
  }
  const throwIfFailed = () => {
    if (failure) throw failure
  }
  const waitForSlot = async () => {
    while (pendingBatches >= maximumPendingBatches) {
      await new Promise<void>((resolve) => slotWaiters.push(resolve))
      throwIfFailed()
    }
  }

  return {
    async enqueue(records) {
      throwIfFailed()
      await waitForSlot()
      pendingBatches += 1
      chain = chain
        .then(async () => {
          await writeEncryptedFileSemantics(records)
          onPersisted(records.length)
        })
        .catch((error) => {
          failure ||= error
        })
        .finally(() => {
          pendingBatches -= 1
          notifySlot()
        })
    },
    async drain() {
      await chain
      throwIfFailed()
    },
    throwIfFailed,
  }
}

async function processTextFiles(
  snapshot: FilesystemSnapshot,
  initialProfile: FileEmbeddingProfile,
  generation: number,
  signal: AbortSignal,
): Promise<{
  semanticCount: number
  failedCount: number
  profile: FileEmbeddingProfile
}> {
  let profile = initialProfile
  let semanticCount = 0
  let failedCount = 0
  const total = await countEncryptedFilesystemNodes({
    contentKind: 'text',
    indexedAt: snapshot.scanId,
  })
  runtimeIndexState.stage = indexStage(2, 'Embedding text files')
  runtimeIndexState.completed = 0
  runtimeIndexState.total = total
  resetEmbeddingEta()

  const persistence = createTextPersistenceQueue(TEXT_PERSISTENCE_PENDING_BATCHES, (count) => {
    semanticCount += count
    runtimeIndexState.semanticCount = semanticCount
  })
  let pageTask = prepareTextPage(snapshot, '', profile.batchSize)

  try {
    while (true) {
      assertActive(generation, signal)
      persistence.throwIfFailed()
      const page = await pageTask
      if (!page.nodes.length) break
      pageTask = prepareTextPage(snapshot, page.afterId, profile.batchSize)
      failedCount += page.failedCount

      let offset = 0
      while (offset < page.prepared.length) {
        persistence.throwIfFailed()
        const group = page.prepared.slice(offset, offset + profile.batchSize)
        try {
          const batchStartedAt = performance.now()
          const embeddings = await embedFileTexts(
            group.map((item) => item.input),
            signal,
          )
          recordEmbeddingBatchTiming(performance.now() - batchStartedAt, group.length)
          const generatedAt = Date.now()
          await persistence.enqueue(
            group.map((item, index) => ({
              fileId: item.node.id,
              metadata: {
                summary: '',
                semanticType: 'text',
                embeddingSpace: FILE_EMBEDDING_MODEL,
                embeddingModel: FILE_EMBEDDING_MODEL,
                sourceModifiedAt: item.node.modifiedAt,
                inputFormatVersion: TEXT_EMBEDDING_INPUT_VERSION,
                generatedAt,
              },
              embedding: embeddings[index],
            })),
          )
          offset += group.length
        } catch (error) {
          if (!isOllamaCapacityError(error)) throw error
          profile = await reduceEmbeddingProfile(profile)
        }
      }

      runtimeIndexState.completed += page.nodes.length
      updateEmbeddingEta(runtimeIndexState.completed, total)
      runtimeIndexState.failedCount = failedCount
    }

    await persistence.drain()
  } finally {
    await Promise.all([persistence.drain().catch(() => undefined), pageTask.catch(() => undefined)])
  }

  return { semanticCount, failedCount, profile }
}

async function prepareExtractedFile(
  snapshot: FilesystemSnapshot,
  node: EncryptedFilesystemNodeRecord,
  sourceKind: FileExtractionKind,
  pool: FileExtractionPool,
  signal: AbortSignal,
): Promise<PreparedExtractedFile | null> {
  if (signal.aborted) throw new FileIndexCancelledError()
  const absolutePath = snapshot.absolutePathsById.get(node.id)
  if (!absolutePath) throw new Error('Indexed file path is unavailable')
  const stats = await fs.stat(absolutePath)
  if (stats.size !== node.sizeBytes || stats.mtimeMs !== node.modifiedAt) {
    throw new Error('File changed after the filesystem scan')
  }
  const extracted = await pool.extract(sourceKind, absolutePath)
  if (signal.aborted) throw new FileIndexCancelledError()
  if (!extracted) return null
  const sample = sampledExtractedText(extracted.text)
  if (!sample) return null
  const metadata = nodeMetadata(node.metadata)
  const parentDirectory = path.basename(path.dirname(absolutePath))
  return {
    node,
    input: extractedEmbeddingInput(
      metadata.name,
      parentDirectory,
      sample,
      extracted.sourceType,
      'archiveEntry' in extracted ? extracted.archiveEntry : undefined,
    ),
    metadata: {
      summary: '',
      semanticType: 'text',
      sourceKind,
      documentType: extracted.sourceType,
      extractionMethod: extracted.extractionMethod,
      ...('archiveEntry' in extracted && extracted.archiveEntry ? { archiveEntry: extracted.archiveEntry } : {}),
      ...('pagesRead' in extracted ? { pagesRead: extracted.pagesRead } : {}),
      embeddingSpace: FILE_EMBEDDING_MODEL,
      embeddingModel: FILE_EMBEDDING_MODEL,
      sourceModifiedAt: node.modifiedAt,
      inputFormatVersion: TEXT_EMBEDDING_INPUT_VERSION,
      sourceInputFormatVersion: sourceKind === 'pdf' ? PDF_INPUT_FORMAT_VERSION : DOCUMENT_INPUT_FORMAT_VERSION,
    },
  }
}

interface ExtractionOutcome {
  node: EncryptedFilesystemNodeRecord
  item: PreparedExtractedFile | null
  error?: unknown
}

/**
 * Converts one extracted-text embedding batch into encrypted semantic inputs while preserving the
 * extraction metadata prepared by the document or PDF worker stage.
 */
export function createExtractedSemanticRecords(
  group: PreparedExtractedFile[],
  embeddings: number[][],
  generatedAt: number,
): EncryptedFileSemanticInput[] {
  return group.map((item, index) => ({
    fileId: item.node.id,
    metadata: {
      ...item.metadata,
      generatedAt,
    },
    embedding: embeddings[index],
  }))
}

/**
 * Embeds and persists prepared document or PDF text in bounded MiniLM groups, reducing the saved
 * profile only when Ollama reports a genuine capacity failure.
 */
async function savePreparedExtractedFiles(
  prepared: PreparedExtractedFile[],
  initialProfile: FileEmbeddingProfile,
  signal: AbortSignal,
): Promise<{
  profile: FileEmbeddingProfile
  saved: number
}> {
  let profile = initialProfile
  let offset = 0

  while (offset < prepared.length) {
    const batchSize = Math.max(1, Math.min(profile.batchSize, EXTRACTED_EMBEDDING_BATCH_SIZE))
    const group = prepared.slice(offset, offset + batchSize)
    try {
      const embeddings = await embedFileTexts(
        group.map((item) => item.input),
        signal,
      )
      const generatedAt = Date.now()
      await writeEncryptedFileSemantics(createExtractedSemanticRecords(group, embeddings, generatedAt))
      offset += group.length
    } catch (error) {
      if (signal.aborted) throw new FileIndexCancelledError()
      if (!isOllamaCapacityError(error)) throw error
      profile = await reduceEmbeddingProfile(profile)
    }
  }

  return { profile, saved: prepared.length }
}

async function processExtractedTextFiles(
  snapshot: FilesystemSnapshot,
  initialProfile: FileEmbeddingProfile,
  generation: number,
  signal: AbortSignal,
  contentKind: FileExtractionKind,
  stageStep: number,
  stageName: string,
  pool: FileExtractionPool,
): Promise<{
  semanticCount: number
  failedCount: number
  profile: FileEmbeddingProfile
}> {
  let profile = initialProfile
  let afterId = ''
  let semanticCount = 0
  let failedCount = 0
  let processedCount = 0
  let indexedCount = 0
  let finalizedCount = 0
  let embeddingTask: Promise<void> | null = null
  let embeddingError: unknown = null
  const preparedQueue: PreparedExtractedFile[] = []
  const total = await countEncryptedFilesystemNodes({
    contentKind,
    indexedAt: snapshot.scanId,
  })
  runtimeIndexState.stage = indexStage(stageStep, stageName)
  resetExtractedStageProgress(total, pool.workerCount)

  const currentBatchSize = () => Math.max(1, Math.min(profile.batchSize, EXTRACTED_EMBEDDING_BATCH_SIZE))

  const startEmbeddingBatch = (force = false) => {
    if (embeddingTask || !preparedQueue.length) return
    const batchSize = currentBatchSize()
    if (!force && preparedQueue.length < batchSize) return
    const group = preparedQueue.splice(0, batchSize)
    const task = (async () => {
      const saved = await savePreparedExtractedFiles(group, profile, signal)
      profile = saved.profile
      semanticCount += saved.saved
      indexedCount += saved.saved
      finalizedCount += saved.saved
      runtimeIndexState.semanticCount = semanticCount
      updateExtractedStageProgress(processedCount, indexedCount, finalizedCount, total)
    })()
    let handledTask: Promise<void>
    handledTask = task
      .catch((error) => {
        embeddingError = error
      })
      .finally(() => {
        if (embeddingTask === handledTask) embeddingTask = null
      })
    embeddingTask = handledTask
  }

  const waitForEmbedding = async () => {
    const task = embeddingTask
    if (task) await task
    if (embeddingError) throw embeddingError
  }

  while (true) {
    assertActive(generation, signal)
    const nodes = await readEncryptedFilesystemNodePage({
      contentKind,
      indexedAt: snapshot.scanId,
      afterId,
      limit: EXTRACTED_NODE_PAGE_SIZE,
    })
    if (!nodes.length) break
    afterId = nodes[nodes.length - 1].id
    let nextNodeIndex = 0
    const inFlight = new Map<string, Promise<ExtractionOutcome>>()
    const inFlightLimit = Math.max(1, pool.workerCount * 2)

    while (nextNodeIndex < nodes.length || inFlight.size > 0) {
      assertActive(generation, signal)
      if (embeddingError) throw embeddingError

      while (nextNodeIndex < nodes.length && inFlight.size < inFlightLimit) {
        const node = nodes[nextNodeIndex++]
        const job = prepareExtractedFile(snapshot, node, contentKind, pool, signal).then(
          (item): ExtractionOutcome => ({ node, item }),
          (error): ExtractionOutcome => ({ node, item: null, error }),
        )
        inFlight.set(node.id, job)
      }

      const outcome = await Promise.race(inFlight.values())
      inFlight.delete(outcome.node.id)
      if (
        outcome.error &&
        (signal.aborted || (outcome.error instanceof Error && outcome.error.name === 'AbortError'))
      ) {
        throw new FileIndexCancelledError()
      }

      processedCount += 1
      if (outcome.error) {
        failedCount += 1
        finalizedCount += 1
      } else if (outcome.item) {
        preparedQueue.push(outcome.item)
      } else {
        finalizedCount += 1
      }
      updateExtractedStageProgress(processedCount, indexedCount, finalizedCount, total)
      runtimeIndexState.failedCount = failedCount

      startEmbeddingBatch()
      if (embeddingTask && preparedQueue.length >= currentBatchSize() * 2) {
        await waitForEmbedding()
        startEmbeddingBatch()
      }
    }
  }

  while (embeddingTask || preparedQueue.length) {
    assertActive(generation, signal)
    if (!embeddingTask) startEmbeddingBatch(true)
    await waitForEmbedding()
  }

  return { semanticCount, failedCount, profile }
}

async function processDocumentFiles(
  snapshot: FilesystemSnapshot,
  initialProfile: FileEmbeddingProfile,
  generation: number,
  signal: AbortSignal,
  pool: FileExtractionPool,
) {
  return processExtractedTextFiles(
    snapshot,
    initialProfile,
    generation,
    signal,
    'document',
    3,
    'Extracting and embedding documents',
    pool,
  )
}

async function processPdfFiles(
  snapshot: FilesystemSnapshot,
  initialProfile: FileEmbeddingProfile,
  generation: number,
  signal: AbortSignal,
  pool: FileExtractionPool,
) {
  return processExtractedTextFiles(
    snapshot,
    initialProfile,
    generation,
    signal,
    'pdf',
    4,
    'Extracting and embedding PDF files',
    pool,
  )
}

async function processDocumentAndPdfStages(
  snapshot: FilesystemSnapshot,
  initialProfile: FileEmbeddingProfile,
  generation: number,
  signal: AbortSignal,
): Promise<{
  documents: Awaited<ReturnType<typeof processDocumentFiles>>
  pdfs: Awaited<ReturnType<typeof processPdfFiles>>
}> {
  const pool = createFileExtractionPool()
  const cancelWorkers = () => void pool.close()
  signal.addEventListener('abort', cancelWorkers, { once: true })
  try {
    const documents = await processDocumentFiles(snapshot, initialProfile, generation, signal, pool)
    const pdfs = await processPdfFiles(snapshot, documents.profile, generation, signal, pool)
    return { documents, pdfs }
  } finally {
    signal.removeEventListener('abort', cancelWorkers)
    await pool.close()
  }
}

function isClipCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return [
    'out of memory',
    'failed to allocate',
    'allocation failed',
    'resource exhausted',
    'cuda_error_out_of_memory',
    'cuda out of memory',
  ].some((value) => message.includes(value))
}

export interface PreparedImageWorkItem {
  node: EncryptedFilesystemNodeRecord
  image: PreparedClipImage
}

interface PreparedImageOutcome {
  node: EncryptedFilesystemNodeRecord
  image?: PreparedClipImage
  error?: Error
}

interface ExtractedVideoOutcome {
  node: EncryptedFilesystemNodeRecord
  durationMs?: number
  frames?: Array<{ timestampMs: number; image: PreparedClipImage }>
  error?: Error
}

/** Streams prepared image outcomes while the Sharp pool fills the bounded completion queue. */
async function* preparedImageOutcomes(
  snapshot: FilesystemSnapshot,
  pool: FileImageProcessingPool,
  maximumPending: number,
  generation: number,
  signal: AbortSignal,
): AsyncGenerator<PreparedImageOutcome> {
  let afterId = ''
  let afterScanOrder = 0
  let page: EncryptedFilesystemNodeRecord[] = []
  let pageIndex = 0
  let exhausted = false
  let pendingCount = 0
  let wakeConsumer: (() => void) | null = null
  const completed = new FileImageQueue<PreparedImageOutcome>()

  const nextNode = async (): Promise<EncryptedFilesystemNodeRecord | null> => {
    while (pageIndex >= page.length && !exhausted) {
      page = await readEncryptedFilesystemNodePage({
        contentKind: 'image',
        indexedAt: snapshot.scanId,
        afterId,
        afterScanOrder,
        orderByScan: true,
        limit: EXTRACTED_NODE_PAGE_SIZE,
      })
      pageIndex = 0
      if (!page.length) {
        exhausted = true
        return null
      }
      const lastNode = page[page.length - 1]
      afterId = lastNode.id
      afterScanOrder = Math.max(0, Number(lastNode.scanOrder) || 0)
    }
    return pageIndex < page.length ? page[pageIndex++] : null
  }

  const bufferedCount = () => completed.length

  const notifyConsumer = () => {
    const wake = wakeConsumer
    wakeConsumer = null
    wake?.()
  }

  const schedule = async () => {
    while (!exhausted && pendingCount + bufferedCount() < maximumPending) {
      assertActive(generation, signal)
      const node = await nextNode()
      if (!node) break
      const absolutePath = snapshot.absolutePathsById.get(node.id) || ''
      pendingCount += 1
      void (absolutePath ? pool.prepare(absolutePath) : Promise.reject(new Error('Filesystem path is unavailable')))
        .then((image) => {
          completed.push({ node, image })
        })
        .catch((error) => {
          completed.push({
            node,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        })
        .finally(() => {
          pendingCount -= 1
          notifyConsumer()
        })
    }
  }

  const waitForOutcome = async () => {
    if (bufferedCount() || (!pendingCount && exhausted)) return
    await new Promise<void>((resolve) => {
      wakeConsumer = resolve
    })
  }

  await schedule()
  while (pendingCount || bufferedCount() || !exhausted) {
    assertActive(generation, signal)
    await waitForOutcome()
    assertActive(generation, signal)
    if (!bufferedCount()) {
      await schedule()
      continue
    }

    const outcome = completed.shift()
    await schedule()
    if (outcome) yield outcome
  }
}

/** Builds encrypted semantic inputs for one successful CLIP image batch. */
export function createImageSemanticRecords(
  items: PreparedImageWorkItem[],
  embeddings: number[][],
  generatedAt: number,
): EncryptedFileSemanticInput[] {
  return items.map((item, index) => ({
    fileId: item.node.id,
    metadata: {
      summary: '',
      semanticType: 'image',
      embeddingSpace: FILE_CLIP_MODEL,
      embeddingModel: FILE_CLIP_MODEL,
      imageInputFormatVersion: IMAGE_INPUT_FORMAT_VERSION,
      sourceModifiedAt: item.node.modifiedAt,
      generatedAt,
    },
    embedding: embeddings[index],
  }))
}

/** Persists one successful CLIP image batch through the encrypted semantic repository. */
export async function persistImageSemanticBatch(
  items: PreparedImageWorkItem[],
  embeddings: number[][],
  generatedAt = Date.now(),
): Promise<void> {
  await writeEncryptedFileSemantics(createImageSemanticRecords(items, embeddings, generatedAt))
}

/** Embeds one prepared image group and recursively splits only genuine capacity failures. */
export async function embedPreparedImageBatch(
  items: PreparedImageWorkItem[],
  signal: AbortSignal,
  onSuccess: (items: PreparedImageWorkItem[], embeddings: number[][]) => Promise<void>,
  onCapacityReduction: (nextBatchSize: number) => void,
): Promise<void> {
  if (!items.length) return
  try {
    const startedAt = performance.now()
    const embeddings = await embedClipPreparedImages(
      items.map((item) => item.image),
      signal,
    )
    recordEmbeddingBatchTiming(performance.now() - startedAt, items.length)
    await onSuccess(items, embeddings)
  } catch (error) {
    if (signal.aborted) throw new FileIndexCancelledError()
    if (!isClipCapacityError(error) || items.length <= 1) throw error
    const midpoint = Math.max(1, Math.floor(items.length / 2))
    onCapacityReduction(midpoint)
    await embedPreparedImageBatch(items.slice(0, midpoint), signal, onSuccess, onCapacityReduction)
    await embedPreparedImageBatch(items.slice(midpoint), signal, onSuccess, onCapacityReduction)
  }
}

interface ImagePersistenceQueue {
  enqueue(items: PreparedImageWorkItem[], embeddings: number[][]): Promise<void>
  drain(): Promise<void>
  throwIfFailed(): void
}

/** Persists completed CLIP batches serially while allowing the next inference batch to begin. */
function createImagePersistenceQueue(
  maximumPendingBatches: number,
  onPersisted: (items: PreparedImageWorkItem[]) => void,
): ImagePersistenceQueue {
  const slotWaiters: Array<() => void> = []
  let pendingBatches = 0
  let failure: unknown
  let chain: Promise<void> = Promise.resolve()

  const notifySlot = () => {
    const waiter = slotWaiters.shift()
    waiter?.()
  }
  const throwIfFailed = () => {
    if (failure) throw failure
  }
  const waitForSlot = async () => {
    while (pendingBatches >= maximumPendingBatches) {
      await new Promise<void>((resolve) => slotWaiters.push(resolve))
      throwIfFailed()
    }
  }

  return {
    async enqueue(items, embeddings) {
      throwIfFailed()
      await waitForSlot()
      pendingBatches += 1
      chain = chain
        .then(async () => {
          await persistImageSemanticBatch(items, embeddings)
          onPersisted(items)
        })
        .catch((error) => {
          failure ||= error
        })
        .finally(() => {
          pendingBatches -= 1
          notifySlot()
        })
    },
    async drain() {
      await chain
      throwIfFailed()
    },
    throwIfFailed,
  }
}

async function processImageFiles(
  snapshot: FilesystemSnapshot,
  initialBatchSize: number,
  generation: number,
  signal: AbortSignal,
): Promise<{
  semanticCount: number
  failedCount: number
  batchSize: number
}> {
  let batchSize = Math.max(1, initialBatchSize)
  let semanticCount = 0
  let failedCount = 0
  let processed = 0
  let indexed = 0
  let finalized = 0
  const total = await countEncryptedFilesystemNodes({
    contentKind: 'image',
    indexedAt: snapshot.scanId,
  })
  const pool = createFileImageProcessingPool()
  const maximumPending = await resolvePreparedImageQueueCapacity(pool.workerCount, batchSize)
  runtimeIndexState.stage = indexStage(5, 'Preprocessing and embedding images')
  resetExtractedStageProgress(total, pool.workerCount)
  const cancelWorkers = () => void pool.close()
  signal.addEventListener('abort', cancelWorkers, { once: true })

  const persistence = createImagePersistenceQueue(2, (successful) => {
    semanticCount += successful.length
    indexed += successful.length
    finalized += successful.length
    runtimeIndexState.semanticCount = semanticCount
    updateExtractedStageProgress(processed, indexed, finalized, total)
  })
  const pendingBatch: PreparedImageWorkItem[] = []
  const flush = async () => {
    if (!pendingBatch.length) return
    persistence.throwIfFailed()
    const group = pendingBatch.splice(0, pendingBatch.length)
    await embedPreparedImageBatch(
      group,
      signal,
      (successful, embeddings) => persistence.enqueue(successful, embeddings),
      (nextBatchSize) => {
        batchSize = Math.max(1, Math.min(batchSize, nextBatchSize))
      },
    )
  }

  try {
    for await (const outcome of preparedImageOutcomes(snapshot, pool, maximumPending, generation, signal)) {
      persistence.throwIfFailed()
      processed += 1
      if (outcome.image) {
        pendingBatch.push({ node: outcome.node, image: outcome.image })
      } else {
        failedCount += 1
        finalized += 1
        console.warn(
          `Skipping unreadable image: ${snapshot.absolutePathsById.get(outcome.node.id) || outcome.node.id}`,
          outcome.error,
        )
      }
      runtimeIndexState.failedCount = failedCount
      updateExtractedStageProgress(processed, indexed, finalized, total)
      if (pendingBatch.length >= batchSize) await flush()
    }
    await flush()
    await persistence.drain()
  } finally {
    await persistence.drain().catch(() => undefined)
    signal.removeEventListener('abort', cancelWorkers)
    await pool.close()
  }

  return { semanticCount, failedCount, batchSize }
}

async function* extractedVideoOutcomes(
  snapshot: FilesystemSnapshot,
  generation: number,
  signal: AbortSignal,
): AsyncGenerator<ExtractedVideoOutcome> {
  const maximumPending = 2
  let afterId = ''
  let page: EncryptedFilesystemNodeRecord[] = []
  let pageIndex = 0
  let exhausted = false
  let sequence = 0
  const pending = new Map<number, Promise<{ sequence: number; outcome: ExtractedVideoOutcome }>>()

  const nextNode = async (): Promise<EncryptedFilesystemNodeRecord | null> => {
    while (pageIndex >= page.length && !exhausted) {
      page = await readEncryptedFilesystemNodePage({
        contentKind: 'video',
        indexedAt: snapshot.scanId,
        afterId,
        limit: 64,
      })
      pageIndex = 0
      if (!page.length) {
        exhausted = true
        return null
      }
      afterId = page[page.length - 1].id
    }
    return pageIndex < page.length ? page[pageIndex++] : null
  }

  const fill = async () => {
    while (!exhausted && pending.size < maximumPending) {
      assertActive(generation, signal)
      const node = await nextNode()
      if (!node) break
      const absolutePath = snapshot.absolutePathsById.get(node.id) || ''
      const id = sequence++
      const promise = (
        absolutePath
          ? extractVideoFramesForIndex(absolutePath, signal)
          : Promise.reject(new Error('Filesystem path is unavailable'))
      )
        .then((result) => ({
          sequence: id,
          outcome: {
            node,
            durationMs: result.durationMs,
            frames: result.frames,
          },
        }))
        .catch((error) => ({
          sequence: id,
          outcome: {
            node,
            error: error instanceof Error ? error : new Error(String(error)),
          },
        }))
      pending.set(id, promise)
    }
  }

  await fill()
  while (pending.size) {
    assertActive(generation, signal)
    const completed = await Promise.race(pending.values())
    pending.delete(completed.sequence)
    await fill()
    yield completed.outcome
  }
}

/**
 * Builds CLIP work items and a frame lookup for one sampled video without copying prepared image
 * buffers. The lookup reconnects inference results to their original timestamps.
 */
export function createVideoFrameWorkItems(
  node: EncryptedFilesystemNodeRecord,
  frames: Array<{ timestampMs: number; image: PreparedClipImage }>,
) {
  const workItems = frames.map((frame) => ({ node, image: frame.image }))
  const frameByImage = new Map(workItems.map((item, index) => [item.image, frames[index]]))
  return { workItems, frameByImage }
}

/**
 * Appends encrypted video-frame semantic inputs for one successful CLIP sub-batch. Semantic IDs
 * retain the existing file, timestamp, and record-order components.
 */
export function appendVideoFrameSemanticRecords({
  records,
  successful,
  embeddings,
  frameByImage,
  durationMs,
  generatedAt,
}: {
  records: EncryptedVideoFrameSemanticInput[]
  successful: PreparedImageWorkItem[]
  embeddings: number[][]
  frameByImage: Map<PreparedClipImage, { timestampMs: number; image: PreparedClipImage }>
  durationMs: number
  generatedAt: number
}): void {
  successful.forEach((item, index) => {
    const frame = frameByImage.get(item.image)!
    records.push({
      semanticId: `${item.node.id}:${frame.timestampMs}:${records.length}`,
      fileId: item.node.id,
      timestampMs: frame.timestampMs,
      metadata: {
        summary: '',
        semanticType: 'video',
        embeddingSpace: FILE_CLIP_MODEL,
        embeddingModel: FILE_CLIP_MODEL,
        videoInputFormatVersion: VIDEO_INPUT_FORMAT_VERSION,
        durationMs,
        timestampMs: frame.timestampMs,
        sourceModifiedAt: item.node.modifiedAt,
        generatedAt,
      },
      embedding: embeddings[index],
    })
  })
}

/** Samples, embeds, and stores video frames while preserving per-video progress semantics. */
async function processVideoFiles(
  snapshot: FilesystemSnapshot,
  initialBatchSize: number,
  generation: number,
  signal: AbortSignal,
): Promise<{
  semanticCount: number
  failedCount: number
  batchSize: number
}> {
  let batchSize = Math.max(1, initialBatchSize)
  let semanticCount = 0
  let failedCount = 0
  let processed = 0
  let indexed = 0
  let finalized = 0
  const total = await countEncryptedFilesystemNodes({
    contentKind: 'video',
    indexedAt: snapshot.scanId,
  })
  runtimeIndexState.stage = indexStage(6, 'Sampling and embedding videos')
  resetExtractedStageProgress(total, Math.min(2, total || 1))
  if (!total) return { semanticCount, failedCount, batchSize }

  try {
    await ensureVideoIndexingAvailable(signal)
  } catch (error) {
    failedCount = total
    processed = total
    finalized = total
    runtimeIndexState.failedCount = failedCount
    updateExtractedStageProgress(processed, indexed, finalized, total)
    console.warn('Skipping video indexing because FFmpeg is unavailable', error)
    return { semanticCount, failedCount, batchSize }
  }

  for await (const outcome of extractedVideoOutcomes(snapshot, generation, signal)) {
    processed += 1
    const frames = outcome.frames || []
    if (outcome.error || !frames.length) {
      failedCount += 1
      finalized += 1
      console.warn(
        `Skipping unreadable video: ${snapshot.absolutePathsById.get(outcome.node.id) || outcome.node.id}`,
        outcome.error,
      )
      runtimeIndexState.failedCount = failedCount
      updateExtractedStageProgress(processed, indexed, finalized, total)
      continue
    }

    const { workItems, frameByImage } = createVideoFrameWorkItems(outcome.node, frames)
    const records: EncryptedVideoFrameSemanticInput[] = []
    await embedPreparedImageBatch(
      workItems,
      signal,
      async (successful, embeddings) => {
        const generatedAt = Date.now()
        appendVideoFrameSemanticRecords({
          records,
          successful,
          embeddings,
          frameByImage,
          durationMs: outcome.durationMs || 0,
          generatedAt,
        })
      },
      (nextBatchSize) => {
        batchSize = Math.max(1, Math.min(batchSize, nextBatchSize))
      },
    )
    await writeEncryptedVideoFrameSemantics(records)
    semanticCount += records.length
    indexed += 1
    finalized += 1
    runtimeIndexState.semanticCount = semanticCount
    updateExtractedStageProgress(processed, indexed, finalized, total)
  }

  return { semanticCount, failedCount, batchSize }
}

async function processConceptGroups(
  rootNodeId: string,
  generation: number,
  signal: AbortSignal,
): Promise<FileConceptBuildResult> {
  const conceptGeneration = randomUUID().replace(/-/g, '')
  runtimeIndexState.stage = indexStage(7, 'Preparing concept groups')
  runtimeIndexState.completed = 0
  runtimeIndexState.total = 1
  runtimeIndexState.conceptCount = 0
  resetEmbeddingEta()

  const result = await rebuildFileConceptIndex({
    generation: conceptGeneration,
    rootNodeId,
    signal,
    onProgress: (progress) => {
      assertActive(generation, signal)
      runtimeIndexState.stage = indexStage(7, progress.phase)
      runtimeIndexState.completed = progress.completed
      runtimeIndexState.total = progress.total
      runtimeIndexState.stageProcessed = progress.completed
      runtimeIndexState.stageIndexed = progress.conceptCount
      runtimeIndexState.stageFileTotal = progress.total
      runtimeIndexState.stageWorkerCount = progress.workerCount
      runtimeIndexState.conceptCount = progress.conceptCount
    },
  })
  runtimeIndexState.conceptCount = result.conceptCount
  return result
}

function completeMeta(
  sources: FileIndexSource[],
  rootNodeId: string,
  snapshot: FilesystemSnapshot,
  profile: FileEmbeddingProfile,
  semanticCount: number,
  skippedCount: number,
  failedCount: number,
  imageBatchSize: number,
  concepts: FileConceptBuildResult,
): Record<string, unknown> {
  const now = Date.now()
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    status: 'complete',
    rootPath: sources[0]?.path || '',
    sources,
    rootNodeId,
    documentIndexingEnabled: true,
    documentInputFormatVersion: DOCUMENT_INPUT_FORMAT_VERSION,
    pdfIndexingEnabled: true,
    pdfInputFormatVersion: PDF_INPUT_FORMAT_VERSION,
    imageIndexingEnabled: true,
    imageInputFormatVersion: IMAGE_INPUT_FORMAT_VERSION,
    imageEmbeddingModel: FILE_CLIP_MODEL,
    imageBatchSize,
    videoIndexingEnabled: true,
    videoInputFormatVersion: VIDEO_INPUT_FORMAT_VERSION,
    videoEmbeddingModel: FILE_CLIP_MODEL,
    conceptIndexingEnabled: true,
    conceptIndexVersion: FILE_CONCEPT_INDEX_VERSION,
    conceptGeneration: concepts.generation,
    conceptCount: concepts.conceptCount,
    miniLmConceptCount: concepts.miniLmConceptCount,
    clipConceptCount: concepts.clipConceptCount,
    embeddingModel: FILE_EMBEDDING_MODEL,
    embeddingInputFormatVersion: TEXT_EMBEDDING_INPUT_VERSION,
    embeddingBatchSize: profile.batchSize,
    nodeCount: snapshot.nodeCount,
    fileCount: snapshot.fileCount,
    semanticCount,
    skippedCount,
    failedCount,
    generatedAt: now,
    scannedAt: now,
  }
}

async function buildInitialIndex(
  sources: FileIndexSource[],
  discovered: FileIndexSource[],
  previousMeta: Record<string, unknown> | null,
  generation: number,
  signal: AbortSignal,
): Promise<void> {
  const rootNodeId = fileNodeId()
  const previousRootNodeId = indexMetaIsCurrent(previousMeta) ? String(previousMeta?.rootNodeId || '') : ''
  runtimeIndexState = {
    ...emptyRuntimeState(),
    status: 'building',
    mode: 'rebuild',
    stage: indexStage(1, 'Scanning and classifying filesystem'),
  }
  if (!previousRootNodeId) await clearEncryptedFileIndex()

  try {
    const snapshot = await collectFilesystemSnapshot(sources, discovered, rootNodeId, new Map(), generation, signal)
    runtimeIndexState.stage = indexStage(1, 'Saving filesystem tree')
    runtimeIndexState.completed = 0
    runtimeIndexState.total = snapshot.nodesToWrite.length
    await writeNodeBatches(snapshot.nodesToWrite, generation, signal)
    assertActive(generation, signal)

    const initialProfile = await resolveEmbeddingProfile(snapshot, generation, signal)
    const text = await processTextFiles(snapshot, initialProfile, generation, signal)
    const { documents, pdfs } = await processDocumentAndPdfStages(snapshot, text.profile, generation, signal)
    const images = await processImageFiles(snapshot, FILE_CLIP_DEFAULT_BATCH_SIZE, generation, signal)
    const videos = await processVideoFiles(snapshot, images.batchSize, generation, signal)
    const concepts = await processConceptGroups(snapshot.rootNodeId, generation, signal)
    const semanticCount =
      text.semanticCount + documents.semanticCount + pdfs.semanticCount + images.semanticCount + videos.semanticCount
    const failedCount =
      text.failedCount + documents.failedCount + pdfs.failedCount + images.failedCount + videos.failedCount
    runtimeIndexState.stage = indexStage(8, 'Finalizing encrypted index')
    runtimeIndexState.completed = 0
    runtimeIndexState.total = 1
    resetEmbeddingEta()
    const meta = completeMeta(
      sources,
      rootNodeId,
      snapshot,
      pdfs.profile,
      semanticCount,
      snapshot.skippedCount,
      failedCount,
      videos.batchSize,
      concepts,
    )
    await writeEncryptedFileIndexMeta(meta)
    await deleteEncryptedFileConceptGenerationsExcept(concepts.generation)
    runtimeIndexState.completed = 1
    if (previousRootNodeId && previousRootNodeId !== rootNodeId) {
      await deleteEncryptedFilesystemNodes([previousRootNodeId]).catch(() => undefined)
    }
    cachedSearchRecords = null
    runtimeIndexState = {
      status: 'ready',
      mode: '',
      stage: '',
      completed: snapshot.fileCount,
      total: snapshot.fileCount,
      nodeCount: snapshot.nodeCount,
      fileCount: snapshot.fileCount,
      semanticCount,
      conceptCount: concepts.conceptCount,
      skippedCount: Number(meta.skippedCount || 0),
      failedCount,
      error: '',
      embeddingBatchSize: pdfs.profile.batchSize,
    }
  } catch (error) {
    await deleteEncryptedFileConceptGenerationsExcept(String(previousMeta?.conceptGeneration || '')).catch(
      () => undefined,
    )
    await deleteEncryptedFilesystemNodes([rootNodeId]).catch(() => undefined)
    if (!previousRootNodeId) {
      await clearEncryptedFileIndex().catch(() => undefined)
    }
    cachedSearchRecords = null
    throw error
  }
}

async function buildRescan(
  sources: FileIndexSource[],
  discovered: FileIndexSource[],
  meta: Record<string, unknown>,
  generation: number,
  signal: AbortSignal,
): Promise<void> {
  const rootNodeId = String(meta.rootNodeId || '')
  const storedSourceIds = fileIndexSourcesFromMeta(meta)
    .map((source) => source.id)
    .sort()
  const sourceIds = sources.map((source) => source.id).sort()
  if (!rootNodeId || JSON.stringify(storedSourceIds) !== JSON.stringify(sourceIds)) {
    await buildInitialIndex(sources, discovered, meta, generation, signal)
    return
  }
  runtimeIndexState = {
    ...emptyRuntimeState(),
    status: 'building',
    mode: 'rescan',
    stage: indexStage(1, 'Comparing and classifying filesystem'),
  }
  const existingNodes = await readEncryptedFilesystemNodes()
  const existingByPath = existingNodesByPath(existingNodes, rootNodeId)
  const snapshot = await collectFilesystemSnapshot(sources, discovered, rootNodeId, existingByPath, generation, signal)
  const deletedNodeIds = existingNodes.map((node) => node.id).filter((id) => !snapshot.reusedNodeIds.has(id))

  runtimeIndexState.stage = indexStage(1, 'Updating filesystem tree')
  runtimeIndexState.completed = 0
  runtimeIndexState.total = snapshot.nodesToWrite.length + deletedNodeIds.length
  await writeNodeBatches(snapshot.nodesToWrite, generation, signal)
  await deleteEncryptedFilesystemNodes(deletedNodeIds)
  await deleteEncryptedFileSemantics(snapshot.changedFileIds)
  assertActive(generation, signal)

  const initialProfile = await resolveEmbeddingProfile(snapshot, generation, signal)
  const text = await processTextFiles(snapshot, initialProfile, generation, signal)
  const { documents, pdfs } = await processDocumentAndPdfStages(snapshot, text.profile, generation, signal)
  const images = await processImageFiles(
    snapshot,
    Math.max(1, Number(meta.imageBatchSize || FILE_CLIP_DEFAULT_BATCH_SIZE)),
    generation,
    signal,
  )
  const videos = await processVideoFiles(snapshot, images.batchSize, generation, signal)
  let concepts: FileConceptBuildResult
  try {
    concepts = await processConceptGroups(snapshot.rootNodeId, generation, signal)
  } catch (error) {
    await deleteEncryptedFileConceptGenerationsExcept(String(meta.conceptGeneration || '')).catch(() => undefined)
    throw error
  }
  const [semantics, videoSemantics] = await Promise.all([
    readEncryptedFileSemantics(),
    readEncryptedVideoFrameSemantics(),
  ])
  const semanticCount = semantics.length + videoSemantics.length
  const failedCount =
    text.failedCount + documents.failedCount + pdfs.failedCount + images.failedCount + videos.failedCount
  runtimeIndexState.stage = indexStage(8, 'Finalizing encrypted index')
  runtimeIndexState.completed = 0
  runtimeIndexState.total = 1
  resetEmbeddingEta()
  const nextMeta = completeMeta(
    sources,
    rootNodeId,
    snapshot,
    pdfs.profile,
    semanticCount,
    snapshot.skippedCount,
    failedCount,
    videos.batchSize,
    concepts,
  )
  await writeEncryptedFileIndexMeta(nextMeta)
  await deleteEncryptedFileConceptGenerationsExcept(concepts.generation)
  runtimeIndexState.completed = 1
  cachedSearchRecords = null
  runtimeIndexState = {
    status: 'ready',
    mode: '',
    stage: '',
    completed: snapshot.changedFileIds.length,
    total: snapshot.changedFileIds.length,
    nodeCount: snapshot.nodeCount,
    fileCount: snapshot.fileCount,
    semanticCount,
    conceptCount: concepts.conceptCount,
    skippedCount: Number(nextMeta.skippedCount || 0),
    failedCount,
    error: '',
    embeddingBatchSize: pdfs.profile.batchSize,
  }
}

function indexMetaIsCurrent(meta: Record<string, unknown> | null): boolean {
  return Boolean(
    meta &&
    meta.status === 'complete' &&
    Number(meta.schemaVersion) === INDEX_SCHEMA_VERSION &&
    meta.documentIndexingEnabled === true &&
    Number(meta.documentInputFormatVersion) === DOCUMENT_INPUT_FORMAT_VERSION &&
    meta.pdfIndexingEnabled === true &&
    Number(meta.pdfInputFormatVersion) === PDF_INPUT_FORMAT_VERSION &&
    meta.imageIndexingEnabled === true &&
    Number(meta.imageInputFormatVersion) === IMAGE_INPUT_FORMAT_VERSION &&
    String(meta.imageEmbeddingModel || '') === FILE_CLIP_MODEL &&
    meta.videoIndexingEnabled === true &&
    Number(meta.videoInputFormatVersion) === VIDEO_INPUT_FORMAT_VERSION &&
    String(meta.videoEmbeddingModel || '') === FILE_CLIP_MODEL &&
    meta.conceptIndexingEnabled === true &&
    Number(meta.conceptIndexVersion) === FILE_CONCEPT_INDEX_VERSION &&
    String(meta.conceptGeneration || '') &&
    String(meta.embeddingModel || '') === FILE_EMBEDDING_MODEL &&
    Number(meta.embeddingInputFormatVersion) === TEXT_EMBEDDING_INPUT_VERSION &&
    String(meta.rootNodeId || '') &&
    String(meta.rootPath || '') &&
    fileIndexSourcesFromMeta(meta).length > 0,
  )
}

async function verifyModelsInstalled(): Promise<void> {
  const state = await readOllamaModelState(true)
  if (!state.available) throw new Error('The system Ollama service is not available')
  if (!modelIsInstalled(state.installed, FILE_EMBEDDING_MODEL)) {
    throw new Error(`Ollama model ${FILE_EMBEDDING_MODEL} is not installed`)
  }
  if (!(await isFileClipModelInstalled())) {
    throw new Error(`Image embedding model ${FILE_CLIP_MODEL} is not installed`)
  }
  await installFileClipModel()
}

async function verifyAnalysisModelInstalled(): Promise<void> {
  const state = await readOllamaModelState(true)
  if (!state.available) throw new Error('The system Ollama service is not available')
  if (!modelIsInstalled(state.installed, FILE_ANALYSIS_MODEL)) {
    throw new Error(`Ollama model ${FILE_ANALYSIS_MODEL} is not installed`)
  }
}

async function configuredSourcesForRescan(
  homePath: string,
  meta: Record<string, unknown>,
): Promise<{ sources: FileIndexSource[]; discovered: FileIndexSource[] }> {
  const discovered = await discoverFileIndexSources(homePath)
  const discoveredById = new Map(discovered.map((source) => [source.id, source]))
  const stored = fileIndexSourcesFromMeta(meta)
  const sources = stored.map((source) => {
    const current = discoveredById.get(source.id)
    return current ? { ...source, ...current, available: current.available } : { ...source, available: false }
  })
  return {
    sources,
    discovered: [...discovered, ...sources.filter((source) => !discoveredById.has(source.id))],
  }
}

function startIndexOperation(homePath: string, mode: 'rebuild' | 'rescan', selectedSourceIds: string[] = []): void {
  if (activeIndexPromise) return
  runtimeIndexState = {
    ...emptyRuntimeState(),
    status: 'building',
    mode,
    stage: indexStage(1, 'Preparing filesystem index'),
  }
  const generation = indexGeneration
  const controller = new AbortController()
  activeAbortController = controller
  activeIndexPromise = (async () => {
    await verifyModelsInstalled()
    const meta = await readEncryptedFileIndexMeta()
    const selection =
      mode === 'rescan' && indexMetaIsCurrent(meta)
        ? await configuredSourcesForRescan(homePath, meta || {})
        : await resolveSelectedFileIndexSources(homePath, selectedSourceIds)
    if (!selection.sources.length) throw new Error('At least one index location is required')
    if (mode === 'rebuild' && selection.sources.some((source) => !source.available)) {
      throw new Error('Every selected index location must be mounted and available')
    }
    runtimeIndexSources = selection.sources
    if (mode === 'rescan' && indexMetaIsCurrent(meta)) {
      await buildRescan(selection.sources, selection.discovered, meta || {}, generation, controller.signal)
    } else {
      await buildInitialIndex(selection.sources, selection.discovered, meta, generation, controller.signal)
    }
  })()
    .catch(async (error) => {
      const cancelled =
        error instanceof FileIndexCancelledError || controller.signal.aborted || generation !== indexGeneration
      runtimeIndexState = {
        ...runtimeIndexState,
        status: cancelled ? 'cancelled' : 'error',
        mode: '',
        stage: '',
        error: cancelled ? '' : error instanceof Error ? error.message : 'Semantic filesystem indexing failed',
      }
    })
    .finally(() => {
      if (activeAbortController === controller) activeAbortController = null
      activeIndexPromise = null
    })
}

function statusFromMeta(
  modelState: OllamaModelState,
  meta: Record<string, unknown> | null,
  imageModelInstalled: boolean,
): FileSemanticStatus {
  const currentMeta = indexMetaIsCurrent(meta) ? meta : null
  const runtimeBuilding = runtimeIndexState.status === 'building'
  const runtimeError = runtimeIndexState.status === 'error' && !currentMeta
  const runtimeCancelled = runtimeIndexState.status === 'cancelled' && !currentMeta
  const indexStatus: FileSemanticIndexStatus = runtimeBuilding
    ? 'building'
    : runtimeError
      ? 'error'
      : runtimeCancelled
        ? 'cancelled'
        : currentMeta
          ? 'ready'
          : 'missing'
  return {
    sources: runtimeBuilding ? runtimeIndexSources : fileIndexSourcesFromMeta(currentMeta),
    ollamaAvailable: modelState.available,
    imageModelInstalled,
    embeddingModelInstalled: modelIsInstalled(modelState.installed, FILE_EMBEDDING_MODEL),
    imageModel: FILE_IMAGE_DESCRIPTION_MODEL,
    embeddingModel: FILE_EMBEDDING_MODEL,
    embeddingBatchSize: runtimeBuilding
      ? runtimeIndexState.embeddingBatchSize || undefined
      : Number(currentMeta?.embeddingBatchSize || 0) || undefined,
    indexStatus,
    nodeCount: runtimeBuilding ? runtimeIndexState.nodeCount : Number(currentMeta?.nodeCount || 0),
    fileCount: runtimeBuilding ? runtimeIndexState.fileCount : Number(currentMeta?.fileCount || 0),
    semanticCount: runtimeBuilding ? runtimeIndexState.semanticCount : Number(currentMeta?.semanticCount || 0),
    conceptCount: runtimeBuilding ? runtimeIndexState.conceptCount : Number(currentMeta?.conceptCount || 0),
    skippedCount: runtimeBuilding ? runtimeIndexState.skippedCount : Number(currentMeta?.skippedCount || 0),
    failedCount: runtimeBuilding ? runtimeIndexState.failedCount : Number(currentMeta?.failedCount || 0),
    generatedAt: currentMeta ? Number(currentMeta.generatedAt || 0) : undefined,
    stage: runtimeBuilding ? runtimeIndexState.stage : undefined,
    completed: runtimeBuilding ? runtimeIndexState.completed : undefined,
    total: runtimeBuilding ? runtimeIndexState.total : undefined,
    estimatedRemainingMs: runtimeBuilding ? runtimeIndexState.estimatedRemainingMs : undefined,
    stageProcessed: runtimeBuilding ? runtimeIndexState.stageProcessed : undefined,
    stageIndexed: runtimeBuilding ? runtimeIndexState.stageIndexed : undefined,
    stageFileTotal: runtimeBuilding ? runtimeIndexState.stageFileTotal : undefined,
    stageWorkerCount: runtimeBuilding ? runtimeIndexState.stageWorkerCount : undefined,
    error: runtimeError ? runtimeIndexState.error : undefined,
  }
}

/** Counts eligible files across the selected mounted locations without writing index records. */
export async function preflightFileSemanticIndex(
  homePath: string,
  selectedSourceIdsOrForce: string[] | boolean = [],
  force = false,
): Promise<FileSemanticPreflight> {
  const selectedSourceIds = Array.isArray(selectedSourceIdsOrForce) ? selectedSourceIdsOrForce : []
  const forceRefresh = typeof selectedSourceIdsOrForce === 'boolean' ? selectedSourceIdsOrForce : force
  const selection = await resolveSelectedFileIndexSources(homePath, selectedSourceIds)
  const key = selection.sources
    .map((source) => source.id)
    .sort()
    .join('\u0000')
  if (
    !forceRefresh &&
    cachedPreflight &&
    cachedPreflight.key === key &&
    Date.now() - cachedPreflight.checkedAt < PREFLIGHT_CACHE_MS
  ) {
    return cachedPreflight.result
  }
  const result = await countEligibleFilesystemEntries(selection.sources, selection.discovered)
  cachedPreflight = { key, result, checkedAt: Date.now() }
  return result
}

async function verifiedPreflight(
  homePath: string,
  selectedSourceIds: string[],
  confirmLargeScan: boolean,
): Promise<FileSemanticPreflight> {
  const preflight = await preflightFileSemanticIndex(homePath, selectedSourceIds)
  if (preflight.requiresConfirmation && !confirmLargeScan) {
    throw new Error(
      `IRIS found ${preflight.fileCount.toLocaleString()} eligible files. Confirm the large scan before indexing.`,
    )
  }
  return preflight
}

/** Returns Ollama and encrypted filesystem-index status, optionally starting a safe default build. */
export async function getFileSemanticStatus(homePath: string, buildIfMissing = false): Promise<FileSemanticStatus> {
  const [modelState, meta, imageModelInstalled] = await Promise.all([
    readOllamaModelState(),
    readEncryptedFileIndexMeta(),
    isFileClipModelInstalled(),
  ])
  if (
    buildIfMissing &&
    !indexMetaIsCurrent(meta) &&
    modelState.available &&
    modelIsInstalled(modelState.installed, FILE_EMBEDDING_MODEL) &&
    imageModelInstalled &&
    !activeIndexPromise
  ) {
    const preflight = await preflightFileSemanticIndex(homePath)
    if (!preflight.requiresConfirmation) startIndexOperation(homePath, 'rebuild')
  }
  return statusFromMeta(modelState, meta, imageModelInstalled)
}

/** Downloads the Ollama text model and local CLIP image model used by the filesystem index. */
export async function installFileSemanticModels(homePath: string): Promise<FileSemanticStatus> {
  try {
    const state = await readOllamaModelState(true)
    if (!state.available) throw new Error('The system Ollama service is not available')
    if (!modelIsInstalled(state.installed, FILE_EMBEDDING_MODEL)) {
      await pullModel(FILE_EMBEDDING_MODEL)
    }
    cachedModelState = null
    await installFileClipModel()
    await verifyModelsInstalled()
    runtimeIndexState = emptyRuntimeState()
    return getFileSemanticStatus(homePath, false)
  } catch (error) {
    setRuntimeIndexError(error, 'Failed to prepare semantic indexing models')
    throw error
  }
}

/** Starts a complete background rebuild using the selected discovered locations. */
export async function rebuildFileSemanticIndex(
  homePath: string,
  confirmLargeScan = false,
  selectedSourceIds: string[] = [],
): Promise<FileSemanticStatus> {
  try {
    await verifiedPreflight(homePath, selectedSourceIds, confirmLargeScan)
    await verifyModelsInstalled()
    if (activeIndexPromise) throw new Error('Filesystem indexing is already running')
    runtimeIndexState = emptyRuntimeState()
    startIndexOperation(homePath, 'rebuild', selectedSourceIds)
    return getFileSemanticStatus(homePath, false)
  } catch (error) {
    setRuntimeIndexError(error, 'Failed to start semantic filesystem indexing')
    throw error
  }
}

/** Starts a lightweight comparison across the locked source set. */
export async function rescanFileSemanticIndex(homePath: string): Promise<FileSemanticStatus> {
  try {
    await verifyModelsInstalled()
    if (activeIndexPromise) throw new Error('Filesystem indexing is already running')
    const meta = await readEncryptedFileIndexMeta()
    if (!indexMetaIsCurrent(meta)) throw new Error('Create the file index before refreshing it')
    cachedSearchRecords = null
    runtimeIndexState = emptyRuntimeState()
    startIndexOperation(homePath, 'rescan')
    return getFileSemanticStatus(homePath, false)
  } catch (error) {
    setRuntimeIndexError(error, 'Failed to refresh semantic filesystem indexing')
    throw error
  }
}

/** Cancels the active scan and its current Ollama request. */
export async function cancelFileSemanticIndex(homePath: string): Promise<FileSemanticStatus> {
  indexGeneration += 1
  activeAbortController?.abort()
  const active = activeIndexPromise
  if (active) await active.catch(() => undefined)
  return getFileSemanticStatus(homePath, false)
}

/** Deletes only the encrypted File Manager index and unlocks source selection. */
export async function clearFileSemanticIndex(homePath: string): Promise<FileSemanticStatus> {
  indexGeneration += 1
  activeAbortController?.abort()
  const active = activeIndexPromise
  if (active) await active.catch(() => undefined)
  await clearEncryptedFileIndex()
  runtimeIndexState = emptyRuntimeState()
  runtimeIndexSources = []
  cachedSearchRecords = null
  cachedPreflight = null
  return getFileSemanticStatus(homePath, false)
}

async function loadSearchRecords(): Promise<SearchCacheRecord[]> {
  if (cachedSearchRecords) return cachedSearchRecords
  const meta = await readEncryptedFileIndexMeta()
  if (!indexMetaIsCurrent(meta)) return []
  const [nodes, semantics, videoSemantics] = await Promise.all([
    readEncryptedFilesystemNodes(),
    readEncryptedFileSemantics(),
    readEncryptedVideoFrameSemantics(),
  ])
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  const recordFor = (
    sourceSemanticId: string,
    fileId: string,
    semanticType: 'text' | 'image' | 'video',
    metadata: Record<string, unknown>,
    embedding: number[],
    timestampMs?: number,
  ): SearchCacheRecord | null => {
    const node = nodesById.get(fileId)
    if (!node) return null
    const nodeInfo = nodeMetadata(node.metadata)
    if (nodeInfo.nodeType !== 'file') return null
    const relativePath = nodeInfo.relativePath
    const sourcePath = nodeInfo.sourcePath
    if (!sourcePath || !path.isAbsolute(sourcePath)) return null
    const absolutePath = path.resolve(sourcePath, relativePath)
    if (pathContainsExcludedDirectory(sourcePath, absolutePath)) return null
    return {
      id: node.id,
      name: nodeInfo.name,
      path: absolutePath,
      relativePath,
      nodeType: 'file',
      size: nodeInfo.size,
      modifiedAt: nodeInfo.modifiedAt,
      summary: String(metadata.summary || ''),
      semanticType,
      ...(typeof timestampMs === 'number' ? { timestampMs } : {}),
      score: 0,
      embedding,
      sourceSemanticId,
      embeddingSpace: String(
        metadata.embeddingSpace || (semanticType === 'text' ? FILE_EMBEDDING_MODEL : FILE_CLIP_MODEL),
      ),
    }
  }

  const normalRecords = semantics
    .map((semantic) => {
      const semanticType = semantic.metadata.semanticType === 'image' ? 'image' : 'text'
      return recordFor(semantic.fileId, semantic.fileId, semanticType, semantic.metadata, semantic.embedding)
    })
    .filter((record): record is SearchCacheRecord => Boolean(record))
  const videoRecords = videoSemantics
    .map((semantic) =>
      recordFor(
        semantic.semanticId,
        semantic.fileId,
        'video',
        semantic.metadata,
        semantic.embedding,
        semantic.timestampMs,
      ),
    )
    .filter((record): record is SearchCacheRecord => Boolean(record))
  cachedSearchRecords = [...normalRecords, ...videoRecords]
  return cachedSearchRecords
}

function bestVisualRecordPerFile(records: SearchCacheRecord[], embedding: number[]): SearchCacheRecord[] {
  const best = new Map<string, { record: SearchCacheRecord; score: number }>()
  for (const record of records) {
    const score = cosineSimilarity(embedding, record.embedding)
    const current = best.get(record.id)
    if (!current || score > current.score) best.set(record.id, { record, score })
  }
  return [...best.values()].map((item) => item.record)
}

/** Embeds one query in the text and CLIP spaces and ranks matching files. */
export async function searchFileSemanticIndex(
  query: unknown,
  limit: unknown = 50,
  kind: unknown = 'all',
): Promise<FileSemanticSearchResult[]> {
  const normalizedQuery = String(query || '')
    .trim()
    .slice(0, 2000)
  if (!normalizedQuery) return []
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)))
  const records = await loadSearchRecords()
  if (!records.length) return []
  const normalizedKind: FileSemanticSearchKind = kind === 'text' || kind === 'image' || kind === 'video' ? kind : 'all'
  const textRecords = records.filter(
    (record) => (normalizedKind === 'all' || normalizedKind === 'text') && record.semanticType === 'text',
  )
  const visualRecords = records.filter(
    (record) => record.semanticType !== 'text' && (normalizedKind === 'all' || record.semanticType === normalizedKind),
  )
  const [textEmbedding, visualEmbedding] = await Promise.all([
    textRecords.length ? embedText(normalizedQuery) : Promise.resolve([]),
    visualRecords.length ? embedClipText(normalizedQuery) : Promise.resolve([]),
  ])
  const bestVisualRecords = visualRecords.length ? bestVisualRecordPerFile(visualRecords, visualEmbedding) : []

  return [
    ...normalizedSearchCandidates(textRecords, textEmbedding).slice(0, boundedLimit),
    ...normalizedSearchCandidates(bestVisualRecords, visualEmbedding).slice(0, boundedLimit),
  ]
    .sort(
      (left, right) =>
        right.score - left.score || right.rawScore - left.rawScore || left.record.name.localeCompare(right.record.name),
    )
    .slice(0, boundedLimit)
    .map((item) => resultWithoutEmbedding(item.record, item.score, item.rawScore))
}

function resultWithoutEmbedding(record: SearchCacheRecord, score: number, rawScore?: number): FileSemanticSearchResult {
  const {
    embedding: _embedding,
    embeddingSpace: _embeddingSpace,
    sourceSemanticId: _sourceSemanticId,
    ...result
  } = record
  return {
    ...result,
    score,
    ...(typeof rawScore === 'number' ? { rawScore } : {}),
  }
}

function normalizedFilesystemPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Returns indexed files nearest to one selected file in the text embedding space. */
export async function findSimilarFiles(filePath: unknown, limit: unknown = 50): Promise<FileSemanticSearchResult[]> {
  const normalizedPath = normalizedFilesystemPath(String(filePath || ''))
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)))
  const records = await loadSearchRecords()
  const sources = records.filter((record) => normalizedFilesystemPath(record.path) === normalizedPath)
  const source = sources[0]
  if (!source) return []
  const best = new Map<string, { record: SearchCacheRecord; score: number }>()
  for (const record of records) {
    if (
      record.id === source.id ||
      record.semanticType !== source.semanticType ||
      record.embeddingSpace !== source.embeddingSpace
    ) {
      continue
    }
    let score = -1
    for (const sourceRecord of sources) {
      score = Math.max(score, cosineSimilarity(sourceRecord.embedding, record.embedding))
    }
    const current = best.get(record.id)
    if (score > -1 && (!current || score > current.score)) {
      best.set(record.id, { record, score })
    }
  }
  return [...best.values()]
    .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name))
    .slice(0, boundedLimit)
    .map((candidate) => resultWithoutEmbedding(candidate.record, candidate.score))
}

function normalizedConceptCandidates(
  concepts: EncryptedFileConceptRecord[],
  queryEmbedding: ArrayLike<number>,
): RankedConceptCandidate[] {
  const candidates = concepts
    .map((concept) => ({
      concept,
      rawScore: cosineSimilarity(queryEmbedding, concept.centroid),
      score: 0,
    }))
    .filter((candidate) => candidate.rawScore > -1)
    .sort(
      (left, right) =>
        right.rawScore - left.rawScore ||
        right.concept.memberCount - left.concept.memberCount ||
        left.concept.id.localeCompare(right.concept.id),
    )
  if (!candidates.length) return []
  const rawScores = candidates.map((candidate) => candidate.rawScore)
  const center = median(rawScores)
  const absoluteDeviations = rawScores.map((score) => Math.abs(score - center))
  const robustScale = median(absoluteDeviations) * 1.4826
  const fallbackScale = standardDeviation(rawScores, center)
  const scale = robustScale > 0.000001 ? robustScale : fallbackScale
  const rankDenominator = Math.max(1, candidates.length - 1)
  return candidates.map((candidate, index) => {
    const zScore = scale > 0.000001 ? Math.max(-8, Math.min(8, (candidate.rawScore - center) / scale)) : 0
    const distributionScore = 1 / (1 + Math.exp(-1.702 * zScore))
    const rankScore = 1 - index / rankDenominator
    return {
      ...candidate,
      score: distributionScore * 0.9 + rankScore * 0.1,
    }
  })
}

function conceptQueryTitle(query: string): string {
  const ignored = new Set(['file', 'files', 'show', 'find', 'about', 'related', 'similar'])
  const words =
    query
      .toLowerCase()
      .match(/[a-z][a-z0-9'-]{1,}/g)
      ?.filter((word) => !ignored.has(word))
      .slice(0, 5) || []
  const source = words.length ? words.join(' ') : query.trim()
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ')
      .slice(0, 64) || 'Related'
  )
}

function conceptFilenameDescriptor(query: string, records: SearchCacheRecord[]): string | null {
  const ignored = new Set([
    'file',
    'files',
    'image',
    'images',
    'video',
    'videos',
    'document',
    'documents',
    'photo',
    'photos',
    'copy',
    'final',
    'new',
    'the',
    'and',
    'for',
    'with',
  ])
  for (const word of query.toLowerCase().match(/[a-z]{2,}/g) || []) ignored.add(word)
  const counts = new Map<string, number>()
  for (const record of records.slice(0, 12)) {
    const words =
      path
        .parse(record.name)
        .name.toLowerCase()
        .match(/[a-z][a-z'-]{2,}/g) || []
    for (const word of new Set(words)) {
      if (ignored.has(word)) continue
      counts.set(word, (counts.get(word) || 0) + 1)
    }
  }
  const best = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]
  if (!best || best[1] < 2) return null
  return `${best[0].charAt(0).toUpperCase()}${best[0].slice(1)}`
}

function conceptSpaceLabel(space: EncryptedFileConceptEmbeddingSpace): string {
  return space === 'clip' ? 'Images & Videos' : 'Documents & Text'
}

function diverseConceptCandidates(candidates: RankedConceptCandidate[], limit: number): RankedConceptCandidate[] {
  const selected: RankedConceptCandidate[] = []
  for (const candidate of candidates) {
    if (
      selected.some(
        (existing) =>
          existing.concept.embeddingSpace === candidate.concept.embeddingSpace &&
          cosineSimilarity(existing.concept.centroid, candidate.concept.centroid) >= 0.94,
      )
    ) {
      continue
    }
    selected.push(candidate)
    if (selected.length >= limit) break
  }
  return selected
}

/** Searches persistent MiniLM and CLIP concept centroids, then loads their strongest members. */
export async function searchFileSemanticConcepts(
  query: unknown,
  groupLimit: unknown = 6,
  filesPerGroup: unknown = 12,
): Promise<FileSemanticConceptGroup[]> {
  const normalizedQuery = String(query || '')
    .trim()
    .slice(0, 2000)
  if (!normalizedQuery) return []
  const boundedGroupLimit = Math.max(1, Math.min(10, Math.floor(Number(groupLimit) || 6)))
  const boundedFilesPerGroup = Math.max(2, Math.min(20, Math.floor(Number(filesPerGroup) || 12)))
  const meta = await readEncryptedFileIndexMeta()
  if (!indexMetaIsCurrent(meta)) return []
  const generation = String(meta?.conceptGeneration || '')
  const concepts = (await readEncryptedFileConcepts(generation)).filter((concept) => concept.memberCount >= 2)
  if (!concepts.length) return []

  const miniLmConcepts = concepts.filter((concept) => concept.embeddingSpace === 'minilm')
  const clipConcepts = concepts.filter((concept) => concept.embeddingSpace === 'clip')
  const [miniLmQuery, clipQuery] = await Promise.all([
    miniLmConcepts.length ? embedText(normalizedQuery) : Promise.resolve([]),
    clipConcepts.length ? embedClipText(normalizedQuery) : Promise.resolve([]),
  ])
  const merged = [
    ...normalizedConceptCandidates(miniLmConcepts, miniLmQuery),
    ...normalizedConceptCandidates(clipConcepts, clipQuery),
  ].sort(
    (left, right) =>
      right.score - left.score ||
      right.rawScore - left.rawScore ||
      right.concept.memberCount - left.concept.memberCount,
  )
  const selected = diverseConceptCandidates(merged, boundedGroupLimit * 2)
  const memberships = await readEncryptedFileConceptMemberships(
    selected.map((candidate) => candidate.concept.id),
    boundedFilesPerGroup * 3,
  )
  const membershipsByConcept = new Map<string, typeof memberships>()
  for (const membership of memberships) {
    const list = membershipsByConcept.get(membership.conceptId) || []
    list.push(membership)
    membershipsByConcept.set(membership.conceptId, list)
  }

  const records = await loadSearchRecords()
  const recordsBySource = new Map(records.map((record) => [record.sourceSemanticId, record]))
  const recordsByFile = new Map<string, SearchCacheRecord>()
  for (const record of records) {
    if (!recordsByFile.has(record.id)) recordsByFile.set(record.id, record)
  }
  const titleBase = conceptQueryTitle(normalizedQuery)
  const spaceOrdinals = new Map<EncryptedFileConceptEmbeddingSpace, number>()
  const groups: FileSemanticConceptGroup[] = []

  for (const candidate of selected) {
    const groupMemberships = membershipsByConcept.get(candidate.concept.id) || []
    const groupRecords: Array<{ record: SearchCacheRecord; score: number }> = []
    const seenFiles = new Set<string>()
    for (const membership of groupMemberships) {
      const record = recordsBySource.get(membership.sourceSemanticId) || recordsByFile.get(membership.fileId)
      if (!record || seenFiles.has(record.id)) continue
      seenFiles.add(record.id)
      groupRecords.push({ record, score: membership.similarity })
      if (groupRecords.length >= boundedFilesPerGroup) break
    }
    if (groupRecords.length < 2) continue
    const ordinal = (spaceOrdinals.get(candidate.concept.embeddingSpace) || 0) + 1
    spaceOrdinals.set(candidate.concept.embeddingSpace, ordinal)
    const descriptor = conceptFilenameDescriptor(
      normalizedQuery,
      groupRecords.map((item) => item.record),
    )
    const fallback = `${conceptSpaceLabel(candidate.concept.embeddingSpace)}${ordinal > 1 ? ` ${ordinal}` : ''}`
    groups.push({
      id: candidate.concept.id,
      title: `${titleBase} · ${descriptor || fallback}`,
      results: groupRecords.map((item) => resultWithoutEmbedding(item.record, item.score)),
    })
    if (groups.length >= boundedGroupLimit) break
  }
  return groups
}

/** Cancels active work and clears decrypted in-memory vectors before encrypted data is removed. */
export async function clearFileSemanticRuntimeCache(): Promise<void> {
  indexGeneration += 1
  activeAbortController?.abort()
  const active = activeIndexPromise
  if (active) await active.catch(() => undefined)
  cachedSearchRecords = null
  cachedModelState = null
  clearFileClipRuntime()
  cachedPreflight = null
  runtimeIndexState = emptyRuntimeState()
  runtimeIndexSources = []
}
