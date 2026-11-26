import { describe, expect, it, vi } from 'vitest'
import { createWarmAudioSession, WARM_AUDIO_GRACE_MS } from './warm-audio-session'

function setup(options: { initialize?: boolean } = {}) {
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
    log: vi.fn(),
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
  it('keeps the engine up when a dictation ends and releases it after the grace period', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open()
    expect(session.begin()).toBe(true)
    session.end()
    expect(deps.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(deps.tearDown).not.toHaveBeenCalled()
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([WARM_AUDIO_GRACE_MS])
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

  it('uses an 8 second grace period', () => {
    expect(WARM_AUDIO_GRACE_MS).toBe(8000)
  })

  it('never brings the engine up before a dictation opens it', () => {
    const { deps, timers } = setup()
    expect(deps.initialize).not.toHaveBeenCalled()
    expect(deps.toggleRecording).not.toHaveBeenCalled()
    expect(timers.size).toBe(0)
  })

  it('does not release a recording engine when the grace timer would have fired', async () => {
    const { session, deps, fireIdle } = setup()
    await session.open()
    session.begin()
    fireIdle()
    expect(deps.tearDown).not.toHaveBeenCalled()
  })

  it('releaseIfIdle hands the session back at once unless recording', async () => {
    const idle = setup()
    await idle.session.open()
    idle.session.begin()
    idle.session.end()
    idle.session.releaseIfIdle()
    expect(idle.deps.tearDown).toHaveBeenCalledTimes(1)

    const live = setup()
    await live.session.open()
    live.session.begin()
    live.session.releaseIfIdle()
    expect(live.deps.tearDown).not.toHaveBeenCalled()
    live.session.end()
    live.fireIdle()
    expect(live.deps.tearDown).toHaveBeenCalledTimes(1)
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

  it('toggles recording on for every start, warm or cold, so the native start cue plays each time', async () => {
    const { session, deps } = setup()
    await session.open()
    session.begin()
    session.end()
    await session.open()
    session.begin()
    expect(deps.toggleRecording.mock.calls.filter(([on]) => on === true)).toHaveLength(2)
  })

  it('keeps the session when the keyboard hides while a dictation is opening or about to begin', async () => {
    const { session, deps } = setup()
    const opening = session.open()
    session.releaseIfIdle()
    await opening
    session.releaseIfIdle()
    expect(deps.tearDown).not.toHaveBeenCalled()
    expect(session.begin()).toBe(true)
    expect(deps.initialize).toHaveBeenCalledTimes(1)
  })

  it('has nothing to release after a refused open', async () => {
    const { session, deps } = setup({ initialize: false })
    await session.open()
    session.releaseIfIdle()
    expect(deps.tearDown).not.toHaveBeenCalled()
  })

  it('releases an opened session that no begin follows once the grace period passes', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open('page-start')
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([WARM_AUDIO_GRACE_MS])
    fireIdle()
    expect(deps.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('warm.timer-fired reason=open-timeout')
    )
  })

  it('does not release a begun dictation through the open watchdog', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open()
    session.begin()
    expect(timers.size).toBe(0)
    fireIdle()
    expect(deps.tearDown).not.toHaveBeenCalled()
  })

  it('arms the release when begin is refused, even if no end follows', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open()
    deps.toggleRecording.mockReturnValueOnce(false)
    expect(session.begin()).toBe(false)
    expect(timers.size).toBe(1)
    fireIdle()
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('arms the release when begin throws, and lets the error through', async () => {
    const { session, deps, timers, fireIdle } = setup()
    await session.open()
    deps.toggleRecording.mockImplementationOnce(() => {
      throw new Error('native failed')
    })
    expect(() => session.begin()).toThrow('native failed')
    expect(timers.size).toBe(1)
    fireIdle()
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('does not extend the grace period when end is called again', async () => {
    const { session, deps, timers } = setup()
    await session.open()
    session.begin()
    session.end('native-dictation')
    const [first] = [...timers.keys()]
    session.end('native-dictation')
    session.end('native-dictation')
    expect([...timers.keys()]).toEqual([first])
    expect(deps.setTimer).toHaveBeenCalledTimes(2)
  })

  it('starts the grace period when the dictation ended while the engine was coming up', async () => {
    const { session, deps, timers, fireIdle } = setup()
    const opening = session.open('native-dictation')
    session.end('native-dictation')
    expect(timers.size).toBe(0)
    await opening
    expect(timers.size).toBe(1)
    fireIdle()
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('clears the starting flag when initialize throws, so a later release works', async () => {
    const { session, deps } = setup()
    deps.initialize.mockRejectedValueOnce(new Error('boom'))
    await expect(session.open()).rejects.toThrow('boom')
    await session.open()
    session.begin()
    session.end()
    session.releaseIfIdle('keyboard-hide')
    expect(deps.tearDown).toHaveBeenCalledTimes(1)
  })

  it('writes each call and the timer release to the device log with its reason', async () => {
    const { session, deps, fireIdle } = setup()
    await session.open('page-start')
    session.begin('page-start')
    session.end('page-stop')
    session.releaseIfIdle('keyboard-hide')
    const lines = deps.log.mock.calls.map(([line]) => line)
    expect(lines).toEqual([
      'warm.open reason=page-start warm=false starting=false recording=false',
      'warm.opened reason=page-start warm=true starting=true recording=false',
      'warm.begin reason=page-start warm=true starting=true recording=false',
      'warm.end reason=page-stop warm=true starting=true recording=true',
      'warm.release reason=keyboard-hide warm=true starting=false recording=false'
    ])
    fireIdle()
  })

  // The quiet auto-stop ends the dictation through the same capture end as a manual stop; auto-send only changes
  // what the composer does with the words afterwards (it sends, and the keyboard may hide), never the audio.
  describe.each([{ autoSend: true }, { autoSend: false }])(
    'quiet auto-stop with auto-send $autoSend',
    ({ autoSend }) => {
      it('releases the session after the grace period', async () => {
        const { session, deps, timers, fireIdle } = setup()
        await session.open('native-dictation')
        session.begin('native-dictation')
        // Quiet stop: finish ends the capture, then cleanup and unmount end it again.
        session.end('native-dictation')
        session.end('native-dictation')
        if (autoSend) {
          session.releaseIfIdle('composer-blur')
          expect(deps.tearDown).toHaveBeenCalledTimes(1)
          return
        }
        expect(deps.tearDown).not.toHaveBeenCalled()
        expect([...timers.values()].map((timer) => timer.ms)).toEqual([WARM_AUDIO_GRACE_MS])
        fireIdle()
        expect(deps.toggleRecording).toHaveBeenLastCalledWith(false)
        expect(deps.tearDown).toHaveBeenCalledTimes(1)
        expect(timers.size).toBe(0)
      })

      it(`still releases when the next open never gets its begin (auto-send ${autoSend})`, async () => {
        const { session, deps, fireIdle } = setup()
        await session.open('native-dictation')
        session.begin('native-dictation')
        session.end('native-dictation')
        // The reconnect after a background opens the session again (page composer or native hold) and nothing begins.
        await session.open('page-start')
        fireIdle()
        expect(deps.tearDown).toHaveBeenCalledTimes(1)
      })
    }
  )
})
