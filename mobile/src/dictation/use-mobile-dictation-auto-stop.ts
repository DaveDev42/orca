import { useEffect, useEffectEvent } from 'react'
import type { UseMobileDictationResult } from '../hooks/mobile-dictation-session-state'

// Tap-mode dictation ends by itself when the speaker goes quiet; a finger holding the mic is never cut off.
export function useMobileDictationAutoStop(
  dictation: Pick<UseMobileDictationResult, 'isRecording' | 'meter'>,
  dictationMode: string | undefined,
  enabled: boolean,
  onQuiet: () => void
): void {
  const { meter } = dictation
  const watching = dictation.isRecording && dictationMode !== 'hold' && enabled
  const quiet = useEffectEvent(onQuiet)
  useEffect(() => {
    if (!watching) {
      return
    }
    return meter.onSpeechEnd(() => quiet())
  }, [meter, watching])
}
