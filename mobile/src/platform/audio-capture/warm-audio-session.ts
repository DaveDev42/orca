// Keeps the phone's audio engine alive for a short grace period after a dictation so back-to-back dictations do
// not renegotiate Bluetooth call mode (HFP) in a car. Nothing here runs ahead of a dictation: focusing the composer
// or raising the keyboard must never touch the audio session, because an active session pins the car in a phone
// call and stops the music. After the grace period (or on blur/background) the engine and session are released,
// which hands the audio focus back so other apps' music resumes.

export const WARM_AUDIO_GRACE_MS = 8_000

export type WarmAudioSessionDeps = {
  readonly initialize: () => Promise<boolean>
  readonly toggleRecording: (recording: boolean) => boolean
  readonly tearDown: () => void
  // Calls the handler when the app stops being the foreground app; returns the unsubscribe.
  readonly onBackground: (handler: () => void) => () => void
  readonly setTimer: (run: () => void, ms: number) => unknown
  readonly clearTimer: (timer: unknown) => void
  readonly graceMs?: number
}

export type WarmAudioSession = {
  /** Brings the engine up (or reuses the warm one). False when the device refused. */
  readonly open: () => Promise<boolean>
  readonly begin: () => boolean
  /** Mutes the microphone and keeps the engine warm only for the grace period. */
  readonly end: () => void
  /** Releases the engine now, unless a dictation is recording (its end starts the grace period). */
  readonly releaseIfIdle: () => void
  /** Releases the engine now. */
  readonly release: () => void
}

export function createWarmAudioSession(deps: WarmAudioSessionDeps): WarmAudioSession {
  const graceMs = deps.graceMs ?? WARM_AUDIO_GRACE_MS
  let graceTimer: unknown = null
  let recording = false
  let warm = false
  let stopWatchingBackground: (() => void) | null = null

  function cancelGrace(): void {
    if (graceTimer !== null) {
      deps.clearTimer(graceTimer)
      graceTimer = null
    }
  }

  function release(): void {
    cancelGrace()
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

  function scheduleGraceRelease(): void {
    cancelGrace()
    graceTimer = deps.setTimer(release, graceMs)
  }

  async function ensureWarm(): Promise<boolean> {
    cancelGrace()
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
      cancelGrace()
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
      scheduleGraceRelease()
    },
    releaseIfIdle: () => {
      if (!recording) {
        release()
      }
    },
    release
  }
}
