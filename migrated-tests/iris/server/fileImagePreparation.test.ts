/** Verifies that prepared image buffers are transferred without unnecessary full-buffer copies. */

import { describe, expect, it } from 'vitest';

import { createTransferableImageData } from '../../server/desktopBridge/services/fileImagePreparation';

describe('file image preparation', () => {
  it('reuses a buffer that owns its complete ArrayBuffer', () => {
    const source = Buffer.allocUnsafeSlow(16);
    source.fill(7);

    const transferred = createTransferableImageData(source);

    expect(transferred.buffer).toBe(source.buffer);
    expect([...transferred]).toEqual([...source]);
  });

  it('copies a sliced buffer so unrelated pooled bytes are not transferred', () => {
    const source = Buffer.allocUnsafeSlow(32);
    source.fill(3);
    const slice = source.subarray(8, 24);

    const transferred = createTransferableImageData(slice);

    expect(transferred.buffer).not.toBe(slice.buffer);
    expect(transferred.byteLength).toBe(slice.byteLength);
    expect([...transferred]).toEqual([...slice]);
  });
});
