// Dictation that ended on its own presses the composer's Send once its words are in the draft.
// The composer owns the draft and the send, so it registers here; the host only asks.

type AutoSendHandler = (text: string) => void

const handlers = new Map<string, AutoSendHandler>()

/** The composer for this draft scope takes the request; a later registration for the scope replaces it. */
export function registerMobileDictationAutoSend(
  scope: string,
  handler: AutoSendHandler
): () => void {
  handlers.set(scope, handler)
  return () => {
    if (handlers.get(scope) === handler) {
      handlers.delete(scope)
    }
  }
}

/** False when no composer shows that draft, so nothing was sent. */
export function requestMobileDictationAutoSend(scope: string, text: string): boolean {
  const handler = handlers.get(scope)
  if (!handler || text.trim() === '') {
    return false
  }
  handler(text)
  return true
}
