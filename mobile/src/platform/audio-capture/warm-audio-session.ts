// Keeps the phone's audio engine alive for a short grace period after a dictation so back-to-back dictations do
// not renegotiate Bluetooth call mode (HFP) in a car. Nothing here runs ahead of a dictation: focusing the composer
// or raising the keyboard must never touch the audio session, because an active session pins the car in a phone
// call and stops the music. After the grace period (or on blur/background) the engine and session are released,
// which hands the audio focus back so other apps' music resumes.

export const WARM_AUDIO_GRACE_MS = 8_000

// Why a caller touches the session; it only reaches the device log (`[orca-audio] js: warm.<call> reason=...`).
export type WarmAudioReason = string

export type WarmAudioSessionDeps = {
  readonly initialize: () => Promise<boolean>
  readonly toggleRecording: (recording: boolean) => boolean
  readonly tearDown: () => void
  // Calls the handler when the app stops being the foreground app; returns the unsubscribe.
  readonly onBackground: (handler: () => void) => () => void
  readonly setTimer: (run: () => void, ms: number) => unknown
  readonly clearTimer: (timer: unknown) => void
  readonly graceMs?: number
  // Best-effort device log line; the native seam writes it to os_log, tests and web leave it out.
  readonly log?: (message: string) => void
}

export type WarmAudioSession = {
  /** Brings the engine up (or reuses the warm one). False when the device refused. */
  readonly open: (reason?: WarmAudioReason) => Promise<boolean>
  readonly begin: (reason?: WarmAudioReason) => boolean
  /** Mutes the microphone and keeps the engine warm only for the grace period. Repeated calls do not extend it. */
  readonly end: (reason?: WarmAudioReason) => void
  /**
   * Releases the engine now, unless a dictation is starting or recording (its end starts the grace period). The
   * keyboard hiding when the dictation button is pressed lands between open and begin; releasing there tears the
   * session down and the start brings it right back up, which a Bluetooth car shows as call/media/call flapping.
   */
  readonly releaseIfIdle: (reason?: WarmAudioReason) => void
  /** Releases the engine now. */
  readonly release: (reason?: WarmAudioReason) => void
}

export function createWarmAudioSession(deps: WarmAudioSessionDeps): WarmAudioSession {
  const graceMs = deps.graceMs ?? WARM_AUDIO_GRACE_MS
  // One timer at a time: the post-dictation grace, or the watchdog for an open that no begin follows. Both end in
  // a hard release that ignores the flags below, so a stuck flag can never hold a car in call mode.
  let graceTimer: unknown = null
  let timerKind: 'grace' | 'open-timeout' = 'grace'
  let recording = false
  // True from open() until end()/release(): a dictation owns the session even before the mic is on.
  let starting = false
  let warm = false
  // Bumped by every end()/release(), so an open() that resolves after its dictation already ended can tell.
  let endCount = 0
  let stopWatchingBackground: (() => void) | null = null

  function note(call: string, reason: WarmAudioReason | undefined, extra = ''): void {
    try {
      deps.log?.(
        `warm.${call} reason=${reason ?? 'unknown'} warm=${warm} starting=${starting} recording=${recording}${extra}`
      )
    } catch {
      // Logging is best effort.
    }
  }

  function cancelTimer(): void {
    if (graceTimer !== null) {
      deps.clearTimer(graceTimer)
      graceTimer = null
    }
  }

  function tearDownNow(): void {
    try {
      deps.toggleRecording(false)
    } catch (error) {
      console.error('Failed to mute the microphone', error)
    }
    try {
      deps.tearDown()
    } catch (error) {
      console.error('Failed to tear down the audio session', error)
    }
  }

  function release(reason?: WarmAudioReason): void {
    note('release', reason)
    cancelTimer()
    stopWatchingBackground?.()
    stopWatchingBackground = null
    recording = false
    starting = false
    endCount += 1
    if (!warm) {
      return
    }
    warm = false
    tearDownNow()
  }

  // The timer's release is the hard one: whatever the flags say, the engine goes down. The native tear down is a
  // no-op when there is nothing to tear down, so it also runs for a session this object thinks is cold.
  function hardRelease(): void {
    const kind = timerKind
    graceTimer = null
    note('timer-fired', kind)
    const wasWarm = warm
    release(kind)
    if (!wasWarm) {
      tearDownNow()
    }
  }

  function armTimer(kind: 'grace' | 'open-timeout'): void {
    cancelTimer()
    timerKind = kind
    graceTimer = deps.setTimer(hardRelease, graceMs)
  }

  async function open(reason?: WarmAudioReason): Promise<boolean> {
    note('open', reason)
    cancelTimer()
    starting = true
    const endsBefore = endCount
    let initialized = false
    try {
      initialized = await deps.initialize()
    } finally {
      if (!initialized) {
        starting = false
      }
    }
    if (!initialized) {
      note('open-refused', reason)
      return false
    }
    warm = true
    // A backgrounded app cannot keep the microphone, and holding a warm engine would pin the car in call mode.
    stopWatchingBackground ??= deps.onBackground(() => {
      if (!recording) {
        release('background')
      }
    })
    if (endCount !== endsBefore) {
      // The dictation ended (cancel, interruption) while the engine was coming up, so its end() found nothing warm
      // to schedule and nothing else would release this engine.
      starting = false
      note('open-after-end', reason)
      armTimer('grace')
      return true
    }
    // Opened but not begun yet. If no begin() follows within the grace period the engine is released anyway.
    note('opened', reason)
    armTimer('open-timeout')
    return true
  }

  function begin(reason?: WarmAudioReason): boolean {
    note('begin', reason)
    cancelTimer()
    let started = false
    try {
      started = deps.toggleRecording(true)
    } finally {
      recording = started
      if (!started) {
        // A refused start owns nothing; the grace period hands the session back even if no end() follows.
        starting = false
        note('begin-refused', reason)
        armTimer('grace')
      }
    }
    return started
  }

  function end(reason?: WarmAudioReason): void {
    endCount += 1
    const alreadyIdle = !recording && !starting
    note('end', reason, alreadyIdle ? ' repeat=true' : '')
    recording = false
    starting = false
    if (!warm) {
      return
    }
    if (alreadyIdle && graceTimer !== null) {
      // A repeated end (finish, cleanup and unmount all call it) must not push the release out.
      return
    }
    try {
      deps.toggleRecording(false)
    } catch (error) {
      console.error('Failed to mute the microphone', error)
    }
    armTimer('grace')
  }

  return {
    open,
    begin,
    end,
    releaseIfIdle: (reason) => {
      if (!recording && !starting) {
        release(reason)
        return
      }
      note('release-skipped', reason)
    },
    release
  }
}
