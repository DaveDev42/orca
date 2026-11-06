import type { MutableRefObject } from 'react'

// Runs once at a time: while one run is pending, callers get its promise.
export function joinInFlight(
  slot: MutableRefObject<Promise<void> | null>,
  run: () => Promise<void>
): Promise<void> {
  if (slot.current) {
    return slot.current
  }
  const pending = run().finally(() => {
    slot.current = null
  })
  slot.current = pending
  return pending
}
