import {
  addExpoTwoWayAudioEventListener,
  getMicrophonePermissionsAsync,
  initialize,
  requestMicrophonePermissionsAsync,
  speechFeed,
  tearDown,
  toggleRecording
} from '@orca/expo-two-way-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { AppState } from 'react-native'
import { BRIDGE_AUDIO_INTERRUPTIONS } from '../../mobile-web-shell/bridge/native-capabilities/bridge-audio-verbs'
import { createMicrophoneScreenLock } from './microphone-screen-lock'
import type { NativeAudioEngine } from './native-audio'
import { createWarmAudioSession } from './warm-audio-session'

// Isolate device imports so tests can inject engines without loading a device-only JSI binding.

// initialize() accepts no rate: both engines produce fixed 16 kHz, so report the actual rate instead of silently accepting another.
export const NATIVE_AUDIO_DEVICE_SAMPLE_RATE = 16_000

const MICROPHONE_SCREEN_LOCK_TAG = 'orca-microphone'

// Share one wake lock for the one microphone; native and bridge capture must not use independently releasable tags.
export const nativeMicrophoneScreenLock = createMicrophoneScreenLock(
  { activate: activateKeepAwakeAsync, deactivate: deactivateKeepAwake },
  MICROPHONE_SCREEN_LOCK_TAG
)

// One warm engine for the page bridge and the native dictation host, so a prewarm from either serves both.
export const nativeWarmAudioSession = createWarmAudioSession({
  initialize,
  toggleRecording,
  tearDown,
  hasMicrophonePermission: async () => (await getMicrophonePermissionsAsync()).granted,
  onBackground: (handler) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        handler()
      }
    })
    return () => subscription.remove()
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
})

function readInterruption(data: string): (typeof BRIDGE_AUDIO_INTERRUPTIONS)[number] | null {
  return BRIDGE_AUDIO_INTERRUPTIONS.find((kind) => kind === data) ?? null
}

export const nativeAudioDeviceEngine: NativeAudioEngine = {
  requestPermission: async () => {
    const permission = await requestMicrophonePermissionsAsync()
    // Permission refusal has the same page outcome whether or not the OS allows another prompt.
    return permission.granted ? 'granted' : permission.canAskAgain ? 'undetermined' : 'denied'
  },
  open: async (sampleRate) => ({
    opened: sampleRate === NATIVE_AUDIO_DEVICE_SAMPLE_RATE && (await nativeWarmAudioSession.open()),
    sampleRate: NATIVE_AUDIO_DEVICE_SAMPLE_RATE
  }),
  begin: () => nativeWarmAudioSession.begin(),
  // Mute and keep the engine warm: dropping it dropped a Bluetooth car out of call mode on every dictation.
  end: () => nativeWarmAudioSession.end(),
  screenLock: nativeMicrophoneScreenLock,
  onMicrophoneData: (handler) =>
    addExpoTwoWayAudioEventListener('onMicrophoneData', (event) => {
      const raw = event.data
      handler(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
    }),
  feedSpeech: (bytes) => speechFeed(bytes),
  onInterruption: (handler) =>
    addExpoTwoWayAudioEventListener('onAudioInterruption', (event) => {
      // Ignore unknown engine interruption kinds instead of forwarding a value the page cannot describe.
      const kind = readInterruption(event.data)
      if (kind !== null) {
        handler(kind)
      }
    })
}
