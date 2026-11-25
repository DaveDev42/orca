import { describe, expect, it, vi } from 'vitest'
import type { OnDeviceSpeech } from '../platform/speech/on-device-speech-contract'
import {
  MOBILE_DICTATION_HOST_ROUTE_TTL_MS,
  chooseMobileDictationRoute,
  peekMobileDictationHostRoute
} from './mobile-dictation-device-engine'

function speechWith(status: { preference: string; status: string }): OnDeviceSpeech {
  return {
    status: vi.fn(async () => status),
    start: vi.fn(),
    read: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn()
  } as unknown as OnDeviceSpeech
}

describe('peekMobileDictationHostRoute', () => {
  it('answers host at once without a recognizer', () => {
    expect(peekMobileDictationHostRoute(null)).toEqual({ kind: 'host' })
  })

  it('remembers a computer answer so the next start does not wait on the status', async () => {
    const speech = speechWith({ preference: 'computer', status: 'ready' })
    expect(peekMobileDictationHostRoute(speech)).toBeNull()
    await chooseMobileDictationRoute(speech)
    expect(peekMobileDictationHostRoute(speech)).toEqual({ kind: 'host' })
    expect(
      peekMobileDictationHostRoute(speech, Date.now() + MOBILE_DICTATION_HOST_ROUTE_TTL_MS + 1)
    ).toBeNull()
  })

  it('never remembers a phone route, and a later phone answer forgets the computer', async () => {
    const speech = speechWith({ preference: 'automatic', status: 'ready' })
    await chooseMobileDictationRoute(speech)
    expect(peekMobileDictationHostRoute(speech)).toBeNull()

    const switching = speechWith({ preference: 'computer', status: 'ready' })
    await chooseMobileDictationRoute(switching)
    expect(peekMobileDictationHostRoute(switching)).toEqual({ kind: 'host' })
    vi.mocked(switching.status).mockResolvedValueOnce({
      preference: 'automatic',
      status: 'ready'
    } as never)
    await chooseMobileDictationRoute(switching)
    expect(peekMobileDictationHostRoute(switching)).toBeNull()
  })

  it('does not trust another recognizer instance', async () => {
    await chooseMobileDictationRoute(speechWith({ preference: 'computer', status: 'ready' }))
    expect(peekMobileDictationHostRoute(speechWith({ preference: 'computer', status: 'ready' }))).toBeNull()
  })
})
