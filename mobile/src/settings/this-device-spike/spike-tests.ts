import {
  runAuth,
  runDownload,
  runHttps,
  runLocalhost,
  runServerTrust,
  runWebSocket
} from './spike-tests-network'
import { runHls, runThroughput, runWebRtc } from './spike-tests-media'
import type { SpikeTestDefinition } from './spike-test-helpers'

export { judgeWebRtc } from './spike-tests-media'
export { parsePageMessage, proxySaw } from './spike-test-helpers'
export type {
  SpikeContext,
  SpikeResult,
  SpikeStatus,
  SpikeTestDefinition
} from './spike-test-helpers'

export const SPIKE_TESTS: readonly SpikeTestDefinition[] = [
  {
    id: 'localhost',
    title: '1. localhost and 127.0.0.1 go through the proxy',
    decides: 'If FAIL (bypassed), dev-server tabs must stay on streaming.',
    run: runLocalhost
  },
  {
    id: 'https',
    title: '2a. https://example.com through the proxy',
    decides: 'Basic CONNECT path works at all.',
    run: runHttps
  },
  {
    id: 'auth',
    title: '2b. 407 auth reliability (5 cold hosts)',
    decides: 'If FAIL, the credential scheme cannot be trusted: hold the feature.',
    run: runAuth
  },
  {
    id: 'websocket',
    title: '3a. WebSocket echo through the proxy',
    decides: 'If bypassed, WebSocket traffic leaks outside the tunnel.',
    run: runWebSocket
  },
  {
    id: 'hls',
    title: '3b. HLS video (bipbop) through the proxy',
    decides: 'If bypassed, media needs to be blocked or kept on streaming.',
    run: runHls
  },
  {
    id: 'download',
    title: '3c. Downloads (public 10 MB, local 10 MB)',
    decides: 'Downloads honor the proxy.',
    run: runDownload
  },
  {
    id: 'webrtc',
    title: '4a. WebRTC leak (no blocking script)',
    decides: 'FAIL = WebRTC reaches the network outside the proxy: the block script is required.',
    run: runWebRtc(false)
  },
  {
    id: 'webrtc-block',
    title: '4b. WebRTC with the blocking user script',
    decides: 'PASS = the document-start script is enough to stop the leak.',
    run: runWebRtc(true)
  },
  {
    id: 'throughput-local',
    title: '5a. Throughput, local 20 MB source: native vs via JS',
    decides: 'Pure proxy and JS-bridge cost, no internet noise. Compare the two MB/s.',
    run: runThroughput('local')
  },
  {
    id: 'throughput-public',
    title: '5b. Throughput, Cloudflare 20 MB: native vs via JS',
    decides: 'Real-world download speed through the proxy in both modes.',
    run: runThroughput('public')
  },
  {
    id: 'servertrust',
    title: 'extra. Server-trust challenge reaches the delegate',
    decides: 'Whether per-environment trust anchors (TITAN) are possible later.',
    run: runServerTrust
  }
]
