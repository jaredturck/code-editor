import { describe, expect, it } from 'vitest'
import { encode_pcm16_wav } from '../src/lib/audio'

describe('WAV encoder', () => {
  it('writes a valid mono PCM WAV header', async () => {
    const blob = encode_pcm16_wav(new Float32Array([0, 0.5, -0.5]))
    const bytes = new Uint8Array(await blob.arrayBuffer())

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(bytes.length).toBe(50)
  })
})
