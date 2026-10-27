import { openAuthenticatedDirectEndpoint } from './mobile-direct-endpoint-probe'
import type { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import type { RpcClient } from './rpc-client'
import type { ForegroundNudgeReason } from './types'
import type { ScheduleTimer } from './timer-scheduler'
import type { MobileConnectionPath } from './stable-logical-rpc-client'

const DIRECT_PROBE_INTERVAL_MS = 15_000
// Park after this many consecutive failed probes; probing an unreachable peer is continuous VPN traffic.
export const DIRECT_PROBE_PARK_AFTER_FAILURES = 4

export class DirectReturnProbe {
  private timer: ReturnType<typeof setTimeout> | null = null

  private stopped = false
  private consecutiveFailures = 0
  private activeProbe: AbortController | null = null

  constructor(
    private readonly deps: {
      now: () => number
      setTimer: ScheduleTimer
      clearTimer: typeof clearTimeout
      openDirect: () => RpcClient
      directPath: Exclude<MobileConnectionPath, 'relay'>
    },
    private readonly hooks: {
      hysteresis: MobileEndpointHysteresis
      canSchedule: () => boolean
      canAttempt: () => boolean
      beginOperation: () => void
      migrate: (
        client: RpcClient,
        path: MobileConnectionPath,
        shouldAbort: () => boolean
      ) => Promise<void>
      onDirectMigrated: () => Promise<void>
      afterProbe: () => void
    }
  ) {}

  schedule(delayMs = DIRECT_PROBE_INTERVAL_MS): void {
    if (this.stopped || this.isParked() || !this.hooks.canSchedule() || this.timer) {
      return
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null
      void this.probe()
    }, delayMs)
  }

  isParked(): boolean {
    return this.consecutiveFailures >= DIRECT_PROBE_PARK_AFTER_FAILURES
  }

  // Revival nudges only schedule; an explicit focus (host screen open) first re-arms a parked probe.
  nudge(reason: ForegroundNudgeReason): void {
    if (reason === 'focus') {
      this.consecutiveFailures = 0
    }
    this.schedule(0)
  }

  clear(): void {
    if (this.timer) {
      this.deps.clearTimer(this.timer)
      this.timer = null
    }
  }

  stop(): void {
    this.stopped = true
    this.clear()
    this.activeProbe?.abort()
  }

  private async probe(): Promise<void> {
    if (this.stopped) {
      return
    }
    if (!this.hooks.canAttempt() || !this.hooks.hysteresis.canProbe(this.deps.now())) {
      this.schedule()
      return
    }
    const controller = new AbortController()
    this.activeProbe = controller
    this.hooks.beginOperation()
    let successful: Awaited<ReturnType<typeof openAuthenticatedDirectEndpoint>> = null
    try {
      successful = await openAuthenticatedDirectEndpoint(
        this.deps.openDirect,
        12_000,
        controller.signal
      )
      if (this.stopped) {
        return
      }
      if (!successful) {
        this.hooks.hysteresis.recordDirectFailure(this.deps.now())
        this.consecutiveFailures++
        return
      }
      this.consecutiveFailures = 0
      if (!this.hooks.hysteresis.recordDirectSuccess(this.deps.now())) {
        successful.close()
        return
      }
      const candidate = successful
      // Migration owns the candidate, including closing it if cutover is canceled.
      successful = null
      try {
        await this.hooks.migrate(candidate, this.deps.directPath, () => this.stopped)
      } catch (error) {
        if (this.stopped) {
          return
        }
        throw error
      }
      if (this.stopped) {
        return
      }
      this.hooks.hysteresis.recordMigration(this.deps.now())
      await this.hooks.onDirectMigrated()
    } finally {
      this.activeProbe = null
      successful?.close()
      // Release the probe mutex and replay recovery queued by a concurrent relay drop/backoff timer.
      this.hooks.afterProbe()
      this.schedule()
    }
  }
}
