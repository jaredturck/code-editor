/**
 * Verifies the in-memory WAV encoder emits the mono 16-bit PCM format accepted by Ollama.
 */

import { describe, expect, it } from 'vitest';
import { encodePcm16Wav, NOTE_AUDIO_SAMPLE_RATE } from '@/platform/audio/wavEncoder';

async function blobView(blob: Blob): Promise<DataView> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
  return new DataView(buffer);
}

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join('');
}

describe('encodePcm16Wav', () => {
  it('writes a valid 16 kHz mono PCM WAV header', async () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 0, 1]));
    const view = await blobView(wav);

    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(50);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(NOTE_AUDIO_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
  });

  it('clamps samples into signed 16-bit PCM', async () => {
    const view = await blobView(encodePcm16Wav(new Float32Array([-2, -1, 0, 1, 2, Number.NaN])));

    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(32767);
    expect(view.getInt16(54, true)).toBe(0);
  });
});
