import { useAudioTranscription } from '@/platform-features/audio/useAudioTranscription'

interface UseNoteTranscriptionOptions {
  activeNoteId: number | null
  onTranscript: (noteId: number, text: string) => void
}

export function useNoteTranscription(options: UseNoteTranscriptionOptions) {
  return useAudioTranscription({
    activeTarget: options.activeNoteId,
    onTranscript: options.onTranscript,
  })
}
