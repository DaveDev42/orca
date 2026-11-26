// A composer taking focus is the earliest sign of a dictation. The live dictation hook registers what to warm
// (the recognizer's status only: never the audio session or microphone) and what to release when the composer loses
// focus. The composer calls these from its focus and blur handlers.
export type MobileDictationPrewarmHandlers = {
  readonly prewarm: () => void
  readonly releaseAudio: () => void
}

let handlers: MobileDictationPrewarmHandlers | null = null

export function registerMobileDictationPrewarm(next: MobileDictationPrewarmHandlers): () => void {
  handlers = next
  return () => {
    if (handlers === next) {
      handlers = null
    }
  }
}

export function prewarmMobileDictation(): void {
  try {
    handlers?.prewarm()
  } catch {
    // Warming is best effort; the tap does the real work.
  }
}

// Blur hands the audio session back now (unless a dictation is recording; its end starts the short grace period).
export function releaseMobileDictationAudio(): void {
  try {
    handlers?.releaseAudio()
  } catch {
    // Best effort; the grace timer releases it anyway.
  }
}
