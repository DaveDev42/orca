import { describe, expect, it, vi } from 'vitest'
import { createWarmAudioSession, WARM_AUDIO_IDLE_MS } from './warm-audio-session'

function setup(options: { permission?: boolean; initialize?: boolean } = {}) {
  const timers = new Map<number, { run: () => void; ms: number }>()
  let nextTimer = 1
  let backgroundHandler: (() => void) | null = null
  const unsubscribe = vi.fn(() => {
    backgroundHandler = null
  })
  const deps = {
    initialize: vi.fn(async () => options.initialize ?? true),
    toggleRecording: vi.fn((recording: boolean) => recording),
    tearDown: vi.fn(),
    hasMicrophonePermission: vi.fn(async () => options.permission ?? true),
    onBackground: vi.fn((handler: () => void) => {
      backgroundHandler = handler
      return unsubscribe
    }),
    setTimer: vi.fn((run: () => void, ms: number) => {
      const id = nextTimer++
      timers.set(id, { run, ms })
      return id
    }),
    clearTimer: vi.fn((timer: unknown) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fake clock only hands out numeric ids from setTimer
      timers.delete(timer as number)
    })
  }
  return {
    deps,
    session: createWarmAudioSession(deps),
    timers,
    background: () => backgroundHandler?.(),
    fireIdle: () => {
      for (const [id, timer] of timers) {
        timers.delete(id)
        timer.run()
      }
    }
  }
}

describe('createWarmAudioSession', () => {
  it('keeps the engine up when a dictation ends and releases it after the idle window', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open()
    expect(session.begin()).toBe(true)
    session.end()
    expect(deps.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(deps.tearDown).not.toHaveBeenCalled()
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([WARM_AUDIO_IDLE_MS])
    fireIdle()
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('reuses the warm engine for the next dictation and cancels the pending release', async () => {
    const { session, deps, timers } = setup()
    await session.open()
    session.begin()
    session.end()
    expect(timers.size).toBe(1)
    await session.open()
    session.begin()
    expect(timers.size).toBe(0)
    expect(deps.tearDown).not.toHaveBeenCalled()
    expect(deps.initialize).toHaveBeenCalledTimes(2)
  })

  it('prewarms only when permission was already granted', async () => {
    const denied = setup({ permission: false })
    await expect(denied.session.prewarm()).resolves.toBe(false)
    expect(denied.deps.initialize).not.toHaveBeenCalled()

    const granted = setup()
    await expect(granted.session.prewarm()).resolves.toBe(true)
    expect(granted.deps.initialize).toHaveBeenCalledTimes(1)
    expect(granted.deps.toggleRecording).not.toHaveBeenCalled()
    // Nobody dictated: the warm engine must not outlive the idle window.
    granted.fireIdle()
    expect(granted.deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('does not release a prewarmed engine while it records', async () => {
    const { session, deps, fireIdle } = setup()
    await session.prewarm()
    await session.open()
    session.begin()
    fireIdle()
    expect(deps.tearDown).not.toHaveBeenCalled()
  })

  it('releases an idle engine when the app goes to the background but not a recording one', async () => {
    const idle = setup()
    await idle.session.open()
    idle.background()
    expect(idle.deps.tearDown).toHaveBeenCalledTimes(1)

    const live = setup()
    await live.session.open()
    live.session.begin()
    live.background()
    expect(live.deps.tearDown).not.toHaveBeenCalled()
  })

  it('reports a refused device and never schedules a release for it', async () => {
    const { session, timers } = setup({ initialize: false })
    await expect(session.open()).resolves.toBe(false)
    await expect(session.prewarm()).resolves.toBe(false)
    expect(timers.size).toBe(0)
  })

  it('release is idempotent and stops the background watch', async () => {
    const { session, deps } = setup()
    await session.open()
    session.release()
    session.release()
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
    expect(deps.onBackground).toHaveBeenCalledTimes(1)
  })
})
