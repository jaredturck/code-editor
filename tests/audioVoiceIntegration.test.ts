import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Agent Chat audio integration boundary', () => {
  it('uses the migrated IRIS audio controller rather than the legacy Ollama speech IPC path', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/AIChatPanel.tsx'), 'utf8')
    const controls = readFileSync(resolve(process.cwd(), 'src/components/AgentChatVoiceControls.tsx'), 'utf8')
    const hook = readFileSync(resolve(process.cwd(), 'src/platform-features/audio/useAudioTranscription.ts'), 'utf8')
    const settings = readFileSync(resolve(process.cwd(), 'src/platform-context/orb/SettingsContext.tsx'), 'utf8')

    expect(panel).toContain('AgentChatVoiceControls')
    expect(panel).not.toContain('chat.begin_recording()')
    expect(controls).toContain('useAudioTranscription')
    expect(controls).toContain('voice.requestStart()')
    expect(controls).toContain('AUDIO_PROVIDER_DEFINITIONS')
    expect(controls).toContain('audio_local_fallback')
    expect(hook).toContain('transcribeAudio(')
    expect(hook).toContain('audio_cloud_notice_ack')
    expect(settings).toContain('useStandaloneOrbSettings')
    expect(settings).toContain('buildPersistentPermissionPatch(permissionKeys)')
    expect(settings).toContain('updateBridgePermissions(buildBridgePermissionState(next))')
  })
})
