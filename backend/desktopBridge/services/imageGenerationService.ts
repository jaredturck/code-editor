import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { resolveWritablePathWithinRoot } from '../shared/filesystemBoundary.js'

export type ImageGenerationFormat = 'square' | 'landscape' | 'portrait'

interface ImageModelFile {
  id: string
  filename: string
  url: string
  sha256: string
  bytes: number
}

interface ImageGenerationRuntimeConfig {
  dataDir: string
}

interface ImageGenerationRequest {
  prompt: string
  outputPath: string
  workspaceRoot: string
  format: ImageGenerationFormat
}

interface ImageGenerationJobResult {
  jobId: string
  nativeJobId?: string
  saved: boolean
  path: string
  relativePath: string
  format: ImageGenerationFormat
  width: number
  height: number
  generationMs: number
  error?: string
}

interface ImageGenerationJob {
  id: string
  workspaceRoot: string
  path: string
  promise: Promise<ImageGenerationJobResult>
}

export interface ImageGenerationWaitResult {
  waited: number
  completed: ImageGenerationJobResult[]
  failed: ImageGenerationJobResult[]
}

interface RuntimeStatus {
  configured: boolean
  installed: boolean
  engineAvailable: boolean
  ready: boolean
  running: boolean
  installing: boolean
  installCompletedBytes: number
  installTotalBytes: number
  installPercent: number
  modelDir: string
  enginePath: string
  gpuIndex: number
  pendingJobs: number
  missingFiles: string[]
  error: string
}

const MODEL_FILES: readonly ImageModelFile[] = [
  {
    id: 'diffusion',
    filename: 'z_image_turbo-Q3_K.gguf',
    url: 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q3_K.gguf?download=true',
    sha256: '4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980',
    bytes: 3_143_559_104,
  },
  {
    id: 'text_encoder',
    filename: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf?download=true',
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
    bytes: 2_497_281_120,
  },
  {
    id: 'vae',
    filename: 'ae.safetensors',
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors?download=true',
    sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
    bytes: 335_304_388,
  },
]

export const IMAGE_GENERATION_FORMATS: Record<ImageGenerationFormat, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
}

const MODEL_TOTAL_BYTES = MODEL_FILES.reduce((total, file) => total + file.bytes, 0)
const SERVER_START_TIMEOUT_MS = 90_000
const GENERATION_TIMEOUT_MS = 3 * 60_000
const SERVER_IDLE_TIMEOUT_MS = 5 * 60_000
const POLL_INTERVAL_MS = 250
const SERVER_HOST = '127.0.0.1'
const DEFAULT_GPU_INDEX = 1

let runtimeConfig: ImageGenerationRuntimeConfig | null = null
let serverProcess: ChildProcessByStdio<null, Readable, Readable> | null = null
let serverPort = 0
let serverError = ''
let serverIdleTimer: ReturnType<typeof setTimeout> | null = null
let serverStartPromise: Promise<void> | null = null
let installPromise: Promise<RuntimeStatus> | null = null
let installCompletedBytes = 0
let activeGenerationCount = 0
const imageJobs = new Map<string, ImageGenerationJob>()

function runtimeRoot() {
  return runtimeConfig ? path.join(runtimeConfig.dataDir, 'image-generation') : ''
}

function modelDir() {
  return path.join(runtimeRoot(), 'models')
}

function configuredEnginePath() {
  const executable = process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'
  return path.join(runtimeRoot(), 'runtime', executable)
}

function fallbackEnginePath() {
  return process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'
}

function modelPath(file: ImageModelFile) {
  return path.join(modelDir(), file.filename)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fileExists(filePath: string) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
}

async function executableExists(executable: string) {
  if (path.isAbsolute(executable)) return fileExists(executable)
  const searchPath = String(process.env.PATH || '')
  const names =
    process.platform === 'win32' && !/\.exe$/i.test(executable) ? [executable, `${executable}.exe`] : [executable]
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      if (await fileExists(path.join(directory, name))) return true
    }
  }
  return false
}

async function resolveEnginePath() {
  const preferred = configuredEnginePath()
  if (await executableExists(preferred)) return preferred
  const fallback = fallbackEnginePath()
  return (await executableExists(fallback)) ? fallback : preferred
}

async function modelFilePresent(file: ImageModelFile) {
  const target = modelPath(file)
  if (!(await fileExists(target))) return false
  const stat = await fs.stat(target)
  return stat.isFile() && stat.size === file.bytes
}

async function missingModelFiles() {
  const missing: string[] = []
  for (const file of MODEL_FILES) {
    if (!(await modelFilePresent(file))) missing.push(file.filename)
  }
  return missing
}

async function hashFile(filePath: string) {
  const hash = createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024)
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

async function verifiedFile(file: ImageModelFile) {
  const target = modelPath(file)
  if (!(await fileExists(target))) return false
  const stat = await fs.stat(target)
  if (stat.size !== file.bytes) return false
  return (await hashFile(target)) === file.sha256
}

async function downloadModelFile(file: ImageModelFile) {
  const target = modelPath(file)
  const partial = `${target}.part`
  if (await verifiedFile(file)) {
    installCompletedBytes += file.bytes
    return
  }

  await fs.mkdir(modelDir(), { recursive: true })
  await fs.rm(partial, { force: true })
  const response = await fetch(file.url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Failed to download ${file.filename} (${response.status}).`)

  const hash = createHash('sha256')
  let completed = 0
  const stream = Readable.fromWeb(response.body as never)
  stream.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    completed += chunk.length
    installCompletedBytes += chunk.length
  })
  await pipeline(stream, createWriteStream(partial, { flags: 'wx' }))

  if (completed !== file.bytes) {
    await fs.rm(partial, { force: true })
    throw new Error(`${file.filename} download size mismatch.`)
  }
  if (hash.digest('hex') !== file.sha256) {
    await fs.rm(partial, { force: true })
    throw new Error(`${file.filename} checksum mismatch.`)
  }
  await fs.rename(partial, target)
}

function generationSize(format: ImageGenerationFormat) {
  return IMAGE_GENERATION_FORMATS[format] || IMAGE_GENERATION_FORMATS.landscape
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, SERVER_HOST, () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function serverBaseUrl() {
  return `http://${SERVER_HOST}:${serverPort}`
}

async function serverReady() {
  if (!serverProcess || !serverPort) return false
  try {
    const response = await fetch(`${serverBaseUrl()}/sdcpp/v1/capabilities`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch {
    return false
  }
}

function clearIdleTimer() {
  if (serverIdleTimer) clearTimeout(serverIdleTimer)
  serverIdleTimer = null
}

function scheduleIdleShutdown() {
  clearIdleTimer()
  serverIdleTimer = setTimeout(() => {
    void stopImageGenerationServer()
  }, SERVER_IDLE_TIMEOUT_MS)
}

function serverArgs(port: number) {
  const diffusion = modelPath(MODEL_FILES[0])
  const textEncoder = modelPath(MODEL_FILES[1])
  const vae = modelPath(MODEL_FILES[2])
  return [
    '--listen-ip',
    SERVER_HOST,
    '--listen-port',
    String(port),
    '--diffusion-model',
    diffusion,
    '--llm',
    textEncoder,
    '--vae',
    vae,
    '--backend',
    'cuda0',
    '--diffusion-fa',
  ]
}

async function startImageGenerationServerFresh() {
  if (!runtimeConfig) throw new Error('Image generation runtime is not configured.')
  const missing = await missingModelFiles()
  if (missing.length) throw new Error(`Image generation models are not installed: ${missing.join(', ')}`)

  const enginePath = await resolveEnginePath()
  if (!(await executableExists(enginePath))) {
    throw new Error(
      'stable-diffusion.cpp sd-server is not installed. Install the packaged runtime or make sd-server available on PATH.',
    )
  }

  await stopImageGenerationServer()
  serverError = ''
  serverPort = await findFreePort()
  const child = spawn(enginePath, serverArgs(serverPort), {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      CUDA_VISIBLE_DEVICES: String(DEFAULT_GPU_INDEX),
    },
  })
  serverProcess = child
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', (chunk: Buffer) => {
    serverError = String(chunk || '')
      .trim()
      .slice(-4000)
  })
  child.once('exit', () => {
    if (serverProcess === child) {
      serverProcess = null
      serverPort = 0
    }
  })

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!serverProcess || child.exitCode !== null) break
    if (await serverReady()) return
    await sleep(300)
  }

  await stopImageGenerationServer()
  throw new Error(serverError || 'stable-diffusion.cpp did not become ready before the startup timeout.')
}

async function startImageGenerationServer() {
  if (await serverReady()) {
    clearIdleTimer()
    return
  }
  if (!serverStartPromise) serverStartPromise = startImageGenerationServerFresh()
  try {
    await serverStartPromise
  } finally {
    serverStartPromise = null
  }
}

async function waitForJob(jobId: string) {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    const response = await fetch(`${serverBaseUrl()}/sdcpp/v1/jobs/${encodeURIComponent(jobId)}`)
    if (!response.ok) throw new Error(`Image generation job status failed (${response.status}).`)
    const job = (await response.json()) as Record<string, any>
    const status = String(job.status || '')
    if (status === 'completed') return job
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(String(job.error?.message || `Image generation ${status}.`))
    }
    await sleep(POLL_INTERVAL_MS)
  }
  await fetch(`${serverBaseUrl()}/sdcpp/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(
    () => undefined,
  )
  throw new Error('Image generation timed out.')
}

function outputExtension(outputPath: string) {
  const extension = path.extname(outputPath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.webp'
}

function outputFormat(extension: string) {
  if (extension === '.png') return 'png'
  if (extension === '.jpg' || extension === '.jpeg') return 'jpeg'
  return 'webp'
}

async function runImageGenerationJob(
  jobId: string,
  request: ImageGenerationRequest,
  targetPath: string,
  relativePath: string,
  extension: string,
): Promise<ImageGenerationJobResult> {
  const size = generationSize(request.format)
  const startedAt = Date.now()
  activeGenerationCount += 1
  clearIdleTimer()
  try {
    await startImageGenerationServer()
    const response = await fetch(`${serverBaseUrl()}/sdcpp/v1/img_gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: request.prompt,
        width: size.width,
        height: size.height,
        seed: -1,
        batch_count: 1,
        sample_params: {
          sample_steps: 8,
          guidance: { txt_cfg: 1.0 },
        },
        output_format: outputFormat(extension),
        output_compression: extension === '.webp' ? 88 : 95,
      }),
    })
    if (response.status !== 202) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Image generation request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      )
    }
    const submitted = (await response.json()) as Record<string, any>
    const nativeJobId = String(submitted.id || '')
    if (!nativeJobId) throw new Error('Image generation server did not return a job id.')
    const completed = await waitForJob(nativeJobId)
    const image = completed?.result?.images?.[0]?.b64_json
    if (!image) throw new Error('Image generation completed without image data.')
    await fs.writeFile(targetPath, Buffer.from(String(image), 'base64'))
    return {
      jobId,
      nativeJobId,
      saved: true,
      path: targetPath,
      relativePath,
      format: request.format,
      width: size.width,
      height: size.height,
      generationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      jobId,
      saved: false,
      path: targetPath,
      relativePath,
      format: request.format,
      width: size.width,
      height: size.height,
      generationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    activeGenerationCount = Math.max(0, activeGenerationCount - 1)
    if (activeGenerationCount === 0) scheduleIdleShutdown()
  }
}

export function configureImageGenerationRuntime(config: ImageGenerationRuntimeConfig) {
  runtimeConfig = { dataDir: path.resolve(config.dataDir) }
}

export async function getImageGenerationStatus(): Promise<RuntimeStatus> {
  const configured = Boolean(runtimeConfig)
  const enginePath = configured ? await resolveEnginePath() : ''
  const missingFiles = configured ? await missingModelFiles() : MODEL_FILES.map((file) => file.filename)
  const engineAvailable = configured && Boolean(enginePath) && (await executableExists(enginePath))
  return {
    configured,
    installed: configured && missingFiles.length === 0,
    engineAvailable,
    ready: configured && missingFiles.length === 0 && engineAvailable,
    running: await serverReady(),
    installing: Boolean(installPromise),
    installCompletedBytes,
    installTotalBytes: MODEL_TOTAL_BYTES,
    installPercent: MODEL_TOTAL_BYTES
      ? Math.min(100, Math.round((installCompletedBytes / MODEL_TOTAL_BYTES) * 1000) / 10)
      : 0,
    modelDir: configured ? modelDir() : '',
    enginePath,
    gpuIndex: DEFAULT_GPU_INDEX,
    pendingJobs: activeGenerationCount,
    missingFiles,
    error: serverError,
  }
}

export async function installImageGenerationModels() {
  if (!runtimeConfig) throw new Error('Image generation runtime is not configured.')
  if (installPromise) return installPromise
  installCompletedBytes = 0
  installPromise = (async () => {
    await fs.mkdir(modelDir(), { recursive: true })
    for (const file of MODEL_FILES) await downloadModelFile(file)
    return getImageGenerationStatus()
  })()
  try {
    return await installPromise
  } finally {
    installPromise = null
  }
}

export async function generateProjectImage(request: ImageGenerationRequest) {
  const prompt = String(request.prompt || '').trim()
  if (!prompt) throw new Error('Image prompt is required.')
  if (prompt.length > 4000) throw new Error('Image prompt is too long.')

  const workspaceRoot = path.resolve(String(request.workspaceRoot || ''))
  const requestedPath = String(request.outputPath || '').trim()
  if (!requestedPath) throw new Error('Image output path is required.')
  const requestedExtension = path.extname(requestedPath).toLowerCase()
  if (requestedExtension && !['.png', '.jpg', '.jpeg', '.webp'].includes(requestedExtension)) {
    throw new Error('Image output path must use .png, .jpg, .jpeg, or .webp.')
  }
  const extension = outputExtension(requestedPath)
  const normalizedPath = requestedExtension ? requestedPath : `${requestedPath}${extension}`
  const targetPath = await resolveWritablePathWithinRoot(normalizedPath, workspaceRoot)
  const relativePath = path.relative(workspaceRoot, targetPath).split(path.sep).join('/')
  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  const jobId = randomUUID()
  const queuedRequest = { ...request, prompt, workspaceRoot }
  const promise = runImageGenerationJob(jobId, queuedRequest, targetPath, relativePath, extension)
  imageJobs.set(jobId, { id: jobId, workspaceRoot, path: relativePath, promise })
  const size = generationSize(request.format)

  return {
    queued: true,
    saved: false,
    jobId,
    path: relativePath,
    relativePath,
    format: request.format,
    width: size.width,
    height: size.height,
  }
}

export async function waitForProjectImages(workspaceRoot: string): Promise<ImageGenerationWaitResult> {
  const root = path.resolve(String(workspaceRoot || ''))
  const completed: ImageGenerationJobResult[] = []
  const failed: ImageGenerationJobResult[] = []
  let waited = 0

  for (;;) {
    const jobs = [...imageJobs.values()].filter((job) => job.workspaceRoot === root)
    if (!jobs.length) break
    const results = await Promise.all(jobs.map((job) => job.promise))
    waited += jobs.length
    for (let index = 0; index < jobs.length; index += 1) {
      imageJobs.delete(jobs[index].id)
      const result = results[index]
      if (result.saved) completed.push(result)
      else failed.push(result)
    }
  }

  return { waited, completed, failed }
}

export async function stopImageGenerationServer() {
  clearIdleTimer()
  const child = serverProcess
  serverProcess = null
  serverPort = 0
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000).then(() => child.kill('SIGKILL')),
  ])
}

export async function closeImageGenerationRuntime() {
  await stopImageGenerationServer()
}
