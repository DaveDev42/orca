import { useContext, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { MobileDictationStopContext } from '../../mobile-dictation-stop-context'
import type { MobileNativeChatSendIntent } from '../mobile-native-chat-send'

type PendingSend = {
  intent: MobileNativeChatSendIntent | undefined
  keepFocus: boolean
  surfaceGeneration: number
}

// Send tapped while dictation is recording or transcribing: stop it, wait for the words to land in the draft, then send once.
export function useMobileNativeChatComposerDictationSend({
  editing,
  micActive,
  micStarting,
  micProcessing,
  sendReady,
  hasContent,
  surfaceGenerationRef,
  mountedRef,
  sendingRef,
  deliver
}: {
  editing: boolean
  micActive: boolean
  micStarting: boolean
  micProcessing: boolean
  /** Nothing but an empty draft would stop a send right now. */
  sendReady: boolean
  hasContent: boolean
  surfaceGenerationRef: MutableRefObject<number>
  mountedRef: MutableRefObject<boolean>
  sendingRef: MutableRefObject<boolean>
  deliver: (intent: MobileNativeChatSendIntent | undefined, keepFocus: boolean) => Promise<void>
}) {
  const stopDictation = useContext(MobileDictationStopContext)
  const [awaiting, setAwaiting] = useState(false)
  const [settled, setSettled] = useState(0)
  const pendingRef = useRef<PendingSend | null>(null)
  // Words still being spoken or transcribed count as content: they land in the draft before the send. A starting mic has none yet.
  const busy = !editing && stopDictation !== null && ((micActive && !micStarting) || micProcessing)

  // Runs on the render that carries the transcript, so it sends the draft as it now reads.
  useEffect(() => {
    const pending = pendingRef.current
    if (settled === 0 || !pending) {
      return
    }
    pendingRef.current = null
    setAwaiting(false)
    if (
      pending.surfaceGeneration === surfaceGenerationRef.current &&
      sendReady &&
      hasContent &&
      !sendingRef.current
    ) {
      void deliver(pending.intent, pending.keepFocus)
    }
    // Only a settled dictation may trigger this; other renders must leave the pending send alone.
  }, [settled])

  // True when the tap was taken over: it waits for dictation instead of sending now.
  const request = (intent: MobileNativeChatSendIntent | undefined, keepFocus: boolean): boolean => {
    if (!busy || !stopDictation) {
      return false
    }
    pendingRef.current = { intent, keepFocus, surfaceGeneration: surfaceGenerationRef.current }
    setAwaiting(true)
    // A failed or empty transcript was already reported by dictation; the draft as it stands still goes out.
    void stopDictation()
      .catch(() => undefined)
      .finally(() => {
        if (mountedRef.current) {
          setSettled((count) => count + 1)
        }
      })
    return true
  }

  return { busy, awaiting, request }
}
