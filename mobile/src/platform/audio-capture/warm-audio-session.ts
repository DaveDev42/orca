// Keeps the phone's audio engine alive between dictations. Tearing it down after every dictation dropped a
// Bluetooth car out of call mode (HFP) each time and renegotiated it on the next tap, which is the long first-use
// delay in a car. The engine stays up with its input muted, and is released after a quiet minute, when the app
// leaves the foreground, or on an explicit release.

export const WARM_AUDIO_IDLE_MS = 60_000

export type WarmAudioSessionDeps = {
  readonly initialize: () => Promise<boolean>
  readonly toggleRecording: (recording: boolean) => boolean
  readonly tearDown: () => void
  // True only when microphone access was already granted; a prewarm must never raise the permission prompt.
  readonly hasMicrophonePermission: () => Promise<boolean>
  // Calls the handler when the app stops being the foreground app; returns the unsubscribe.
  readonly onBackground: (handler: () => void) => () => void
  readonly setTimer: (run: () => void, ms: number) => unknown
  readonly clearTimer: (timer: unknown) => void
  readonly idleMs?: number
}

export type WarmAudioSession = {
  /** Brings the engine up (or reuses the warm one). False when the device refused. */
  readonly open: () => Promise<boolean>
  readonly begin: () => boolean
  /** Mutes the microphone and keeps the engine warm until the idle window passes. */
  readonly end: () => void
  /** Warms the engine ahead of a tap when permission is already granted; true when it is warm. */
  readonly prewarm: () => Promise<boolean>
  /** Releases the engine now. */
  readonly release: () => void
}

export function createWarmAudioSession(deps: WarmAudioSessionDeps): WarmAudioSession {
  const idleMs = deps.idleMs ?? WARM_AUDIO_IDLE_MS
  let idleTimer: unknown = null
  let recording = false
  let warm = false
  let stopWatchingBackground: (() => void) | null = null

  function cancelIdle(): void {
    if (idleTimer !== null) {
      deps.clearTimer(idleTimer)
      idleTimer = null
    }
  }

  function release(): void {
    cancelIdle()
    stopWatchingBackground?.()
    stopWatchingBackground = null
    recording = false
    if (!warm) {
      return
    }
    warm = false
    try {
      deps.toggleRecording(false)
      deps.tearDown()
    } catch (error) {
      console.error('Failed to tear down the audio session', error)
    }
  }

  function scheduleIdleRelease(): void {
    cancelIdle()
    idleTimer = deps.setTimer(release, idleMs)
  }

  async function ensureWarm(): Promise<boolean> {
    cancelIdle()
    if (!(await deps.initialize())) {
      return false
    }
    warm = true
    // A backgrounded app cannot keep the microphone, and holding a warm engine would pin the car in call mode.
    stopWatchingBackground ??= deps.onBackground(() => {
      if (!recording) {
        release()
      }
    })
    return true
  }

  return {
    open: ensureWarm,
    begin: () => {
      cancelIdle()
      recording = deps.toggleRecording(true)
      return recording
    },
    end: () => {
      recording = false
      if (!warm) {
        return
      }
      try {
        deps.toggleRecording(false)
      } catch (error) {
        console.error('Failed to mute the microphone', error)
      }
      scheduleIdleRelease()
    },
    prewarm: async () => {
      if (recording) {
        return true
      }
      if (!(await deps.hasMicrophonePermission())) {
        return false
      }
      const opened = await ensureWarm()
      if (opened && !recording) {
        scheduleIdleRelease()
      }
      return opened
    },
    release
  }
}
