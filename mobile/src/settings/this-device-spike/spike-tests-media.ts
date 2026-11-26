import {
  isRecord,
  proxySaw,
  verdict,
  waitPage,
  type PageMessage,
  type SpikeResult,
  type SpikeTestDefinition
} from './spike-test-helpers'

export const runHls: SpikeTestDefinition['run'] = async (context) => {
  const mark = context.entryMark()
  const eventMark = context.events.length
  await context.loadPage('hls')
  const message = await waitPage(context, eventMark, 'hls', 45000)
  await context.sleep(300)
  if (!message) {
    return verdict(false, 'page never reported')
  }
  const entries = context.entriesSince(mark)
  const seen = proxySaw(entries, 'devstreaming-cdn.apple.com:443')
  const played = message.ok === true
  return verdict(
    played && seen,
    `${played ? 'played' : 'did not play'} (${String(message.why)}, t=${String(message.time)}s, readyState=${String(message.readyState)}, error=${String(message.errorCode)}); proxy saw devstreaming-cdn.apple.com:443 = ${seen}${played && !seen ? ' (video BYPASSED the proxy)' : ''}`
  )
}

type Candidate = { type?: string; protocol?: string; address?: string }

function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item: unknown): Candidate[] => {
    if (!isRecord(item)) {
      return []
    }
    return [
      { type: String(item.type), protocol: String(item.protocol), address: String(item.address) }
    ]
  })
}

export function judgeWebRtc(message: PageMessage, blockExpected: boolean): SpikeResult {
  const candidates = readCandidates(message.candidates)
  const summary = candidates.map((c) => `${c.type}/${c.protocol}/${c.address}`).join(', ') || 'none'
  const ip = message.ipifyIp
    ? `proxied IP seen by ipify ${String(message.ipifyIp)}`
    : `ipify ${String(message.ipifyErr ?? 'n/a')}`
  if (blockExpected) {
    const gone = message.hasRTC === false
    return verdict(
      gone,
      `${gone ? 'RTCPeerConnection removed' : 'RTCPeerConnection STILL EXISTS'}; candidates: ${summary}; ${ip}`
    )
  }
  if (message.hasRTC === false) {
    return verdict(true, `no RTCPeerConnection in this WebView; ${ip}`)
  }
  const leaked = candidates.length > 0
  return verdict(
    !leaked,
    `${leaked ? 'LEAK: ICE gathered over UDP outside the proxy' : 'no candidates gathered'}; candidates: ${summary}; ${ip}`
  )
}

export const runWebRtc =
  (block: boolean): SpikeTestDefinition['run'] =>
  async (context) => {
    await context.setBlockWebRTC(block)
    const eventMark = context.events.length
    await context.loadPage('webrtc')
    const message = await waitPage(context, eventMark, 'webrtc', 30000)
    await context.setBlockWebRTC(false)
    return message ? judgeWebRtc(message, block) : verdict(false, 'page never reported')
  }

function formatThroughput(label: string, message: PageMessage | null, chunks: number): string {
  if (!message) {
    return `${label}: no report`
  }
  if (message.ok !== true) {
    return `${label}: FAILED ${String(message.err ?? `got ${String(message.bytes)} bytes`)}`
  }
  const ping =
    message.pingMedianMs === undefined
      ? ''
      : `, ping median ${String(message.pingMedianMs)} ms max ${String(message.pingMaxMs)} ms`
  return `${label}: ${String(message.mbps)} MB/s (${String(message.ms)} ms, first byte ${String(message.ttfbMs)} ms${ping})${chunks > 0 ? `, ${chunks} chunks via JS` : ''}`
}

export const runThroughput =
  (source: 'local' | 'public'): SpikeTestDefinition['run'] =>
  async (context) => {
    if (source === 'local' && !context.isLocalReachable()) {
      return { status: 'skip', detail: 'localhost not loadable in this WebView' }
    }
    const lines: string[] = []
    let ok = true
    let jsChunks = 0
    const mark = context.entryMark()
    for (const mode of ['native', 'js'] as const) {
      context.setEgress(mode)
      await context.sleep(300)
      const before = context.jsChunkCount()
      const eventMark = context.events.length
      await context.loadPage('throughput', `?src=${source}&n=20000000&mode=${mode}`)
      const message = await waitPage(context, eventMark, 'throughput', 150000)
      const chunks = context.jsChunkCount() - before
      if (mode === 'js') {
        jsChunks = chunks
      }
      lines.push(formatThroughput(mode === 'js' ? 'via JS' : 'native', message, chunks))
      if (!message || message.ok !== true) {
        ok = false
      }
    }
    context.setEgress('native')
    const host = source === 'public' ? 'speed.cloudflare.com:443' : `localhost:${context.localPort}`
    const seen = proxySaw(context.entriesSince(mark), host)
    return verdict(
      ok && jsChunks > 0 && seen,
      `${lines.join(' | ')}; proxy saw ${host} = ${seen}; JS chunks used = ${jsChunks}`
    )
  }
