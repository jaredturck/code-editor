/** Verifies CLIP cache detection does not accept partial or truncated model downloads. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  availableClipCudaDevices,
  clipVisionLaneCount,
  createClipRawImages,
  createDirectClipVisionInputs,
  directClipPreprocessParameters,
  hasCompleteFileClipModelCache,
  normalizeClipEmbeddings,
} from '../../backend/desktopBridge/services/fileClipService'

const temporaryRoots: string[] = []
const originalCudaVisibleDevices = process.env.CUDA_VISIBLE_DEVICES

async function createModelFile(root: string, relativePath: string, size: number): Promise<void> {
  const filePath = path.join(root, 'Xenova', 'clip-vit-base-patch32', relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const handle = await fs.open(filePath, 'w')
  await handle.truncate(size)
  await handle.close()
}

afterEach(async () => {
  if (originalCudaVisibleDevices === undefined) delete process.env.CUDA_VISIBLE_DEVICES
  else process.env.CUDA_VISIBLE_DEVICES = originalCudaVisibleDevices
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('file CLIP model cache', () => {
  it('rejects a partial cache containing only tokenizer and one ONNX file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-clip-cache-'))
    temporaryRoots.push(root)
    await createModelFile(root, 'config.json', 1_000)
    await createModelFile(root, 'preprocessor_config.json', 1_000)
    await createModelFile(root, 'tokenizer.json', 2_000)
    await createModelFile(root, 'tokenizer_config.json', 1_000)
    await createModelFile(root, 'onnx/text_model_quantized.onnx', 2_000_000)

    await expect(hasCompleteFileClipModelCache(root)).resolves.toBe(false)
  })

  it('accepts the complete FP16 text and vision model cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-clip-cache-'))
    temporaryRoots.push(root)
    await createModelFile(root, 'config.json', 1_000)
    await createModelFile(root, 'preprocessor_config.json', 1_000)
    await createModelFile(root, 'tokenizer.json', 2_000)
    await createModelFile(root, 'tokenizer_config.json', 1_000)
    await createModelFile(root, 'onnx/text_model_fp16.onnx', 2_000_000)
    await createModelFile(root, 'onnx/vision_model_fp16.onnx', 2_000_000)

    await expect(hasCompleteFileClipModelCache(root)).resolves.toBe(true)
  })

  it('accepts the complete q8 text and vision model cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-clip-cache-'))
    temporaryRoots.push(root)
    await createModelFile(root, 'config.json', 1_000)
    await createModelFile(root, 'preprocessor_config.json', 1_000)
    await createModelFile(root, 'tokenizer.json', 2_000)
    await createModelFile(root, 'tokenizer_config.json', 1_000)
    await createModelFile(root, 'onnx/text_model_quantized.onnx', 2_000_000)
    await createModelFile(root, 'onnx/vision_model_quantized.onnx', 2_000_000)

    await expect(hasCompleteFileClipModelCache(root)).resolves.toBe(true)
  })
})

describe('file CLIP pipeline helpers', () => {
  it('normalizes each 512-dimensional embedding row', () => {
    const values = [3, 4, ...Array(510).fill(0)]
    const rows = normalizeClipEmbeddings({ tolist: () => [values] }, 1)

    expect(rows).toHaveLength(1)
    expect(rows[0][0]).toBeCloseTo(0.6)
    expect(rows[0][1]).toBeCloseTo(0.8)
    expect(rows[0].slice(2).every((value) => value === 0)).toBe(true)
  })

  it('creates RawImage values without copying prepared image metadata', () => {
    class RawImageStub {
      constructor(
        public data: Uint8Array,
        public width: number,
        public height: number,
        public channels: number,
      ) {}
    }
    const data = new Uint8Array([1, 2, 3])
    const images = createClipRawImages([{ data, width: 1, height: 1, channels: 3 }], RawImageStub)

    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ data, width: 1, height: 1, channels: 3 })
  })

  it('respects CUDA visibility without assuming the CI host has the native CUDA provider', async () => {
    process.env.CUDA_VISIBLE_DEVICES = '-1'
    await expect(availableClipCudaDevices()).resolves.toEqual([])

    process.env.CUDA_VISIBLE_DEVICES = '3,1'
    const visible = await availableClipCudaDevices()
    expect(visible).toEqual(visible.length ? [0, 1] : [])
  })

  it('uses additional CLIP lanes only for batches large enough to benefit', () => {
    expect(clipVisionLaneCount(32, 2)).toBe(1)
    expect(clipVisionLaneCount(64, 2)).toBe(1)
    expect(clipVisionLaneCount(128, 2)).toBe(2)
    expect(clipVisionLaneCount(512, 2)).toBe(2)
    expect(clipVisionLaneCount(512, 1)).toBe(1)
  })

  it('builds the normalized NCHW tensor directly from prepared RGB bytes', () => {
    class TensorStub {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    }
    const parameters = directClipPreprocessParameters({
      image_processor: {
        do_rescale: true,
        rescale_factor: 1 / 255,
        do_normalize: true,
        image_mean: [0.5, 0.25, 0.75],
        image_std: [0.5, 0.25, 0.25],
      },
    })
    expect(parameters).not.toBeNull()

    const inputs = createDirectClipVisionInputs(
      [
        {
          data: new Uint8Array([255, 128, 0]),
          width: 1,
          height: 1,
          channels: 3,
        },
      ],
      TensorStub,
      parameters!,
    )

    expect(inputs.pixel_values.dims).toEqual([1, 3, 1, 1])
    expect([...inputs.pixel_values.data]).toEqual([1, expect.closeTo(1.007843, 5), -3])
  })
})
