import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDictationCapture } from '../platform/dictation-capture'
import { dictationSessionErrorMessage } from '../dictation/mobile-dictation-setup'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useMobileDictationMeter } from './mobile-dictation-meter'
import { useMobileDictationLifecycle } from './use-mobile-dictation-lifecycle'
import { MobileDictationPendingAudioBudget } from './mobile-dictation-pending-audio-budget'
import { joinInFlight } from './mobile-dictation-in-flight'
import { openMobileDictationCapture } from './mobile-dictation-open'
import { MobileDictationPrebuffer } from './mobile-dictation-prebuffer'
import {
  useMobileDictationTranscriptSoFar,
  sendAcrossConnectionMove,
  subscribeMobileDictationAudioChunks
} from './mobile-dictation-audio-chunk'
import {
  DICTATION_FINISH_TIMEOUT_MS,
  createMobileDictationId,
  isCurrentMobileDictationFinish
} from './mobile-dictation-session-state'
import {
  cancelDesktopDictation,
  startMobileDictationDesktopSession
} from './mobile-dictation-desktop-start'
import { translate } from '../i18n/mobile-i18n'
import { dictationSessionFinish } from '../dictation/mobile-dictation-operations'
import { rpcPayloadMember } from '../transport/rpc-reader-payload'
import type { DictationCaptureChunk } from '../platform/dictation-capture-contract'
import type {
  DictationStatus,
  UseMobileDictationOptions,
  UseMobileDictationResult
} from './mobile-dictation-session-state'

export type { UseMobileDictationResult } from './mobile-dictation-session-state'

export function useMobileDictation(options: UseMobileDictationOptions): UseMobileDictationResult {
  useMobileTranslation()
  const { client, enabled, onTranscript, onError } = options
  // Both capture seams hold the screen while the microphone is open; native uses the device directly and page uses shell audio verbs.
  const capture = useDictationCapture()
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcriptSoFar, setTranscriptSoFar, keptTranscript] = useMobileDictationTranscriptSoFar()
  // Read from an abort that may run between a commit and its passive Effects, where state is stale.
  const statusRef = useRef<DictationStatus>('idle')
  const activeIdRef = useRef<string | null>(null)
  const clientRef = useRef(client)
  const enabledRef = useRef(enabled)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const pendingChunksRef = useRef<Set<Promise<void>>>(new Set())
  const pendingAudioBudgetRef = useRef(new MobileDictationPendingAudioBudget())
  const acceptingChunksRef = useRef(false)
  // Audio heard between the tap and the host's start ack; null once the session is live or the start ended.
  const prebufferRef = useRef<MobileDictationPrebuffer | null>(null)
  const feedChunkRef = useRef<(chunk: DictationCaptureChunk) => void>(() => {})
  const finishRef = useRef<Promise<void> | null>(null)
  const generationRef = useRef(0)

  useLayoutEffect(() => {
    // Native audio events can arrive before passive Effects flush, but refs
    // should only expose options from a committed render.
    clientRef.current = client
    enabledRef.current = enabled
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [client, enabled, onTranscript, onError])

  const applyStatus = useCallback((next: DictationStatus) => {
    statusRef.current = next
    setStatus(next)
    // Kept through processing so the text so far stays in place until the final transcript replaces it in the same render.
    setTranscriptSoFar((text) => (next === 'recording' || next === 'processing' ? text : ''))
  }, [])

  const reportError = useCallback(
    (err: unknown) => {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized.message)
      applyStatus('error')
      onErrorRef.current?.(normalized)
    },
    [applyStatus]
  )

  const closeDictationAudio = useCallback(() => {
    acceptingChunksRef.current = false
    prebufferRef.current = null
    pendingChunksRef.current.clear()
    pendingAudioBudgetRef.current.reset()
    try {
      void capture.end()
    } catch (err) {
      // Cleanup must keep going when a synchronous seam throws, or the dictation state would leak.
      console.error('Failed to stop microphone recording', err)
    }
  }, [capture])

  const failActiveDictation = useCallback(
    (dictationId: string, err: unknown) => {
      const client = clientRef.current
      if (activeIdRef.current !== dictationId) {
        return
      }
      activeIdRef.current = null
      closeDictationAudio()
      if (client && dictationId) {
        void cancelDesktopDictation(client, dictationId)
      }
      const kept = keptTranscript.take(dictationId)
      if (kept) {
        onTranscriptRef.current(kept)
      }
      reportError(err)
    },
    [closeDictationAudio, reportError]
  )

  useEffect(() => {
    const source = {
      getClient: () => clientRef.current,
      getActiveId: () => activeIdRef.current,
      isAccepting: () => enabledRef.current && acceptingChunksRef.current,
      getPrebuffer: () => prebufferRef.current
    }
    const sub = subscribeMobileDictationAudioChunks(capture, source, {
      pendingChunks: pendingChunksRef.current,
      pendingAudioBudget: pendingAudioBudgetRef.current,
      failActiveDictation,
      transcriptSoFar: keptTranscript
    })
    feedChunkRef.current = sub.feed
    return () => sub.remove()
  }, [capture, failActiveDictation])

  const start = useCallback(async () => {
    const client = clientRef.current
    if (!client || !enabledRef.current || activeIdRef.current) {
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    setError(null)
    applyStatus('starting')
    const isOpen = await openMobileDictationCapture(capture, {
      generation,
      getGeneration: () => generationRef.current,
      getEnabled: () => enabledRef.current,
      setIdle: () => applyStatus('idle')
    })
    if (!isOpen) {
      return
    }

    const dictationId = createMobileDictationId()
    activeIdRef.current = dictationId
    // Unmute now and hold what is said while the host starts; a start RPC plus a cold worker can take seconds.
    prebufferRef.current = new MobileDictationPrebuffer()
    if (!capture.begin()) {
      activeIdRef.current = null
      closeDictationAudio()
      applyStatus('idle')
      throw new Error(
        translate(
          'hooks.dictationDesktopStart.recordingFailed',
          'Failed to start microphone recording'
        )
      )
    }

    await startMobileDictationDesktopSession({
      client,
      dictationId,
      generation,
      getCurrentGeneration: () => generationRef.current,
      getEnabled: () => enabledRef.current,
      getActiveId: () => activeIdRef.current,
      clearActiveId: (id) => {
        if (activeIdRef.current === id) {
          activeIdRef.current = null
        }
      },
      setIdle: () => applyStatus('idle'),
      commitRecordingStart: (hostDedupesResends) => {
        const held = prebufferRef.current
        prebufferRef.current = null
        acceptingChunksRef.current = true
        pendingChunksRef.current.clear()
        pendingAudioBudgetRef.current.reset(hostDedupesResends)
        // Replay in capture order before any live chunk: both run on this thread, so none can slip between.
        for (const data of held?.drain() ?? []) {
          feedChunkRef.current({ data, droppedBytes: 0 })
        }
        applyStatus('recording')
        return true
      },
      rollbackRecordingStart: () => {
        acceptingChunksRef.current = false
        prebufferRef.current = null
        pendingChunksRef.current.clear()
        pendingAudioBudgetRef.current.reset()
        void capture.end()
      }
    })
  }, [applyStatus, capture, closeDictationAudio])

  const runFinish = useCallback(
    async (emptyTranscriptMessage: string) => {
      const client = clientRef.current
      const dictationId = activeIdRef.current
      if (!client || !dictationId) {
        return
      }

      const generation = generationRef.current + 1
      generationRef.current = generation
      applyStatus('processing')
      const isCurrent = () =>
        isCurrentMobileDictationFinish(
          generationRef.current,
          generation,
          enabledRef.current,
          activeIdRef.current,
          dictationId
        )
      try {
        // Keep shutdown inside try for finally cleanup; accept its tail chunks and snapshot pending sends only after end settles, or finish can overtake the last audio.
        await capture.end()
        acceptingChunksRef.current = false
        await Promise.allSettled(Array.from(pendingChunksRef.current))
        if (!isCurrent()) {
          return
        }
        const finished = dictationSessionFinish.interpret(
          await sendAcrossConnectionMove(client, () =>
            dictationSessionFinish.request(
              client,
              { dictationId },
              { timeoutMs: DICTATION_FINISH_TIMEOUT_MS }
            )
          )
        )
        if (!isCurrent()) {
          return
        }
        const transcript = rpcPayloadMember(finished, 'text')
        const text = typeof transcript === 'string' ? transcript.trim() : ''
        activeIdRef.current = null
        pendingChunksRef.current.clear()
        pendingAudioBudgetRef.current.reset()
        applyStatus('idle')
        if (text) {
          onTranscriptRef.current(text)
        } else {
          reportError(new Error(emptyTranscriptMessage))
        }
      } catch (err) {
        failActiveDictation(dictationId, err)
      }
    },
    [applyStatus, capture, failActiveDictation]
  )

  // A second finish (a send tapped while transcribing) joins the one in flight instead of starting another.
  const finishDictation = useCallback(
    (emptyTranscriptMessage: string) =>
      joinInFlight(finishRef, () => runFinish(emptyTranscriptMessage)),
    [runFinish]
  )

  const stop = useCallback(
    () => finishDictation(dictationSessionErrorMessage('no-speech')),
    [finishDictation]
  )

  // Only the user’s own cancel (reason:null) ends silently; other interruptions call onError so the tap has a visible outcome.
  const abandonDictation = useCallback(
    async (reason: string | null) => {
      const client = clientRef.current
      const dictationId = activeIdRef.current
      const wasUnderway = statusRef.current === 'starting' || statusRef.current === 'recording'
      const generation = generationRef.current + 1
      generationRef.current = generation
      activeIdRef.current = null
      closeDictationAudio()
      if (client && dictationId) {
        await cancelDesktopDictation(client, dictationId)
      }
      // The cancel round trip may overlap a new recording; stale completion must neither report over it nor reset it.
      if (generationRef.current !== generation) {
        return
      }
      if (reason !== null && wasUnderway) {
        reportError(new Error(reason))
        return
      }
      applyStatus('idle')
      setError(null)
    },
    [applyStatus, closeDictationAudio, reportError]
  )

  const cancel = useCallback(() => abandonDictation(null), [abandonDictation])

  useMobileDictationLifecycle({
    capture,
    enabled,
    statusRef,
    activeIdRef,
    generationRef,
    clientRef,
    closeDictationAudio,
    finishDictation,
    abandonDictation
  })

  return {
    status,
    isStarting: status === 'starting',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    transcriptSoFar,
    error,
    start,
    stop,
    cancel,
    meter: useMobileDictationMeter(capture, status === 'recording')
  }
}
