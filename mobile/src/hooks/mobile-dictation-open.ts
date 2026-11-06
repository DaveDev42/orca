import { dictationSessionErrorMessage } from '../dictation/mobile-dictation-setup'
import type { DictationCapture } from '../platform/dictation-capture-contract'

// Opens the microphone for a start; false when the start was superseded or disabled while it opened (nothing is left held).
export async function openMobileDictationCapture(
  capture: DictationCapture,
  start: {
    generation: number
    getGeneration: () => number
    getEnabled: () => boolean
    setIdle: () => void
  }
): Promise<boolean> {
  let opened
  try {
    opened = await capture.open()
  } catch (err) {
    // Stale refusal must neither idle the replacement nor toast over the closure already reported by disable.
    if (start.getGeneration() !== start.generation || !start.getEnabled()) {
      return false
    }
    // A page without audio grants can refuse capture; return to idle before rethrowing its message so starting cannot get stuck.
    start.setIdle()
    throw err instanceof Error ? err : new Error(String(err))
  }
  if (start.getGeneration() !== start.generation || !start.getEnabled()) {
    capture.release()
    if (start.getGeneration() === start.generation) {
      start.setIdle()
    }
    return false
  }
  if (!opened.ok) {
    start.setIdle()
    throw new Error(dictationSessionErrorMessage(opened.reason))
  }
  return true
}
