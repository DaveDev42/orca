// Adaptive energy VAD for ending a tap-mode dictation once the speaker stops talking.
// The meter's own analyzer reads "speech" against a slow noise floor and feeds a minutes-long
// forgotten-mic guard; this one decides in about a second and a half, so it must cope with a
// loud steady floor (a car on the road) where a fixed threshold would never see silence.

/** Audio below the speech threshold for this long, after speech, ends the dictation. Tune here. */
export const AUTO_STOP_SILENCE_MS = 1600
/** Voiced audio needed (leaky, so a click does not count) before silence may end the dictation. */
export const AUTO_STOP_SPEECH_START_MS = 300
/** The first stretch only measures the noise floor; no speech is judged in it. */
export const AUTO_STOP_CALIBRATION_MS = 300
/**
 * Audio from the first moments after the engine starts is skipped entirely: a Bluetooth car is still switching
 * into call mode (digital zero, a burst of link noise), and calibrating on that mis-sets the floor.
 */
export const AUTO_STOP_SETTLE_MS = 400
/** No speech this long after calibration ends the dictation, so a mic opened by mistake does not run for a minute. */
export const AUTO_STOP_NO_SPEECH_MS = 6000
/** Digital zero (a link that is not delivering audio yet) does not spend the no-speech budget, up to this much in all. */
export const AUTO_STOP_NO_SPEECH_MAX_TOTAL_MS = 15_000
const DIGITAL_ZERO_RMS = 1e-4
/**
 * Speech may only start when a frame is also this many times a slowly tracked noise floor. The fast floor
 * falls to a digital zero within a few frames, so a car's noise that comes up afterwards would look voiced
 * until the steady-noise learner caught it; the slow one remembers what the cabin sounded like.
 */
export const AUTO_STOP_SLOW_FLOOR_RATIO = 2
/** A frame is voiced when its RMS is this many times the noise floor... */
export const AUTO_STOP_VOICED_RATIO = 2.5
/** ...but once speech began, a lower ratio keeps the tail of a word from flapping. */
export const AUTO_STOP_SPEAKING_RATIO = 1.8
/** ...and at least this loud in absolute terms (full scale = 1), so a silent room's hiss is not speech. */
export const AUTO_STOP_MIN_VOICED_RMS = 0.012
/** A voiced burst shorter than this (a bump in the road) does not reset the silence timer. */
export const AUTO_STOP_MIN_VOICED_RUN_MS = 100

/**
 * Audio whose frame RMS stays within STEADY_RATIO of its minimum for this many frames is a hum, not
 * speech: syllables swing the frame RMS several-fold. The floor jumps to it, so noise that arrives after the
 * calibration (a Bluetooth call link coming up, voice-processing gain recovering after speech) is
 * learned in about 0.6 s, not in the half minute the voiced creep below would take.
 */
export const AUTO_STOP_STEADY_FRAMES = 12
export const AUTO_STOP_STEADY_RATIO = 2
const FLOOR_STEADY_RISE = 0.5

const FLOOR_MIN = 0.002
const SLOW_FLOOR_MIN = 0.004
const SLOW_FLOOR_KEEP = 0.98
// The floor falls fast toward quieter audio, rises quickly through unvoiced audio and only
// creeps up under voiced audio, so a noisier road is learned without absorbing speech.
const FLOOR_FALL = 0.3
const FLOOR_RISE_UNVOICED = 0.05
const FLOOR_RISE_VOICED_PER_FRAME = 1.003

export type AutoStopVad = {
  /** Feeds one window of mono samples (-1..1); true once, when speech has ended. */
  readonly push: (samples: Float32Array, durationMs: number) => boolean
  readonly reset: () => void
  /** Whether speech was detected yet, for tests and diagnostics. */
  readonly speechStarted: () => boolean
  readonly noiseFloor: () => number
}

function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

export function createAutoStopVad(): AutoStopVad {
  let floor = FLOOR_MIN
  let calibratedMs = 0
  let calibrationMin = Number.POSITIVE_INFINITY
  let slowFloor = SLOW_FLOOR_MIN
  let settledMs = 0
  let listenedMs = 0
  let deadMs = 0
  let voicedMs = 0
  let voicedRunMs = 0
  let silenceMs = 0
  let started = false
  let startedFrame = 0
  let frame = 0
  let recent: number[] = []
  let ended = false

  function reset(): void {
    floor = FLOOR_MIN
    calibratedMs = 0
    calibrationMin = Number.POSITIVE_INFINITY
    slowFloor = SLOW_FLOOR_MIN
    settledMs = 0
    listenedMs = 0
    deadMs = 0
    voicedMs = 0
    voicedRunMs = 0
    silenceMs = 0
    started = false
    startedFrame = 0
    frame = 0
    recent = []
    ended = false
  }

  // A stretch of near-constant level is ambient noise whatever its loudness: lift the floor to it,
  // count it as silence from its start, and take back a "speech start" it had just produced.
  function learnSteadyNoise(rms: number, durationMs: number): void {
    recent.push(rms)
    if (recent.length > AUTO_STOP_STEADY_FRAMES) {
      recent.shift()
    }
    if (recent.length < AUTO_STOP_STEADY_FRAMES) {
      return
    }
    const low = Math.min(...recent)
    if (low <= 0 || Math.max(...recent) > low * AUTO_STOP_STEADY_RATIO) {
      return
    }
    const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length
    if (mean <= floor) {
      return
    }
    floor += (mean - floor) * FLOOR_STEADY_RISE
    if (started && frame - startedFrame < AUTO_STOP_STEADY_FRAMES) {
      started = false
      voicedMs = 0
      silenceMs = 0
    }
    silenceMs = Math.max(silenceMs, recent.length * durationMs)
  }

  function push(samples: Float32Array, durationMs: number): boolean {
    if (ended) {
      return false
    }
    if (settledMs < AUTO_STOP_SETTLE_MS) {
      settledMs += durationMs
      return false
    }
    const rms = rmsOf(samples)
    if (calibratedMs < AUTO_STOP_CALIBRATION_MS) {
      calibratedMs += durationMs
      calibrationMin = Math.min(calibrationMin, rms)
      floor = Math.max(FLOOR_MIN, calibrationMin)
      slowFloor = Math.max(SLOW_FLOOR_MIN, calibrationMin)
      return false
    }
    frame += 1
    if (rms < DIGITAL_ZERO_RMS) {
      deadMs += durationMs
    } else {
      listenedMs += durationMs
    }
    if (
      !started &&
      (listenedMs >= AUTO_STOP_NO_SPEECH_MS ||
        listenedMs + deadMs >= AUTO_STOP_NO_SPEECH_MAX_TOTAL_MS)
    ) {
      ended = true
      return true
    }
    learnSteadyNoise(rms, durationMs)
    const ratio = started ? AUTO_STOP_SPEAKING_RATIO : AUTO_STOP_VOICED_RATIO
    // The slow floor follows quiet and moderately louder audio but cannot be pulled up by a burst of speech.
    const slowReference = slowFloor
    slowFloor = Math.max(
      SLOW_FLOOR_MIN,
      slowFloor * SLOW_FLOOR_KEEP + Math.min(rms, slowFloor * 2) * (1 - SLOW_FLOOR_KEEP)
    )
    const clearOfCabin = started || rms >= slowReference * AUTO_STOP_SLOW_FLOOR_RATIO
    const voiced = rms >= AUTO_STOP_MIN_VOICED_RMS && rms >= floor * ratio && clearOfCabin

    if (rms < floor) {
      floor = Math.max(FLOOR_MIN, floor + (rms - floor) * FLOOR_FALL)
    } else if (voiced) {
      floor *= FLOOR_RISE_VOICED_PER_FRAME
    } else {
      floor += (rms - floor) * FLOOR_RISE_UNVOICED
    }

    if (voiced) {
      voicedRunMs += durationMs
      voicedMs += durationMs
      if (voicedRunMs >= AUTO_STOP_MIN_VOICED_RUN_MS) {
        silenceMs = 0
      }
      if (!started && voicedMs >= AUTO_STOP_SPEECH_START_MS) {
        started = true
        startedFrame = frame
      }
      return false
    }
    voicedRunMs = 0
    voicedMs = Math.max(0, voicedMs - durationMs)
    if (!started) {
      return false
    }
    silenceMs += durationMs
    if (silenceMs >= AUTO_STOP_SILENCE_MS) {
      ended = true
      return true
    }
    return false
  }

  return { push, reset, speechStarted: () => started, noiseFloor: () => floor }
}
