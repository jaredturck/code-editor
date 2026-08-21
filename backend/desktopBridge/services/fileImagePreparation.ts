/**
 * Prepares filesystem images for CLIP inference through one Sharp decode/resize pipeline.
 * Workers and future benchmarks share this implementation so measured work matches production.
 */

import sharp from 'sharp';
import type { PreparedClipImage } from './fileImageProcessingWorkerTypes.js';

const CLIP_IMAGE_SIZE = 224;
const MAX_INPUT_PIXELS = 268_402_689;

sharp.concurrency(1);
sharp.cache({ files: 0, items: 16, memory: 32 });

/** Reuses an exact Sharp buffer allocation, copying only pooled or sliced backing storage. */
export function createTransferableImageData(data: Buffer): Uint8Array {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return new Uint8Array(data.buffer);
  }
  const transferableData = new Uint8Array(data.byteLength);
  transferableData.set(data);
  return transferableData;
}

/** Decodes, orients, crops, and converts one file into a 224×224 RGB CLIP input. */
export async function prepareClipImage(filePath: string): Promise<PreparedClipImage> {
  const { data, info } = await sharp(filePath, {
    animated: false,
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    pages: 1,
    sequentialRead: true,
  })
    .rotate()
    .resize(CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.cubic,
    })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== CLIP_IMAGE_SIZE || info.height !== CLIP_IMAGE_SIZE || info.channels !== 3) {
    throw new Error('Image preprocessing returned an invalid CLIP input');
  }

  return {
    data: createTransferableImageData(data),
    width: info.width,
    height: info.height,
    channels: 3,
  };
}
