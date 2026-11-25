import { useEffect } from 'react'
import type { DictationCapture } from '../platform/audio-capture/dictation-capture-contract'
import type { OnDeviceSpeech } from '../platform/speech/on-device-speech-contract'
import { chooseMobileDictationRoute } from './mobile-dictation-device-engine'
import { registerMobileDictationPrewarm } from '../dictation/mobile-dictation-prewarm'

// What a focused composer warms: the microphone engine (where the capture seam can) and the recognizer status
// that the next start would otherwise wait on before it opens the microphone.
export function useMobileDictationPrewarm(
  capture: DictationCapture,
  speech: OnDeviceSpeech | null,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    return registerMobileDictationPrewarm(() => {
      void capture.prewarm?.().catch(() => undefined)
      void chooseMobileDictationRoute(speech)
    })
  }, [capture, speech, enabled])
}
