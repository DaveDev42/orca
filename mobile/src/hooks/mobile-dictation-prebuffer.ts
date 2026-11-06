import {
  DICTATION_SAMPLE_RATE,
  PCM_BYTES_PER_SAMPLE
} from '../../../src/shared/rpc-contract/speech-params'

// Speech the phone holds while the desktop session is still starting (worker cold load, slow link).
export const MOBILE_DICTATION_PREBUFFER_MAX_SECONDS = 5

export const MOBILE_DICTATION_PREBUFFER_MAX_BYTES =
  DICTATION_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * MOBILE_DICTATION_PREBUFFER_MAX_SECONDS

// Native events are ~1 KB every 32 ms; replaying them one by one would burst ~150 requests. 500 ms batches match the page capture's drain size.
export const MOBILE_DICTATION_PREBUFFER_FLUSH_BYTES =
  (DICTATION_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE) / 2

// Microphone audio captured between the tap and the host's start ack, replayed in order once the session is live.
export class MobileDictationPrebuffer {
  private chunks: Uint8Array[] = []
  private bytes = 0

  constructor(private readonly maxBytes = MOBILE_DICTATION_PREBUFFER_MAX_BYTES) {}

  get bufferedBytes(): number {
    return this.bytes
  }

  // False when the chunk would pass the cap; the caller fails the dictation instead of silently losing the oldest speech.
  push(data: Uint8Array): boolean {
    if (this.bytes + data.byteLength > this.maxBytes) {
      return false
    }
    // Native events may reuse their backing store, so keep a copy.
    this.chunks.push(data.slice())
    this.bytes += data.byteLength
    return true
  }

  // Hands back the held audio coalesced into flush-sized chunks, byte order preserved, and empties the buffer.
  drain(flushBytes = MOBILE_DICTATION_PREBUFFER_FLUSH_BYTES): Uint8Array[] {
    const all = new Uint8Array(this.bytes)
    let offset = 0
    for (const chunk of this.chunks) {
      all.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.chunks = []
    this.bytes = 0
    const out: Uint8Array[] = []
    for (let start = 0; start < all.byteLength; start += flushBytes) {
      out.push(all.subarray(start, start + flushBytes))
    }
    return out
  }
}
