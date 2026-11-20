import { describe, expect, it } from 'vitest'
import { AUTO_STOP_SILENCE_MS, createAutoStopVad } from './dictation-auto-stop-vad'

const FRAME_MS = 50
const FRAME_SAMPLES = 800

// Deterministic pseudo-noise so the tests do not flake.
function noiseFrame(rms: number, seed: number): Float32Array {
  const frame = new Float32Array(FRAME_SAMPLES)
  let state = seed * 2654435761 + 1
  for (let i = 0; i < FRAME_SAMPLES; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    // Uniform in [-1, 1) has RMS 1/sqrt(3).
    frame[i] = ((state / 0xffffffff) * 2 - 1) * rms * Math.sqrt(3)
  }
  return frame
}

type Scene = { floor: number; speech: number }

// Frame-level swing of real speech (relative RMS, mean about 1): syllables and word gaps, taken from
// a phone dictation in the corpus. Constant-level "speech" would read as a hum to the steady-noise learner.
const SPEECH_ENVELOPE = [
  1.3, 1.2, 3.6, 1.9, 1.3, 0.1, 0.1, 2.5, 2.4, 0.7, 0.1, 1.8, 1.6, 1.2, 0.2, 0.9
]

function run(
  scene: Scene,
  parts: readonly (readonly ['floor' | 'speech', number])[]
): { endedAtMs: number | null; vad: ReturnType<typeof createAutoStopVad> } {
  const vad = createAutoStopVad()
  let t = 0
  let seed = 1
  let endedAtMs: number | null = null
  for (const [kind, ms] of parts) {
    for (let i = 0; i < ms / FRAME_MS; i += 1) {
      const level =
        kind === 'speech' ? scene.speech * SPEECH_ENVELOPE[i % SPEECH_ENVELOPE.length] : scene.floor
      seed += 1
      t += FRAME_MS
      if (vad.push(noiseFrame(level, seed), FRAME_MS) && endedAtMs === null) {
        endedAtMs = t
      }
    }
  }
  return { endedAtMs, vad }
}

// Streams frames into one VAD the way the phone's PCM arrives, noting when it ends.
class Feeder {
  readonly vad = createAutoStopVad()
  ends = 0
  private seed = 1
  private clockMs = 0
  private firstEndMs: number | null = null
  private mark = 0

  get ended(): boolean {
    return this.ends > 0
  }

  noise(rms: number, ms: number): void {
    this.feed(ms, () => rms)
  }

  /** Speech swinging like a voice, on top of `ambient` noise (adds in power). */
  speech(rms: number, ms: number, ambient = 0): void {
    this.mark = this.clockMs
    let index = 0
    this.feed(ms, () => {
      const level = rms * SPEECH_ENVELOPE[index % SPEECH_ENVELOPE.length]
      index += 1
      return Math.hypot(level, ambient)
    })
  }

  /** Ms the end came after `afterMs` into the last speech() call; Infinity if it never ended. */
  endedAfter(afterMs: number): number {
    return this.firstEndMs === null
      ? Number.POSITIVE_INFINITY
      : this.firstEndMs - this.mark - afterMs
  }

  private feed(ms: number, level: () => number): void {
    for (let i = 0; i < ms / FRAME_MS; i += 1) {
      this.seed += 1
      this.clockMs += FRAME_MS
      if (this.vad.push(noiseFrame(level(), this.seed), FRAME_MS)) {
        this.ends += 1
        this.firstEndMs ??= this.clockMs
      }
    }
  }
}

const QUIET: Scene = { floor: 0.004, speech: 0.08 }
const CAR: Scene = { floor: 0.03, speech: 0.14 }

describe('createAutoStopVad', () => {
  it('ends once after silence that follows speech', () => {
    const { endedAtMs } = run(QUIET, [
      ['floor', 500],
      ['speech', 2000],
      ['floor', 3000]
    ])
    expect(endedAtMs).not.toBeNull()
    // The speech envelope ends on a word gap, so the quiet is already running a frame or two early.
    expect(endedAtMs! - 2500).toBeGreaterThanOrEqual(AUTO_STOP_SILENCE_MS - 300)
    expect(endedAtMs! - 2500).toBeLessThan(AUTO_STOP_SILENCE_MS + 200)
  })

  it('does not end before any speech, however long the noise floor lasts', () => {
    const { endedAtMs, vad } = run(CAR, [['floor', 60_000]])
    expect(endedAtMs).toBeNull()
    expect(vad.speechStarted()).toBe(false)
  })

  it('ends after speech over a loud car noise floor', () => {
    const { endedAtMs, vad } = run(CAR, [
      ['floor', 500],
      ['speech', 3000],
      ['floor', 3000]
    ])
    expect(vad.speechStarted()).toBe(true)
    expect(endedAtMs).not.toBeNull()
    expect(endedAtMs! - 3500).toBeLessThan(AUTO_STOP_SILENCE_MS + 300)
  })

  it('keeps going through pauses shorter than the silence window', () => {
    const { endedAtMs } = run(CAR, [
      ['floor', 500],
      ['speech', 1000],
      ['floor', 1200],
      ['speech', 1000],
      ['floor', 1500],
      ['speech', 1000]
    ])
    expect(endedAtMs).toBeNull()
  })

  it('does not take a short click for speech', () => {
    const { endedAtMs, vad } = run(QUIET, [
      ['floor', 500],
      ['speech', 100],
      ['floor', 6000]
    ])
    expect(vad.speechStarted()).toBe(false)
    expect(endedAtMs).toBeNull()
  })

  it('does not let a brief bump reset the silence timer', () => {
    const { endedAtMs } = run(CAR, [
      ['floor', 500],
      ['speech', 2000],
      ['floor', 800],
      ['speech', 50],
      ['floor', 1200]
    ])
    expect(endedAtMs).not.toBeNull()
  })

  it('learns a noise floor that rises while nobody speaks', () => {
    const vad = createAutoStopVad()
    let seed = 1
    for (let i = 0; i < 20; i += 1) {
      vad.push(noiseFrame(0.004, (seed += 1)), FRAME_MS)
    }
    for (let i = 0; i < 100; i += 1) {
      vad.push(noiseFrame(0.009, (seed += 1)), FRAME_MS)
    }
    expect(vad.noiseFloor()).toBeGreaterThan(0.008)
  })

  it('still ends when the road gets much louder after speech', () => {
    const road = new Feeder()
    road.noise(0.01, 500)
    road.speech(0.08, 1500)
    // A tunnel: 4x the calibrated floor, steady, from the moment speech stops.
    road.noise(0.04, 5000)
    expect(road.endedAfter(1500)).toBeGreaterThan(AUTO_STOP_SILENCE_MS - 400)
    expect(road.endedAfter(1500)).toBeLessThan(AUTO_STOP_SILENCE_MS + 400)
  })

  // Bluetooth call audio (Tesla HFP) from corpus replays of 20261118 dictations: the first ~1.5 s
  // is digital zero, then the link delivers ambient noise at 0.01-0.03 RMS. The 300 ms calibration
  // saw only zeros, so before the steady-noise learner that noise was "voiced" for ever and the
  // dictation never ended (floor still 0.0075 after 4 s of trailing noise at 0.03).
  it.each([0.01, 0.02, 0.03])(
    'ends when call-link noise at %s RMS arrives after the calibration',
    (level) => {
      const feeder = new Feeder()
      feeder.noise(0, 1500)
      feeder.speech(0.06, 3000, level)
      feeder.noise(level, 5000)
      expect(feeder.endedAfter(3000)).toBeGreaterThan(AUTO_STOP_SILENCE_MS - 400)
      expect(feeder.endedAfter(3000)).toBeLessThan(AUTO_STOP_SILENCE_MS + 400)
    }
  )

  it('does not take call-link noise alone for speech, nor end on it', () => {
    const feeder = new Feeder()
    feeder.noise(0, 1500)
    feeder.noise(0.03, 20_000)
    expect(feeder.vad.speechStarted()).toBe(false)
    expect(feeder.ended).toBe(false)
  })

  it('reports the end only once and can be reset', () => {
    const feeder = new Feeder()
    feeder.noise(0.004, 500)
    feeder.speech(0.08, 1000)
    feeder.noise(0.004, 5000)
    expect(feeder.ends).toBe(1)
    feeder.vad.reset()
    expect(feeder.vad.speechStarted()).toBe(false)
    feeder.noise(0.004, 500)
    feeder.speech(0.08, 1000)
    feeder.noise(0.004, 3000)
    expect(feeder.ends).toBe(2)
  })
})
