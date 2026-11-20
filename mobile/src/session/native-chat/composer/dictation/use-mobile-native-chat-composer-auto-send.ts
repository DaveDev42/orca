import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { registerMobileDictationAutoSend } from '../../../../dictation/mobile-dictation-auto-send'

// How long a dictation's Send request waits for its words to reach the draft before it is dropped.
const AUTO_SEND_WAIT_MS = 3000

// A dictation that ended on its own asks for Send; it waits for the words to show in the draft, then presses it once.
export function useMobileNativeChatComposerAutoSend(
  draftScopeKey: string | null | undefined,
  editing: boolean,
  value: string,
  canSend: boolean,
  send: () => unknown
): void {
  const sendRef = useRef(send)
  useLayoutEffect(() => {
    sendRef.current = send
  })
  const [requestedText, setRequestedText] = useState<string | null>(null)
  useEffect(() => {
    if (!draftScopeKey || editing) {
      return
    }
    return registerMobileDictationAutoSend(draftScopeKey, setRequestedText)
  }, [draftScopeKey, editing])
  useEffect(() => {
    if (requestedText === null) {
      return
    }
    if (canSend && value.includes(requestedText.trim())) {
      setRequestedText(null)
      void sendRef.current()
      return
    }
    const expired = setTimeout(() => setRequestedText(null), AUTO_SEND_WAIT_MS)
    return () => clearTimeout(expired)
  }, [requestedText, canSend, value])
}
