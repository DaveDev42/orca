export type SpikeEvent = { kind: string; at: number } & Record<string, unknown>

/** Native events in arrival order, with waiters that resolve on the first event after a mark that matches. */
export class SpikeEventLog {
  private events: SpikeEvent[] = []
  private waiters = new Set<() => void>()

  get length(): number {
    return this.events.length
  }

  push(payload: Record<string, unknown>): void {
    this.events.push({ ...payload, kind: String(payload.kind ?? 'unknown'), at: Date.now() })
    for (const waiter of this.waiters) {
      waiter()
    }
  }

  since(mark: number): SpikeEvent[] {
    return this.events.slice(mark)
  }

  wait(
    mark: number,
    predicate: (event: SpikeEvent) => boolean,
    timeoutMs: number
  ): Promise<SpikeEvent | null> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const check = (): boolean => {
        const hit = this.events.slice(mark).find(predicate)
        if (!hit) {
          return false
        }
        this.waiters.delete(check)
        if (timer) {
          clearTimeout(timer)
        }
        resolve(hit)
        return true
      }
      if (check()) {
        return
      }
      this.waiters.add(check)
      timer = setTimeout(() => {
        this.waiters.delete(check)
        resolve(null)
      }, timeoutMs)
    })
  }
}
