/**
 * Converts browser-recorded audio into the 16 kHz mono PCM WAV format accepted by the Notes
 * Ollama transcription route. Conversion remains entirely in memory.
 */

export const NOTE_AUDIO_SAMPLE_RATE = 16_000

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** Encodes mono floating-point samples as a standard 16-bit PCM WAV blob. */
export function encodePcm16Wav(samples: Float32Array, sampleRate = NOTE_AUDIO_SAMPLE_RATE): Blob {
  const bytesPerSample = 2
  const dataLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (const value of samples) {
    const sample = clampSample(value)
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, Math.round(pcm), true)
    offset += bytesPerSample
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/** Decodes a MediaRecorder blob, resamples it to 16 kHz mono, and emits PCM WAV. */
export async function convertRecordingToWav(recording: Blob): Promise<Blob> {
  if (!recording.size) throw new Error('No audio was recorded.')

  const AudioContextCtor = window.AudioContext
  const OfflineAudioContextCtor = window.OfflineAudioContext
  if (!AudioContextCtor || !OfflineAudioContextCtor) {
    throw new Error('Audio conversion is not supported by this desktop runtime.')
  }

  const context = new AudioContextCtor()
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer())
    const frameCount = Math.max(1, Math.ceil(decoded.duration * NOTE_AUDIO_SAMPLE_RATE))
    const offline = new OfflineAudioContextCtor(1, frameCount, NOTE_AUDIO_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start(0)
    const rendered = await offline.startRendering()
    return encodePcm16Wav(rendered.getChannelData(0), NOTE_AUDIO_SAMPLE_RATE)
  } finally {
    await context.close().catch(() => undefined)
  }
}
