// The microphone goes live at the tap, so speech said while the host starts its session must reach the host in order, and must never leak when the start ends.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeRpcClient,
  type FakeRpcClient,
  type SentRequest
} from '../mobile-web-shell/bridge-host-test-fakes'
import type {
  DictationCapture,
  DictationCaptureChunk
} from '../platform/dictation-capture-contract'

type Seam = {
  chunkHandlers: Set<(chunk: DictationCaptureChunk) => void>
  calls: string[]
}

const seam = vi.hoisted((): Seam => ({ chunkHandlers: new Set(), calls: [] }))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'ios' }
}))

vi.mock('../platform/dictation-capture', () => {
  const capture: DictationCapture = {
    open: async () => ({ ok: true }),
    begin: () => {
      seam.calls.push('begin')
      return true
    },
    end: async () => {
      seam.calls.push('end')
    },
    release: () => {},
    onChunk: (handler) => {
      seam.chunkHandlers.add(handler)
      return { remove: () => void seam.chunkHandlers.delete(handler) }
    },
    onInterruption: () => ({ remove: () => {} })
  }
  return { useDictationCapture: () => capture }
})

import { useMobileDictation, type UseMobileDictationResult } from './use-mobile-dictation'

const held: { dictation: UseMobileDictationResult | null } = { dictation: null }
const errors: Error[] = []

function mount(client: FakeRpcClient): void {
  function Probe(): null {
    held.dictation = useMobileDictation({
      client,
      enabled: true,
      onTranscript: () => {},
      onError: (err) => errors.push(err)
    })
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
}

function dictation(): UseMobileDictationResult {
  if (held.dictation === null) {
    throw new Error('nothing mounted')
  }
  return held.dictation
}

function hear(...bytes: number[]): void {
  for (const handler of seam.chunkHandlers) {
    handler({ data: Uint8Array.from(bytes), droppedBytes: 0 })
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await Promise.resolve()
  }
}

function startRequest(rpc: FakeRpcClient): SentRequest {
  const request = rpc.requests.find((r) => r.method === 'speech.dictation.start')
  if (!request) {
    throw new Error('start request not sent')
  }
  return request
}

function ackStart(rpc: FakeRpcClient): void {
  startRequest(rpc).resolve({ id: 'desktop', ok: true, result: {} })
}

// Cancel requests wait on a reply too; answer everything except the start, which each test controls.
function answerCancels(rpc: FakeRpcClient): void {
  for (const request of rpc.requests) {
    if (request.method === 'speech.dictation.cancel') {
      request.resolve({ id: 'desktop', ok: true, result: {} })
    }
  }
}

function chunkRequests(rpc: FakeRpcClient): { audioBase64: unknown; seq: unknown }[] {
  const chunks: { audioBase64: unknown; seq: unknown }[] = []
  for (const request of rpc.requests) {
    const params = request.args[1]
    if (
      request.method === 'speech.dictation.chunk' &&
      typeof params === 'object' &&
      params !== null &&
      'audioBase64' in params &&
      'seq' in params
    ) {
      chunks.push({ audioBase64: params.audioBase64, seq: params.seq })
    }
  }
  return chunks
}

const b64 = (...bytes: number[]) => Buffer.from(bytes).toString('base64')

beforeEach(() => {
  seam.chunkHandlers.clear()
  seam.calls.length = 0
  held.dictation = null
  errors.length = 0
})

describe('speech heard while the host is starting', () => {
  it('turns the microphone on before the start request is answered, and shows starting', async () => {
    const rpc = createFakeRpcClient()
    mount(rpc)
    await act(async () => {
      void dictation().start()
      await flushMicrotasks()
    })
    expect(seam.calls).toEqual(['begin'])
    expect(startRequest(rpc)).toBeDefined()
    expect(dictation().status).toBe('starting')
  })

  it('is sent in order after the ack, ahead of speech heard afterwards', async () => {
    const rpc = createFakeRpcClient()
    mount(rpc)
    await act(async () => {
      void dictation().start()
      await flushMicrotasks()
      hear(1, 2)
      hear(3, 4)
      hear(5)
    })
    // Held back: the host has not acknowledged the session yet.
    expect(chunkRequests(rpc)).toEqual([])
    await act(async () => {
      ackStart(rpc)
      await flushMicrotasks()
      hear(6, 7)
    })
    expect(dictation().status).toBe('recording')
    expect(chunkRequests(rpc)).toEqual([
      expect.objectContaining({ audioBase64: b64(1, 2, 3, 4, 5), seq: 0 }),
      expect.objectContaining({ audioBase64: b64(6, 7), seq: 1 })
    ])
  })

  it('is dropped when the start fails, and nothing is sent afterwards', async () => {
    const rpc = createFakeRpcClient()
    mount(rpc)
    let outcome: Promise<void> = Promise.resolve()
    await act(async () => {
      outcome = dictation().start()
      outcome.catch(() => {})
      await flushMicrotasks()
      hear(1, 2, 3)
    })
    await act(async () => {
      startRequest(rpc).reject(new Error('worker failed to load'))
      await flushMicrotasks()
      answerCancels(rpc)
      await flushMicrotasks()
    })
    await expect(outcome).rejects.toThrow('worker failed to load')
    expect(seam.calls).toContain('end')
    expect(dictation().status).toBe('idle')
    // A chunk arriving after the failure has nowhere to go.
    await act(async () => {
      hear(9)
      await flushMicrotasks()
    })
    expect(chunkRequests(rpc)).toEqual([])
  })

  it('is dropped when the user cancels while starting', async () => {
    const rpc = createFakeRpcClient()
    mount(rpc)
    await act(async () => {
      void dictation().start()
      await flushMicrotasks()
      hear(1, 2, 3)
      const cancelled = dictation().cancel()
      await flushMicrotasks()
      answerCancels(rpc)
      await cancelled
    })
    await act(async () => {
      ackStart(rpc)
      await flushMicrotasks()
    })
    expect(chunkRequests(rpc)).toEqual([])
    expect(dictation().status).toBe('idle')
  })

  it('fails the dictation instead of growing past five seconds of audio', async () => {
    const rpc = createFakeRpcClient()
    mount(rpc)
    const fiveSeconds = 16_000 * 2 * 5
    await act(async () => {
      void dictation().start()
      await flushMicrotasks()
      handlerFeed(fiveSeconds)
      hear(1)
      await flushMicrotasks()
      answerCancels(rpc)
      await flushMicrotasks()
    })
    expect(errors.map((e) => e.message)).toEqual([
      'Connection is too slow for voice dictation. Try again when the connection improves.'
    ])
    expect(seam.calls).toContain('end')
    expect(chunkRequests(rpc)).toEqual([])
  })
})

function handlerFeed(totalBytes: number): void {
  const piece = 1024
  for (let sent = 0; sent < totalBytes; sent += piece) {
    for (const handler of seam.chunkHandlers) {
      handler({ data: new Uint8Array(Math.min(piece, totalBytes - sent)), droppedBytes: 0 })
    }
  }
}
