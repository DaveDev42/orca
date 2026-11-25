import {
  addExpoTwoWayAudioEventListener,
  requestMicrophonePermissionsAsync
} from '@orca/expo-two-way-audio'
import { bridgeAudioInterruptionEndsCapture } from '../../mobile-web-shell/bridge/native-capabilities/bridge-audio-verbs'
import { nativeMicrophoneScreenLock, nativeWarmAudioSession } from './native-audio-device'
import type { DictationCapture } from './dictation-capture-contract'

const screen = nativeMicrophoneScreenLock

// Never throw: unmount calls this bare and `end` must not reject, so wake-tag release and desktop cancel still run.
// The engine is muted and kept warm rather than torn down; it releases itself after a quiet minute or in the background.
function releaseMicrophone(): void {
  screen.release()
  nativeWarmAudioSession.end()
}

const nativeDictationCapture: DictationCapture = {
  open: async () => {
    const permission = await requestMicrophonePermissionsAsync()
    if (!permission.granted) {
      return { ok: false, reason: 'permission-denied' }
    }
    if (!(await nativeWarmAudioSession.open())) {
      return { ok: false, reason: 'unavailable' }
    }
    // Hold the screen from successful open; end/release free it, and failed opens acquire nothing.
    screen.hold()
    return { ok: true }
  },
  begin: () => nativeWarmAudioSession.begin(),
  prewarm: () => nativeWarmAudioSession.prewarm(),
  // Native events already delivered the tail. Mute and stay warm; other apps' audio resumes when the idle release runs.
  end: async () => releaseMicrophone(),
  release: releaseMicrophone,
  onChunk: (handler) =>
    addExpoTwoWayAudioEventListener('onMicrophoneData', (event) => {
      const raw = event.data
      handler({
        data: raw instanceof Uint8Array ? raw : new Uint8Array(raw),
        // Native events lose no bytes at this seam; pending-budget refusal accounts for downstream overload.
        droppedBytes: 0
      })
    }),
  onInterruption: (handler) =>
    addExpoTwoWayAudioEventListener('onAudioInterruption', (event) => {
      if (bridgeAudioInterruptionEndsCapture(event.data)) {
        handler()
      }
    })
}

export function useDictationCapture(): DictationCapture {
  return nativeDictationCapture
}
