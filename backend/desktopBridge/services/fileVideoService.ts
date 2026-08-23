/**
 * Samples videos with the system FFmpeg binary. Cheap low-resolution probes choose scene
 * changes for semantic indexing, while bounded JPEG extraction supplies File Manager tiles.
 */

import { spawn } from 'node:child_process'
import type { PreparedClipImage } from './fileImageProcessingWorkerTypes.js'

const PROBE_WIDTH = 64
const PROBE_HEIGHT = 36
const CLIP_SIZE = 224
const GRID_COLUMNS = 16
const GRID_ROWS = 9
const HISTOGRAM_BUCKETS = 24
const MAX_PROBES = 600
const MAX_EMBEDDING_FRAMES = 96
const FRAME_CHUNK_SIZE = 16
const FFMPEG_TIMEOUT_MS = 45_000
const VIDEO_THUMBNAIL_TIMEOUT_MS = 15_000
const MAX_VIDEO_THUMBNAIL_JOBS = 2
const MAX_STDERR_BYTES = 64 * 1024
const MIN_SCENE_GAP_MS = 1_500
const SCENE_SETTLE_MS = 350

export interface VideoFrameForIndex {
  timestampMs: number
  image: PreparedClipImage
}

export interface ExtractedVideoFrames {
  durationMs: number
  frames: VideoFrameForIndex[]
}

export interface ExtractedVideoThumbnail {
  buffer: Buffer
  width: number
  height: number
}

interface SpawnResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

interface FrameSignature {
  timestampMs: number
  spatial: Uint8Array
  histogram: Uint16Array
  brightness: number
  variance: number
}

let ffmpegAvailable = false
let ffmpegCheckPromise: Promise<void> | null = null
let activeVideoThumbnailJobs = 0
const waitingVideoThumbnailJobs: Array<() => void> = []

function ffmpegBinary(): string {
  return String(process.env.IRIS_FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg'
}

function spawnFfmpeg(
  args: string[],
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    maxStdoutBytes?: number
  } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Video indexing was cancelled'))
      return
    }
    const child = spawn(ffmpegBinary(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('FFmpeg video extraction timed out'))
    }, options.timeoutMs || FFMPEG_TIMEOUT_MS)
    const abort = () => {
      child.kill('SIGKILL')
      finish(new Error('Video indexing was cancelled'))
    }

    function cleanup() {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }

    function finish(error?: Error, result?: SpawnResult) {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result!)
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      const max = options.maxStdoutBytes || Number.POSITIVE_INFINITY
      if (stdoutBytes > max) {
        child.kill('SIGKILL')
        finish(new Error('FFmpeg produced more frame data than expected'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const remaining = MAX_STDERR_BYTES - stderrBytes
      const bounded = chunk.subarray(0, remaining)
      stderrBytes += bounded.length
      stderr.push(bounded)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (exitCode) =>
      finish(undefined, {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: Number(exitCode ?? -1),
      }),
    )
  })
}

/** Verifies once per process that a usable system FFmpeg binary is available. */
export async function ensureVideoIndexingAvailable(signal?: AbortSignal): Promise<void> {
  if (ffmpegAvailable) return
  ffmpegCheckPromise ||= spawnFfmpeg(['-version'], {
    signal,
    timeoutMs: 5_000,
    maxStdoutBytes: 128 * 1024,
  })
    .then((result) => {
      if (result.exitCode !== 0 || !/ffmpeg version/i.test(result.stdout.toString('utf8'))) {
        throw new Error('FFmpeg is unavailable')
      }
      ffmpegAvailable = true
    })
    .catch((error) => {
      ffmpegCheckPromise = null
      throw new Error(
        `Video indexing requires FFmpeg on PATH or IRIS_FFMPEG_PATH (${error instanceof Error ? error.message : String(error)})`,
      )
    })
  await ffmpegCheckPromise
}

async function acquireVideoThumbnailSlot(): Promise<void> {
  if (activeVideoThumbnailJobs < MAX_VIDEO_THUMBNAIL_JOBS) {
    activeVideoThumbnailJobs += 1
    return
  }
  await new Promise<void>((resolve) => waitingVideoThumbnailJobs.push(resolve))
  activeVideoThumbnailJobs += 1
}

function releaseVideoThumbnailSlot(): void {
  activeVideoThumbnailJobs = Math.max(0, activeVideoThumbnailJobs - 1)
  waitingVideoThumbnailJobs.shift()?.()
}

/** Returns a dense-short/sparse-long frame budget with a hard cap for extreme videos. */
export function calculateVideoFrameBudget(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (durationSeconds < 1) return 1
  if (durationSeconds <= 60) return Math.max(2, Math.ceil(durationSeconds / 3))
  return Math.min(MAX_EMBEDDING_FRAMES, Math.ceil(20 + 6 * Math.log2(durationSeconds / 60)))
}

/** Returns sparse scene-probe timestamps without decoding the full video. */
export function videoProbeTimestamps(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
  const interval = durationSeconds <= 60 ? 0.5 : durationSeconds <= 600 ? 1 : durationSeconds / MAX_PROBES
  const count = Math.max(1, Math.min(MAX_PROBES, Math.ceil(durationSeconds / interval)))
  return Array.from({ length: count }, (_, index) =>
    Math.min(durationSeconds - 0.001, ((index + 0.5) / count) * durationSeconds),
  ).filter((value) => value >= 0)
}

function durationFromStderr(stderr: string): number {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

async function readVideoDuration(filePath: string, signal?: AbortSignal): Promise<number> {
  const result = await spawnFfmpeg(['-hide_banner', '-i', filePath], {
    signal,
    timeoutMs: 10_000,
    maxStdoutBytes: 1,
  })
  const duration = durationFromStderr(result.stderr)
  if (!duration) throw new Error('FFmpeg could not determine the video duration')
  return duration
}

/** Picks a useful early frame while avoiding a commonly black first frame. */
export function calculateVideoThumbnailTimestamp(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (durationSeconds <= 2) return durationSeconds / 2
  return Math.min(durationSeconds - 0.05, Math.min(5, Math.max(1, durationSeconds * 0.25)))
}

/** Extracts one bounded JPEG frame for an on-demand File Manager thumbnail. */
export async function createVideoThumbnail(
  filePath: string,
  width: number,
  height: number,
): Promise<ExtractedVideoThumbnail> {
  await acquireVideoThumbnailSlot()
  try {
    await ensureVideoIndexingAvailable()
    const durationSeconds = await readVideoDuration(filePath)
    const timestamp = calculateVideoThumbnailTimestamp(durationSeconds)
    const result = await spawnFfmpeg(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        filePath,
        '-ss',
        timestamp.toFixed(3),
        '-frames:v',
        '1',
        '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        '-an',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-q:v',
        '3',
        'pipe:1',
      ],
      {
        timeoutMs: VIDEO_THUMBNAIL_TIMEOUT_MS,
        maxStdoutBytes: Math.max(512 * 1024, width * height * 4),
      },
    )
    if (result.exitCode !== 0 || !result.stdout.length) {
      throw new Error(result.stderr.trim() || 'FFmpeg video thumbnail extraction failed')
    }
    return { buffer: result.stdout, width, height }
  } finally {
    releaseVideoThumbnailSlot()
  }
}

function frameFilter(index: number, width: number, height: number): string {
  return `[${index}:v:0]trim=end_frame=1,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgb24,setpts=PTS-STARTPTS[v${index}]`
}

async function extractRawFrames(
  filePath: string,
  timestamps: number[],
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Buffer[]> {
  const frames: Buffer[] = []
  const frameBytes = width * height * 3
  for (let start = 0; start < timestamps.length; start += FRAME_CHUNK_SIZE) {
    const chunk = timestamps.slice(start, start + FRAME_CHUNK_SIZE)
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
    for (const timestamp of chunk) {
      args.push('-ss', Math.max(0, timestamp).toFixed(3), '-i', filePath)
    }
    const filters = chunk.map((_, index) => frameFilter(index, width, height))
    filters.push(`${chunk.map((_, index) => `[v${index}]`).join('')}concat=n=${chunk.length}:v=1:a=0[out]`)
    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[out]',
      '-frames:v',
      String(chunk.length),
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    )
    const result = await spawnFfmpeg(args, {
      signal,
      maxStdoutBytes: frameBytes * chunk.length,
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'FFmpeg frame extraction failed')
    if (result.stdout.length < frameBytes) continue
    const count = Math.min(chunk.length, Math.floor(result.stdout.length / frameBytes))
    for (let index = 0; index < count; index += 1) {
      frames.push(result.stdout.subarray(index * frameBytes, (index + 1) * frameBytes))
    }
  }
  return frames
}

function signature(frame: Buffer, timestampMs: number): FrameSignature {
  const cellWidth = PROBE_WIDTH / GRID_COLUMNS
  const cellHeight = PROBE_HEIGHT / GRID_ROWS
  const sums = new Uint32Array(GRID_COLUMNS * GRID_ROWS * 3)
  const counts = new Uint16Array(GRID_COLUMNS * GRID_ROWS)
  const histogram = new Uint16Array(HISTOGRAM_BUCKETS)
  let brightnessSum = 0
  let brightnessSquared = 0

  for (let y = 0; y < PROBE_HEIGHT; y += 1) {
    for (let x = 0; x < PROBE_WIDTH; x += 1) {
      const offset = (y * PROBE_WIDTH + x) * 3
      const r = frame[offset]
      const g = frame[offset + 1]
      const b = frame[offset + 2]
      const yy = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)))
      const cb = Math.max(0, Math.min(255, Math.round(128 - 0.169 * r - 0.331 * g + 0.5 * b)))
      const cr = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.419 * g - 0.081 * b)))
      const cellX = Math.min(GRID_COLUMNS - 1, Math.floor(x / cellWidth))
      const cellY = Math.min(GRID_ROWS - 1, Math.floor(y / cellHeight))
      const cell = cellY * GRID_COLUMNS + cellX
      sums[cell * 3] += yy
      sums[cell * 3 + 1] += cb
      sums[cell * 3 + 2] += cr
      counts[cell] += 1
      brightnessSum += yy
      brightnessSquared += yy * yy
      histogram[Math.min(7, r >> 5)] += 1
      histogram[8 + Math.min(7, g >> 5)] += 1
      histogram[16 + Math.min(7, b >> 5)] += 1
    }
  }

  const spatial = new Uint8Array(GRID_COLUMNS * GRID_ROWS * 3)
  for (let cell = 0; cell < counts.length; cell += 1) {
    const count = Math.max(1, counts[cell])
    spatial[cell * 3] = Math.round(sums[cell * 3] / count)
    spatial[cell * 3 + 1] = Math.round(sums[cell * 3 + 1] / count)
    spatial[cell * 3 + 2] = Math.round(sums[cell * 3 + 2] / count)
  }
  const pixels = PROBE_WIDTH * PROBE_HEIGHT
  const brightness = brightnessSum / pixels
  const variance = Math.max(0, brightnessSquared / pixels - brightness * brightness)
  return { timestampMs, spatial, histogram, brightness, variance }
}

function signatureDifference(left: FrameSignature, right: FrameSignature): number {
  let spatialDifference = 0
  for (let index = 0; index < left.spatial.length; index += 3) {
    spatialDifference +=
      Math.abs(left.spatial[index] - right.spatial[index]) * 0.5 +
      Math.abs(left.spatial[index + 1] - right.spatial[index + 1]) * 0.25 +
      Math.abs(left.spatial[index + 2] - right.spatial[index + 2]) * 0.25
  }
  spatialDifference /= left.spatial.length / 3
  let histogramDifference = 0
  const total = PROBE_WIDTH * PROBE_HEIGHT
  for (let index = 0; index < left.histogram.length; index += 1) {
    histogramDifference += Math.abs(left.histogram[index] - right.histogram[index]) / total
  }
  return spatialDifference * 0.8 + histogramDifference * 255 * 0.2
}

function evenlySpaced(durationSeconds: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => ((index + 0.5) / count) * durationSeconds)
}

function selectDistinctiveTimestamps(signatures: FrameSignature[], count: number, durationSeconds: number): number[] {
  const candidates = signatures
    .map((current, index) => {
      if (index === 0 || current.brightness < 5 || current.brightness > 250 || current.variance < 3) return null
      const previous = signatures[index - 1]
      const older = signatures[Math.max(0, index - 3)]
      return {
        timestampMs: Math.min(durationSeconds * 1000 - 1, current.timestampMs + SCENE_SETTLE_MS),
        score: Math.max(signatureDifference(current, previous), signatureDifference(current, older)),
      }
    })
    .filter((value): value is { timestampMs: number; score: number } => Boolean(value))
    .sort((left, right) => right.score - left.score)

  const selected: number[] = []
  for (const candidate of candidates) {
    if (selected.some((value) => Math.abs(value - candidate.timestampMs) < MIN_SCENE_GAP_MS)) continue
    selected.push(candidate.timestampMs)
    if (selected.length >= count) break
  }
  return selected.map((value) => value / 1000)
}

function uniqueTimestamps(values: number[], durationSeconds: number, limit: number): number[] {
  const selected: number[] = []
  for (const timestamp of values) {
    const bounded = Math.max(0, Math.min(durationSeconds - 0.001, timestamp))
    if (selected.some((value) => Math.abs(value - bounded) < 0.2)) continue
    selected.push(bounded)
    if (selected.length >= limit) break
  }
  return selected.sort((left, right) => left - right)
}

/** Extracts a bounded, semantically useful set of independent video frames. */
export async function extractVideoFramesForIndex(
  filePath: string,
  signal?: AbortSignal,
): Promise<ExtractedVideoFrames> {
  await ensureVideoIndexingAvailable(signal)
  const durationSeconds = await readVideoDuration(filePath, signal)
  const budget = calculateVideoFrameBudget(durationSeconds)
  if (!budget) return { durationMs: Math.round(durationSeconds * 1000), frames: [] }

  const probeTimes = videoProbeTimestamps(durationSeconds)
  const probeFrames = await extractRawFrames(filePath, probeTimes, PROBE_WIDTH, PROBE_HEIGHT, signal)
  const signatures = probeFrames.map((frame, index) => signature(frame, Math.round((probeTimes[index] || 0) * 1000)))
  const uniformCount = Math.ceil(budget / 2)
  const distinctiveCount = budget - uniformCount
  const timestamps = uniqueTimestamps(
    [
      ...selectDistinctiveTimestamps(signatures, distinctiveCount, durationSeconds),
      ...evenlySpaced(durationSeconds, uniformCount),
      ...evenlySpaced(durationSeconds, budget),
    ],
    durationSeconds,
    budget,
  )
  const fullFrames = await extractRawFrames(filePath, timestamps, CLIP_SIZE, CLIP_SIZE, signal)
  return {
    durationMs: Math.round(durationSeconds * 1000),
    frames: fullFrames.map((frame, index) => ({
      timestampMs: Math.round((timestamps[index] || 0) * 1000),
      image: {
        data: new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
        width: CLIP_SIZE,
        height: CLIP_SIZE,
        channels: 3,
      },
    })),
  }
}
