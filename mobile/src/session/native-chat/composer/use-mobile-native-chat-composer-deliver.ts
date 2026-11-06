import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import type { MobileNativeChatSendIntent } from '../mobile-native-chat-send'
import type { useMobileNativeChatComposerGoalMode } from './use-mobile-native-chat-composer-goal-mode'

// One delivery of the draft to the chat, fenced against the surface changing, the composer being edited, or unmounting while the host answers.
export function useMobileNativeChatComposerDeliver({
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  goal,
  value,
  onChangeText,
  onSend,
  resetCursor,
  editing
}: {
  sendSurfaceId: string
  getSendCompletionGeneration: () => number
  getComposerEditGeneration: () => number
  goal: ReturnType<typeof useMobileNativeChatComposerGoalMode>
  value: string
  onChangeText: (text: string) => void
  onSend: (text: string, intent?: MobileNativeChatSendIntent) => Promise<boolean>
  resetCursor: () => void
  editing: boolean
}) {
  const sendingRef = useRef(false)
  const mountedRef = useRef(true)
  const sendSurfaceIdRef = useRef(sendSurfaceId)
  const surfaceGenerationRef = useRef(0)
  useLayoutEffect(() => {
    if (sendSurfaceIdRef.current !== sendSurfaceId) {
      sendSurfaceIdRef.current = sendSurfaceId
      surfaceGenerationRef.current += 1
    }
  }, [sendSurfaceId])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      surfaceGenerationRef.current += 1
    }
  }, [])

  const deliver = async (intent?: MobileNativeChatSendIntent, keepFocus = false): Promise<void> => {
    if (goal.consumeBareGoal(value, () => onChangeText(''))) {
      return
    }
    sendingRef.current = true
    setSending(true)
    const sendSurfaceGeneration = surfaceGenerationRef.current
    const sendCompletionGeneration = getSendCompletionGeneration()
    const composerEditGeneration = getComposerEditGeneration()
    try {
      // Raw, not trimmed: the send seam owns the wire trim, and a rejection has
      // to hand the user back exactly what they typed (#14819).
      const accepted = await goal.send(onSend, value, intent)
      if (
        accepted &&
        mountedRef.current &&
        sendSurfaceGeneration === surfaceGenerationRef.current &&
        sendCompletionGeneration === getSendCompletionGeneration() &&
        composerEditGeneration === getComposerEditGeneration()
      ) {
        resetCursor()
        // Why: the turn is now the agent's — the keyboard would cover the reply.
        // A rejected send keeps it up so the handed-back draft stays editable.
        if (!editing && !keepFocus) {
          Keyboard.dismiss()
        }
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return { sending, sendingRef, mountedRef, surfaceGenerationRef, deliver }
}
