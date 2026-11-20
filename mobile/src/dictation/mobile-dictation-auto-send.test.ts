import { describe, expect, it, vi } from 'vitest'
import {
  registerMobileDictationAutoSend,
  requestMobileDictationAutoSend
} from './mobile-dictation-auto-send'

describe('mobile dictation auto-send registry', () => {
  it('hands the text to the composer registered for the scope', () => {
    const handler = vi.fn()
    const off = registerMobileDictationAutoSend('chat-a', handler)
    expect(requestMobileDictationAutoSend('chat-a', 'hello there')).toBe(true)
    expect(handler).toHaveBeenCalledWith('hello there')
    off()
    expect(requestMobileDictationAutoSend('chat-a', 'hello there')).toBe(false)
  })

  it('sends nothing for empty text or an unknown scope', () => {
    const handler = vi.fn()
    const off = registerMobileDictationAutoSend('chat-b', handler)
    expect(requestMobileDictationAutoSend('chat-b', '   ')).toBe(false)
    expect(requestMobileDictationAutoSend('chat-c', 'hi')).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('keeps a newer registration when an older one unregisters late', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = registerMobileDictationAutoSend('chat-d', first)
    const offSecond = registerMobileDictationAutoSend('chat-d', second)
    offFirst()
    expect(requestMobileDictationAutoSend('chat-d', 'x')).toBe(true)
    expect(second).toHaveBeenCalledWith('x')
    expect(first).not.toHaveBeenCalled()
    offSecond()
  })
})
