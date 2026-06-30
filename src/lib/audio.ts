export const audio_sample_rate = 16000

function clamp_sample(value: number) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
}

export function encode_pcm16_wav(samples: Float32Array, sample_rate = audio_sample_rate) {
  const bytes_per_sample = 2
  const data_length = samples.length * bytes_per_sample
  const buffer = new ArrayBuffer(44 + data_length)
  const view = new DataView(buffer)

  const write_ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  write_ascii(0, 'RIFF')
  view.setUint32(4, 36 + data_length, true)
  write_ascii(8, 'WAVE')
  write_ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sample_rate, true)
  view.setUint32(28, sample_rate * bytes_per_sample, true)
  view.setUint16(32, bytes_per_sample, true)
  view.setUint16(34, 16, true)
  write_ascii(36, 'data')
  view.setUint32(40, data_length, true)

  let offset = 44

  for (const value of samples) {
    const sample = clamp_sample(value)
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, Math.round(pcm), true)
    offset += bytes_per_sample
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export async function convert_recording_to_wav(recording: Blob) {
  if (!recording.size) {
    throw new Error('No audio was recorded.')
  }

  const context = new AudioContext()

  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer())
    const frame_count = Math.max(1, Math.ceil(decoded.duration * audio_sample_rate))
    const offline = new OfflineAudioContext(1, frame_count, audio_sample_rate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start(0)
    const rendered = await offline.startRendering()
    return encode_pcm16_wav(rendered.getChannelData(0), audio_sample_rate)
  } finally {
    await context.close().catch(() => undefined)
  }
}
