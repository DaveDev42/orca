// A composer taking focus is the earliest sign of a dictation. The live dictation hook registers what to warm
// (the microphone engine, the recognizer's status) and the composer calls prewarm from its focus handler.
let warm: (() => void) | null = null

export function registerMobileDictationPrewarm(prewarm: () => void): () => void {
  warm = prewarm
  return () => {
    if (warm === prewarm) {
      warm = null
    }
  }
}

export function prewarmMobileDictation(): void {
  try {
    warm?.()
  } catch {
    // Warming is best effort; the tap does the real work.
  }
}
