import { useEffect } from 'react'
import type { DictationCapture } from '../platform/audio-capture/dictation-capture-contract'
import type { OnDeviceSpeech } from '../platform/speech/on-device-speech-contract'
import { chooseMobileDictationRoute } from './mobile-dictation-device-engine'
import { registerMobileDictationPrewarm } from '../dictation/mobile-dictation-prewarm'

// What a focused composer warms: only the recognizer status that the next start would otherwise wait on. It never
// touches the audio session or the microphone: an active session pins a Bluetooth car in call mode and stops the
// music, so audio comes up when a dictation starts. Losing focus hands the session back unless it is recording.
export function useMobileDictationPrewarm(
  capture: DictationCapture,
  speech: OnDeviceSpeech | null,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    return registerMobileDictationPrewarm({
      prewarm: () => {
        void chooseMobileDictationRoute(speech)
      },
      releaseAudio: () => capture.releaseIfIdle?.()
    })
  }, [capture, speech, enabled])
}
