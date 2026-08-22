import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Agent Chat audio integration boundary', () => {
  it('uses the migrated IRIS audio controller rather than the legacy Ollama speech IPC path', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/AIChatPanel.tsx'), 'utf8')
    const hook = readFileSync(
      resolve(process.cwd(), 'src/platform-features/audio/useAudioTranscription.ts'),
      'utf8',
    )

    expect(panel).toContain('useAudioTranscription')
    expect(panel).toContain('voice.requestStart()')
    expect(panel).not.toContain('chat.begin_recording()')
    expect(hook).toContain('transcribeAudio(')
    expect(hook).toContain("buildPersistentPermissionPatch('microphone')")
    expect(hook).toContain('audio_cloud_notice_ack')
  })
})
