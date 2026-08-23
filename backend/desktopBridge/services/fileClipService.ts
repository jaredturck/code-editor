/**
 * Runs local CLIP text and image embeddings through Transformers.js/ONNX.
 * The model is downloaded once into IRIS's private model cache and then reused.
 */

import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { PreparedClipImage } from './fileImageProcessingWorkerTypes.js'

export const FILE_CLIP_MODEL = 'Xenova/clip-vit-base-patch32'
export const FILE_CLIP_DIMENSIONS = 512
export const FILE_CLIP_DEFAULT_BATCH_SIZE = 512
const MAX_CLIP_CUDA_LANES = 2
const MIN_IMAGES_PER_CLIP_LANE = 64

const FILE_CLIP_CACHE_DIR = path.join(os.homedir(), '.iris-ai', 'models', 'clip-vit-base-patch32')
const FILE_CLIP_MODEL_CACHE_DIR = path.join(FILE_CLIP_CACHE_DIR, ...FILE_CLIP_MODEL.split('/'))
const FILE_CLIP_BASE_FILES = [
  { relativePath: 'config.json', minimumBytes: 100 },
  { relativePath: 'preprocessor_config.json', minimumBytes: 100 },
  { relativePath: 'tokenizer.json', minimumBytes: 1_000 },
  { relativePath: 'tokenizer_config.json', minimumBytes: 100 },
] as const
const FILE_CLIP_MODEL_VARIANTS = [
  [
    { relativePath: 'onnx/text_model_fp16.onnx', minimumBytes: 1_000_000 },
    { relativePath: 'onnx/vision_model_fp16.onnx', minimumBytes: 1_000_000 },
  ],
  [
    { relativePath: 'onnx/text_model_quantized.onnx', minimumBytes: 1_000_000 },
    {
      relativePath: 'onnx/vision_model_quantized.onnx',
      minimumBytes: 1_000_000,
    },
  ],
] as const

export interface ClipVisionLane {
  model: any
  deviceIndex: number | null
}

export interface ClipRuntime {
  tokenizer: any
  processor: any
  textModel: any
  visionModel: any
  visionLanes: ClipVisionLane[]
  RawImage: any
  Tensor: any
  backend: 'onnxruntime-node'
  device: 'cuda' | 'cpu'
  dtype: 'fp16' | 'q8'
  fallbackError?: string
  laneErrors?: string[]
}

let runtimePromise: Promise<ClipRuntime> | null = null
let runtimeReady = false

/** Returns a stable message for CLIP setup and inference failures. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error')
}

/** Identifies failures caused by missing native or JavaScript CLIP dependencies. */
function isClipDependencyFailure(error: unknown): boolean {
  return /cannot find (package|module)|module_not_found|onnxruntime|sharp/i.test(errorMessage(error))
}

/** Converts model setup failures into the user-facing installation error. */
function clipInstallError(error: unknown): Error {
  const detail = errorMessage(error)
  const guidance = isClipDependencyFailure(error)
    ? ' Run npm ci, rebuild IRIS, and retry the scan.'
    : ' Check the network connection and retry the scan.'
  return new Error(`IRIS could not prepare the CLIP image model (${detail}).${guidance}`)
}

/** Converts a CLIP output tensor into validated unit-length embedding rows. */
export function normalizeClipEmbeddings(value: any, expectedRows: number): number[][] {
  const rows = typeof value?.tolist === 'function' ? value.tolist() : []
  if (!Array.isArray(rows) || rows.length !== expectedRows) {
    throw new Error('CLIP returned an invalid embedding batch')
  }
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== FILE_CLIP_DIMENSIONS) {
      throw new Error('CLIP returned an invalid embedding vector')
    }
    let lengthSquared = 0
    const values = row.map((item) => Number(item))
    for (const item of values) lengthSquared += item * item
    const length = Math.sqrt(lengthSquared)
    if (!length) return values.map(() => 0)
    return values.map((item) => item / length)
  })
}

/** Builds model options for one CUDA device while retaining the normal CPU path. */
function clipModelOptions(device: 'cuda' | 'cpu', dtype: 'fp16' | 'q8', deviceIndex = 0): Record<string, unknown> {
  return {
    dtype,
    device,
    ...(device === 'cuda'
      ? {
          session_options: {
            executionProviders: [{ name: 'cuda', deviceId: deviceIndex }],
          },
        }
      : {}),
  }
}

/** Loads one CLIP text/vision model pair for the requested execution backend. */
export async function loadClipModels(
  transformers: any,
  device: 'cuda' | 'cpu',
  dtype: 'fp16' | 'q8',
  deviceIndex = 0,
): Promise<{ textModel: any; visionModel: any }> {
  const options = clipModelOptions(device, dtype, deviceIndex)
  const [textModel, visionModel] = await Promise.all([
    transformers.CLIPTextModelWithProjection.from_pretrained(FILE_CLIP_MODEL, options),
    transformers.CLIPVisionModelWithProjection.from_pretrained(FILE_CLIP_MODEL, options),
  ])
  return { textModel, visionModel }
}

/** Loads an additional vision-only CLIP session on one CUDA device. */
async function loadClipVisionModel(transformers: any, dtype: 'fp16', deviceIndex: number): Promise<any> {
  return transformers.CLIPVisionModelWithProjection.from_pretrained(
    FILE_CLIP_MODEL,
    clipModelOptions('cuda', dtype, deviceIndex),
  )
}

/** Lists CUDA device indices visible to ONNX Runtime without requiring a native dependency. */
export async function availableClipCudaDevices(): Promise<number[]> {
  const visibleDevices = String(process.env.CUDA_VISIBLE_DEVICES || '').trim()
  if (visibleDevices === '-1') return []
  if (visibleDevices) {
    const count = visibleDevices
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean).length
    return Array.from({ length: Math.min(MAX_CLIP_CUDA_LANES, count) }, (_, index) => index)
  }
  if (process.platform !== 'linux') return [0]
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=index', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          resolve([0])
          return
        }
        const indices = String(stdout || '')
          .split(/\r?\n/)
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value >= 0)
          .slice(0, MAX_CLIP_CUDA_LANES)
        resolve(indices.length ? indices : [0])
      },
    )
  })
}

/** Creates the shared CLIP runtime, preferring CUDA FP16 before the CPU Q8 fallback. */
export async function loadClipRuntime(): Promise<ClipRuntime> {
  await fs.mkdir(FILE_CLIP_CACHE_DIR, { recursive: true })
  const transformers = await import('@huggingface/transformers')
  transformers.env.cacheDir = FILE_CLIP_CACHE_DIR
  transformers.env.allowRemoteModels = true

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(FILE_CLIP_MODEL)
  const processor = await transformers.AutoProcessor.from_pretrained(FILE_CLIP_MODEL)

  let models
  let device: 'cuda' | 'cpu' = 'cuda'
  let dtype: 'fp16' | 'q8' = 'fp16'
  let fallbackError: string | undefined
  let laneErrors: string[] | undefined
  let visionLanes: ClipVisionLane[] = []
  const cudaDevices = await availableClipCudaDevices()
  let primaryDevice: number | null = null
  for (const deviceIndex of cudaDevices) {
    try {
      models = await loadClipModels(transformers, device, dtype, deviceIndex)
      primaryDevice = deviceIndex
      break
    } catch (error) {
      laneErrors ||= []
      laneErrors.push(`CUDA device ${deviceIndex}: ${errorMessage(error)}`)
    }
  }

  if (models && primaryDevice !== null) {
    visionLanes = [{ model: models.visionModel, deviceIndex: primaryDevice }]
    for (const deviceIndex of cudaDevices) {
      if (deviceIndex === primaryDevice) continue
      try {
        const model = await loadClipVisionModel(transformers, dtype, deviceIndex)
        visionLanes.push({ model, deviceIndex })
      } catch (error) {
        laneErrors ||= []
        laneErrors.push(`CUDA device ${deviceIndex}: ${errorMessage(error)}`)
      }
    }
  } else {
    fallbackError = laneErrors?.join('; ') || 'No CUDA device could load the CLIP runtime'
    device = 'cpu'
    dtype = 'q8'
    models = await loadClipModels(transformers, device, dtype)
    visionLanes = [{ model: models.visionModel, deviceIndex: null }]
  }

  return {
    tokenizer,
    processor,
    textModel: models.textModel,
    visionModel: models.visionModel,
    visionLanes,
    RawImage: transformers.RawImage,
    Tensor: (transformers as any).Tensor,
    backend: 'onnxruntime-node',
    device,
    dtype,
    fallbackError,
    laneErrors,
  }
}

/** Returns the retained CLIP runtime and resets failed initialization for a later retry. */
export async function getClipRuntime(): Promise<ClipRuntime> {
  runtimePromise ||= loadClipRuntime()
  try {
    const runtime = await runtimePromise
    runtimeReady = true
    return runtime
  } catch (error) {
    runtimePromise = null
    runtimeReady = false
    throw error
  }
}

/** Checks whether a model-cache directory contains any downloaded files. */
async function directoryHasAnyFiles(directory: string): Promise<boolean> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isFile()) return true
    if (entry.isDirectory() && (await directoryHasAnyFiles(path.join(directory, entry.name)))) {
      return true
    }
  }
  return false
}

/** Checks the minimum expected files for one complete cached model variant. */
async function requiredFilesPresent(
  modelDirectory: string,
  requiredFiles: readonly { relativePath: string; minimumBytes: number }[],
): Promise<boolean> {
  for (const required of requiredFiles) {
    try {
      const stats = await fs.stat(path.join(modelDirectory, required.relativePath))
      if (!stats.isFile() || stats.size < required.minimumBytes) return false
    } catch {
      return false
    }
  }
  return true
}

/** Returns true when the common files and either the FP16 or Q8 model pair are present. */
export async function hasCompleteFileClipModelCache(cacheDirectory = FILE_CLIP_CACHE_DIR): Promise<boolean> {
  const modelDirectory = path.join(cacheDirectory, ...FILE_CLIP_MODEL.split('/'))
  if (!(await requiredFilesPresent(modelDirectory, FILE_CLIP_BASE_FILES))) {
    return false
  }
  for (const variant of FILE_CLIP_MODEL_VARIANTS) {
    if (await requiredFilesPresent(modelDirectory, variant)) return true
  }
  return false
}

/** Removes only the CLIP model cache after a populated cache fails to load. */
async function removeFileClipModelCache(): Promise<void> {
  runtimePromise = null
  runtimeReady = false
  await fs.rm(FILE_CLIP_MODEL_CACHE_DIR, { recursive: true, force: true })
}

/** Returns the persistent CLIP cache directory used by production and benchmarks. */
export function fileClipCacheDirectory(): string {
  return FILE_CLIP_CACHE_DIR
}

export async function isFileClipModelInstalled(): Promise<boolean> {
  if (runtimeReady) return true
  return hasCompleteFileClipModelCache()
}

export async function installFileClipModel(): Promise<void> {
  try {
    await getClipRuntime()
    return
  } catch (firstError) {
    if (isClipDependencyFailure(firstError)) {
      throw clipInstallError(firstError)
    }
    const cacheContainsFiles = await directoryHasAnyFiles(FILE_CLIP_MODEL_CACHE_DIR)
    if (!cacheContainsFiles) throw clipInstallError(firstError)

    await removeFileClipModelCache()
    try {
      await getClipRuntime()
      return
    } catch (retryError) {
      throw clipInstallError(retryError)
    }
  }
}

/** Wraps native-worker RGB buffers in the RawImage objects expected by the CLIP processor. */
export function createClipRawImages(preparedImages: PreparedClipImage[], RawImage: ClipRuntime['RawImage']): any[] {
  return preparedImages.map((image) => new RawImage(image.data, image.width, image.height, image.channels))
}

/** Runs the shared image processor that converts RawImage values into CLIP input tensors. */
export async function prepareClipVisionInputs(images: any[], processor: any): Promise<any> {
  return processor(images)
}

/** Runs the CLIP vision projection model against one prepared tensor batch. */
export async function runClipVisionModel(inputs: any, visionModel: any): Promise<any> {
  return visionModel(inputs)
}

/** Reads filesystem image paths through the runtime compatibility RawImage loader. */
export async function readClipImages(
  imagePaths: string[],
  RawImage: ClipRuntime['RawImage'],
  signal?: AbortSignal,
): Promise<any[]> {
  return Promise.all(
    imagePaths.map(async (imagePath) => {
      if (signal?.aborted) throw new Error('Image indexing was cancelled')
      return RawImage.read(imagePath)
    }),
  )
}

/** Embeds one already-created RawImage batch through the shared processor and vision model. */
export async function embedClipRawImages(
  images: any[],
  runtime: ClipRuntime,
  signal?: AbortSignal,
): Promise<number[][]> {
  const inputs = await prepareClipVisionInputs(images, runtime.processor)
  if (signal?.aborted) throw new Error('Image indexing was cancelled')
  const { image_embeds } = await runClipVisionModel(inputs, runtime.visionModel)
  return normalizeClipEmbeddings(image_embeds, images.length)
}

export interface DirectClipPreprocessParameters {
  rescaleFactor: number
  imageMean: [number, number, number]
  imageStd: [number, number, number]
}

/** Reads the CLIP processor normalization constants required by the direct RGB tensor path. */
export function directClipPreprocessParameters(processor: any): DirectClipPreprocessParameters | null {
  const imageProcessor = processor?.image_processor ?? processor?.feature_extractor ?? processor
  if (!imageProcessor || imageProcessor.do_rescale === false || imageProcessor.do_normalize === false) {
    return null
  }
  if (imageProcessor.do_pad || imageProcessor.do_flip_channel_order || imageProcessor.do_convert_grayscale) {
    return null
  }

  const rescaleFactor = Number(imageProcessor.rescale_factor ?? 1 / 255)
  const rawMean = Array.isArray(imageProcessor.image_mean)
    ? imageProcessor.image_mean
    : Array(3).fill(imageProcessor.image_mean)
  const rawStd = Array.isArray(imageProcessor.image_std)
    ? imageProcessor.image_std
    : Array(3).fill(imageProcessor.image_std)
  if (
    !Number.isFinite(rescaleFactor) ||
    rawMean.length !== 3 ||
    rawStd.length !== 3 ||
    rawMean.some((value: unknown) => !Number.isFinite(Number(value))) ||
    rawStd.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) === 0)
  ) {
    return null
  }

  return {
    rescaleFactor,
    imageMean: rawMean.map(Number) as [number, number, number],
    imageStd: rawStd.map(Number) as [number, number, number],
  }
}

/** Converts already-sized RGB bytes directly into the NCHW float tensor consumed by CLIP. */
export function createDirectClipVisionInputs(
  preparedImages: PreparedClipImage[],
  Tensor: ClipRuntime['Tensor'],
  parameters: DirectClipPreprocessParameters,
): { pixel_values: any } {
  if (!preparedImages.length) {
    throw new Error('CLIP direct tensor preparation requires at least one image')
  }
  const width = preparedImages[0].width
  const height = preparedImages[0].height
  const pixelsPerImage = width * height
  const valuesPerImage = pixelsPerImage * 3
  const output = new Float32Array(preparedImages.length * valuesPerImage)
  const redOffset = -parameters.imageMean[0] / parameters.imageStd[0]
  const greenOffset = -parameters.imageMean[1] / parameters.imageStd[1]
  const blueOffset = -parameters.imageMean[2] / parameters.imageStd[2]
  const redScale = parameters.rescaleFactor / parameters.imageStd[0]
  const greenScale = parameters.rescaleFactor / parameters.imageStd[1]
  const blueScale = parameters.rescaleFactor / parameters.imageStd[2]

  for (let imageIndex = 0; imageIndex < preparedImages.length; imageIndex += 1) {
    const image = preparedImages[imageIndex]
    if (
      image.width !== width ||
      image.height !== height ||
      image.channels !== 3 ||
      image.data.length !== valuesPerImage
    ) {
      throw new Error('CLIP direct tensor preparation received inconsistent RGB image data')
    }
    const outputBase = imageIndex * valuesPerImage
    const redBase = outputBase
    const greenBase = outputBase + pixelsPerImage
    const blueBase = outputBase + pixelsPerImage * 2
    for (let pixel = 0, source = 0; pixel < pixelsPerImage; pixel += 1, source += 3) {
      output[redBase + pixel] = image.data[source] * redScale + redOffset
      output[greenBase + pixel] = image.data[source + 1] * greenScale + greenOffset
      output[blueBase + pixel] = image.data[source + 2] * blueScale + blueOffset
    }
  }

  return {
    pixel_values: new Tensor('float32', output, [preparedImages.length, 3, height, width]),
  }
}

/** Prepares worker-produced RGB images without repeating generic resize and crop operations. */
export async function prepareClipPreparedVisionInputs(
  preparedImages: PreparedClipImage[],
  runtime: ClipRuntime,
): Promise<any> {
  const parameters = directClipPreprocessParameters(runtime.processor)
  if (parameters) {
    return createDirectClipVisionInputs(preparedImages, runtime.Tensor, parameters)
  }
  const images = createClipRawImages(preparedImages, runtime.RawImage)
  return prepareClipVisionInputs(images, runtime.processor)
}

/** Embeds one prepared-image chunk on a dedicated CLIP vision session. */
async function embedClipPreparedChunk(
  preparedImages: PreparedClipImage[],
  runtime: ClipRuntime,
  lane: ClipVisionLane,
  signal?: AbortSignal,
): Promise<number[][]> {
  if (signal?.aborted) throw new Error('Image indexing was cancelled')
  const parameters = directClipPreprocessParameters(runtime.processor)
  const inputs = parameters
    ? createDirectClipVisionInputs(preparedImages, runtime.Tensor, parameters)
    : await prepareClipPreparedVisionInputs(preparedImages, runtime)
  if (signal?.aborted) throw new Error('Image indexing was cancelled')
  const { image_embeds } = await runClipVisionModel(inputs, lane.model)
  return normalizeClipEmbeddings(image_embeds, preparedImages.length)
}

/** Selects a useful CLIP lane count without splitting tiny batches across model sessions. */
export function clipVisionLaneCount(imageCount: number, availableLaneCount: number): number {
  return Math.max(1, Math.min(availableLaneCount, Math.floor(imageCount / MIN_IMAGES_PER_CLIP_LANE)))
}

/** Embeds prepared RGB images across the available CUDA vision sessions in stable input order. */
export async function embedClipPreparedImages(
  preparedImages: PreparedClipImage[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (!preparedImages.length) return []
  if (signal?.aborted) throw new Error('Image indexing was cancelled')
  const runtime = await getClipRuntime()
  const laneCount = clipVisionLaneCount(preparedImages.length, runtime.visionLanes.length)
  if (laneCount === 1) {
    return embedClipPreparedChunk(preparedImages, runtime, runtime.visionLanes[0], signal)
  }

  const chunkSize = Math.ceil(preparedImages.length / laneCount)
  const chunks = Array.from({ length: laneCount }, (_, laneIndex) => ({
    images: preparedImages.slice(laneIndex * chunkSize, (laneIndex + 1) * chunkSize),
    lane: runtime.visionLanes[laneIndex],
  })).filter((chunk) => chunk.images.length)
  const embedded = await Promise.all(
    chunks.map((chunk) => embedClipPreparedChunk(chunk.images, runtime, chunk.lane, signal)),
  )
  return embedded.flat()
}

/** Compatibility path for callers that still supply filesystem paths. */
export async function embedClipImages(imagePaths: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!imagePaths.length) return []
  if (signal?.aborted) throw new Error('Image indexing was cancelled')
  const runtime = await getClipRuntime()
  const images = await readClipImages(imagePaths, runtime.RawImage, signal)
  return embedClipRawImages(images, runtime, signal)
}

/** Embeds one text query through the CLIP text projection used for image and video search. */
export async function embedClipText(text: string, signal?: AbortSignal): Promise<number[]> {
  if (signal?.aborted) throw new Error('Image search was cancelled')
  const runtime = await getClipRuntime()
  const inputs = runtime.tokenizer([text], {
    padding: true,
    truncation: true,
  })
  const { text_embeds } = await runtime.textModel(inputs)
  return normalizeClipEmbeddings(text_embeds, 1)[0]
}

/** Clears the retained CLIP runtime so the next request reloads the model. */
export function clearFileClipRuntime(): void {
  runtimePromise = null
  runtimeReady = false
}
