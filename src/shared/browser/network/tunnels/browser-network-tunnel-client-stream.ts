import type {
  BrowserNetworkTunnelClientSocket,
  BrowserNetworkTunnelClientSocketCallbacks,
  BrowserNetworkTunnelClientSocketFactory
} from './browser-network-tunnel-client-socket'
import type { BrowserNetworkTunnelSourceFlowStream } from './browser-network-tunnel-source-flow'
import type { BrowserNetworkTunnelSourceReceiveStream } from './browser-network-tunnel-source-receive-flow'
import {
  BROWSER_NETWORK_TUNNEL_CONNECT_TIMEOUT_MS,
  BROWSER_NETWORK_TUNNEL_INITIAL_WINDOW_BYTES
} from './browser-network-tunnel-stream-state'

export type BrowserNetworkTunnelClientStream<
  TSocket extends BrowserNetworkTunnelClientSocket = BrowserNetworkTunnelClientSocket
> = BrowserNetworkTunnelSourceFlowStream &
  BrowserNetworkTunnelSourceReceiveStream & {
    id: number
    socket: TSocket
    closed: boolean
    localEnded: boolean
    localHalfCloseSent: boolean
    remoteClosed: boolean
    connectTimeout: ReturnType<typeof setTimeout>
    resolveOpen: (socket: TSocket) => void
    rejectOpen: (error: Error) => void
  }

type BrowserNetworkTunnelClientStreamCallbacks<TSocket extends BrowserNetworkTunnelClientSocket> =
  BrowserNetworkTunnelClientSocketCallbacks & {
    onConnectTimeout: (stream: BrowserNetworkTunnelClientStream<TSocket>) => void
  }

export function createBrowserNetworkTunnelClientStream<
  TSocket extends BrowserNetworkTunnelClientSocket
>(
  id: number,
  windowBytes: number,
  createSocket: BrowserNetworkTunnelClientSocketFactory<TSocket>,
  callbacks: BrowserNetworkTunnelClientStreamCallbacks<TSocket>
): { stream: BrowserNetworkTunnelClientStream<TSocket>; opening: Promise<TSocket> } {
  let resolveOpen = (_socket: TSocket): void => {}
  let rejectOpen = (_error: Error): void => {}
  const opening = new Promise<TSocket>((resolve, reject) => {
    resolveOpen = resolve
    rejectOpen = reject
  })
  const socket = createSocket(callbacks)
  const stream: BrowserNetworkTunnelClientStream<TSocket> = {
    id,
    socket,
    windowBytes,
    receiveWindowBytes: BROWSER_NETWORK_TUNNEL_INITIAL_WINDOW_BYTES,
    opened: false,
    closed: false,
    localEnded: false,
    localHalfCloseSent: false,
    remoteEnded: false,
    remoteClosed: false,
    readableEnded: false,
    sendCredit: 0,
    receiveCredit: BROWSER_NETWORK_TUNNEL_INITIAL_WINDOW_BYTES,
    pendingToSocket: [],
    pendingToSocketBytes: 0,
    unsettledToSocket: [],
    readableDemand: false,
    pendingWrites: [],
    pendingWriteBytes: 0,
    connectTimeout: setTimeout(
      () => callbacks.onConnectTimeout(stream),
      BROWSER_NETWORK_TUNNEL_CONNECT_TIMEOUT_MS
    ),
    resolveOpen,
    rejectOpen
  }
  return { stream, opening }
}
