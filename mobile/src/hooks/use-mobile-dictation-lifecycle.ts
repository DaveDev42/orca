import { useEffect, type MutableRefObject } from 'react'
import { dictationSessionErrorMessage } from '../dictation/mobile-dictation-setup'
import { cancelDesktopDictation } from './mobile-dictation-desktop-start'
import type { DictationCapture } from '../platform/dictation-capture-contract'
import type { RpcClient } from '../transport/rpc-client'
import type { DictationStatus } from './mobile-dictation-session-state'

// What ends a dictation from outside the user's taps: the microphone being taken, the input closing, the screen unmounting.
export function useMobileDictationLifecycle({
  capture,
  enabled,
  statusRef,
  activeIdRef,
  generationRef,
  clientRef,
  closeDictationAudio,
  finishDictation,
  abandonDictation
}: {
  capture: DictationCapture
  enabled: boolean
  statusRef: MutableRefObject<DictationStatus>
  activeIdRef: MutableRefObject<string | null>
  generationRef: MutableRefObject<number>
  clientRef: MutableRefObject<RpcClient | null>
  closeDictationAudio: () => void
  finishDictation: (emptyTranscriptMessage: string) => Promise<void>
  abandonDictation: (reason: string | null) => Promise<void>
}): void {
  useEffect(() => {
    // Finish what was already streamed; only the user's own cancel may discard it.
    const sub = capture.onInterruption(() => {
      if (statusRef.current === 'recording') {
        void finishDictation(dictationSessionErrorMessage('interrupted'))
      } else if (statusRef.current === 'starting') {
        void abandonDictation(dictationSessionErrorMessage('interrupted'))
      }
    })
    return () => sub.remove()
  }, [abandonDictation, capture, finishDictation, statusRef])

  useEffect(() => {
    if (!enabled) {
      void abandonDictation(dictationSessionErrorMessage('input-closed'))
    }
  }, [abandonDictation, enabled])

  useEffect(() => {
    return () => {
      const dictationId = activeIdRef.current
      generationRef.current += 1
      activeIdRef.current = null
      closeDictationAudio()
      capture.release()
      if (clientRef.current && dictationId) {
        void cancelDesktopDictation(clientRef.current, dictationId)
      }
    }
  }, [activeIdRef, capture, clientRef, closeDictationAudio, generationRef])
}
