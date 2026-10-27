import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openAuthenticatedDirectEndpoint = vi.hoisted(() => vi.fn())
vi.mock('./mobile-direct-endpoint-probe', () => ({ openAuthenticatedDirectEndpoint }))

import { DIRECT_PROBE_PARK_AFTER_FAILURES, DirectReturnProbe } from './mobile-direct-return-probe'
import type { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'

function createProbe() {
  const hysteresis = {
    canProbe: () => true,
    recordDirectFailure: vi.fn(),
    recordDirectSuccess: vi.fn(() => false),
    recordMigration: vi.fn()
  } as unknown as MobileEndpointHysteresis
  const probe = new DirectReturnProbe(
    {
      now: () => Date.now(),
      setTimer: (callback: () => void, delay: number) => setTimeout(callback, delay),
      clearTimer: clearTimeout,
      openDirect: vi.fn(),
      directPath: 'tailscale'
    } as never,
    {
      hysteresis,
      canSchedule: () => true,
      canAttempt: () => true,
      beginOperation: vi.fn(),
      migrate: vi.fn(),
      onDirectMigrated: vi.fn(),
      afterProbe: vi.fn()
    }
  )
  return probe
}

describe('DirectReturnProbe parking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    openAuthenticatedDirectEndpoint.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('stops probing after consecutive failures and resumes only on a focus nudge', async () => {
    openAuthenticatedDirectEndpoint.mockResolvedValue(null)
    const probe = createProbe()

    probe.schedule()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(openAuthenticatedDirectEndpoint).toHaveBeenCalledTimes(DIRECT_PROBE_PARK_AFTER_FAILURES)
    expect(probe.isParked()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    // Revival nudges must not wake it.
    probe.nudge('app-resume')
    probe.nudge('network-change')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(openAuthenticatedDirectEndpoint).toHaveBeenCalledTimes(DIRECT_PROBE_PARK_AFTER_FAILURES)

    probe.nudge('focus')
    await vi.advanceTimersByTimeAsync(1)
    expect(openAuthenticatedDirectEndpoint).toHaveBeenCalledTimes(
      DIRECT_PROBE_PARK_AFTER_FAILURES + 1
    )
    probe.stop()
  })

  it('does not park while a probe reaches the host', async () => {
    const client = { close: vi.fn() }
    openAuthenticatedDirectEndpoint.mockResolvedValue(client)
    const probe = createProbe()

    probe.schedule()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(probe.isParked()).toBe(false)
    expect(openAuthenticatedDirectEndpoint.mock.calls.length).toBeGreaterThan(
      DIRECT_PROBE_PARK_AFTER_FAILURES
    )
    probe.stop()
  })
})
