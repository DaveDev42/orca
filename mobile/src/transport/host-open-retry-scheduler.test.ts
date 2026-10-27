import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installIllegalInvocationTimerGuards } from './global-timer-receiver-test-fakes'
import { HOST_OPEN_PARK_AFTER_FAILURES, HostOpenRetryScheduler } from './host-open-retry-scheduler'

describe('HostOpenRetryScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('advances through bounded retry tiers', async () => {
    let generation = 1
    const open = vi.fn()
    const scheduler = new HostOpenRetryScheduler({
      canRetry: (_hostId, candidate) => candidate === generation,
      open
    })

    const delays = [1_000, 2_000, 5_000, 15_000, 30_000]
    for (const [index, delay] of delays.entries()) {
      generation = index + 1
      expect(scheduler.recordFailure('host-1', generation)).toEqual({
        failureCount: index + 1,
        nextDelayMs: delay
      })
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(open).toHaveBeenCalledTimes(index)
      await vi.advanceTimersByTimeAsync(1)
      expect(open).toHaveBeenCalledTimes(index + 1)
      expect(open).toHaveBeenLastCalledWith('host-1')
    }
  })

  it('parks after the failure limit and ignores revival expedites', async () => {
    const open = vi.fn()
    const scheduler = new HostOpenRetryScheduler({ canRetry: () => true, open })

    for (let failure = 1; failure < HOST_OPEN_PARK_AFTER_FAILURES; failure++) {
      scheduler.recordFailure('host-1', 1)
      expect(scheduler.isParked('host-1')).toBe(false)
    }
    scheduler.recordFailure('host-1', 1)
    expect(scheduler.isParked('host-1')).toBe(true)

    open.mockClear()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    scheduler.expedite('host-1')
    expect(open).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    // An explicit open (cancel + fresh attempt) or a success clears the park.
    scheduler.recordSuccess('host-1')
    expect(scheduler.isParked('host-1')).toBe(false)
  })

  it('expedites without forgiving the failure streak', async () => {
    let generation = 1
    const open = vi.fn()
    const scheduler = new HostOpenRetryScheduler({
      canRetry: (_hostId, candidate) => candidate === generation,
      open
    })

    scheduler.recordFailure('host-1', generation)
    scheduler.expedite('host-1')
    expect(open).toHaveBeenCalledOnce()

    generation = 2
    scheduler.recordFailure('host-1', generation)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(open).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(open).toHaveBeenCalledTimes(2)

    scheduler.recordFailure('host-1', generation)
    generation = 3
    scheduler.expedite('host-1')
    expect(open).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('schedules and clears with no injected timers when the global rejects a non-global receiver', async () => {
    const timers = installIllegalInvocationTimerGuards()
    const open = vi.fn()
    const scheduler = new HostOpenRetryScheduler({ canRetry: () => true, open })

    scheduler.recordFailure('host-1', 1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(open).toHaveBeenCalledOnce()

    scheduler.recordFailure('host-1', 1)
    scheduler.cancel('host-1')
    expect(timers.cleared).toHaveLength(1)
    expect(timers.cleared[0]).toBe(timers.scheduled[1])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(open).toHaveBeenCalledOnce()
  })

  it('cancels retry delivery', async () => {
    const open = vi.fn()
    const scheduler = new HostOpenRetryScheduler({ canRetry: () => true, open })
    scheduler.recordFailure('host-1', 1)
    scheduler.cancel('host-1')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(open).not.toHaveBeenCalled()
  })
})
