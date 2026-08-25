import { describe, expect, it } from 'vitest'
import { encode_pcm16_wav } from '../src/lib/audio'

function readBlobBytes(blob: Blob) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read encoded WAV blob'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}

describe('WAV encoder', () => {
  it('writes a valid mono PCM WAV header', async () => {
    const blob = encode_pcm16_wav(new Float32Array([0, 0.5, -0.5]))
    const bytes = await readBlobBytes(blob)

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(bytes.length).toBe(50)
  })
})
