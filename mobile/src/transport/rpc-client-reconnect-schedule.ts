const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000, 60_000]
// Park after this many failed attempts (~30s of backoff plus dial time). Continuous traffic to an unreachable
// Tailscale peer can exhaust the iOS VPN client WireGuard buffer pool (tailscale/tailscale#21773).
export const RPC_RECONNECT_ATTEMPT_LIMIT = 6

type ReconnectScheduleOptions = {
  openConnection: () => void
  rejectConnectWaiters: (reason: string) => void
  emitLog: (message: string, detail: string) => void
}

export class RpcClientReconnectSchedule {
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private parked = false

  constructor(private readonly options: ReconnectScheduleOptions) {}

  getAttempt(): number {
    return this.attempt
  }

  authenticated(): void {
    this.attempt = 0
    this.parked = false
  }

  // Parked hosts stop dialing until redialNow() is called by an explicit user action.
  isParked(): boolean {
    return this.parked
  }

  schedule(): void {
    if (this.attempt >= RPC_RECONNECT_ATTEMPT_LIMIT) {
      this.parked = true
      this.options.rejectConnectWaiters('Connection retry limit reached')
      console.log('[net] reconnect parked', { attempt: this.attempt })
      this.options.emitLog('Reconnect parked', `Stopped after ${this.attempt} failed attempts`)
      return
    }
    const delayMs = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)]!
    this.attempt++
    console.log('[net] scheduleReconnect', { delayMs, attempt: this.attempt })
    this.options.emitLog(`Reconnect scheduled in ${delayMs}ms`, `Attempt ${this.attempt}`)
    this.timer = setTimeout(() => {
      this.timer = null
      this.options.openConnection()
    }, delayMs)
  }

  redialNow(resetAttempts: boolean): void {
    this.cancel()
    if (resetAttempts || this.parked) {
      this.attempt = 0
    }
    this.parked = false
    this.options.openConnection()
  }

  hasTimer(): boolean {
    return this.timer !== null
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
