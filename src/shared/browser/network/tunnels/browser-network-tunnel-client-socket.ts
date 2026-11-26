import type { BrowserNetworkTunnelFlowControl } from './browser-network-tunnel-stream-state'

/**
 * What the shared tunnel client needs from the byte stream it hands a caller. Node's Duplex
 * satisfies it on desktop; the phone supplies a plain object, so nothing here may name node:*.
 */
export type BrowserNetworkTunnelClientSocket = {
  readonly destroyed: boolean
  /** Delivers destination bytes to the reader; false asks the client to stop until the next read request. */
  push(bytes: Uint8Array<ArrayBufferLike> | null): boolean
  end(): unknown
  destroy(error?: Error): unknown
  /** Fires once the reader has taken every byte pushed before the end-of-stream marker. */
  once(event: 'end', listener: () => void): unknown
}

/** The client's side of a stream; the socket factory wires these to its read/write/close hooks. */
export type BrowserNetworkTunnelClientSocketCallbacks = {
  writeBytes: (bytes: Uint8Array<ArrayBufferLike>, callback: (error?: Error | null) => void) => void
  requestRead: () => void
  consumeReadBytes: (bytes: number) => void
  finishWrite: (callback: (error?: Error | null) => void) => void
  destroyStream: (error: Error | null, callback: (error?: Error | null) => void) => void
}

export type BrowserNetworkTunnelClientSocketFactory<
  TSocket extends BrowserNetworkTunnelClientSocket
> = (callbacks: BrowserNetworkTunnelClientSocketCallbacks) => TSocket

export type BrowserNetworkTunnelClientCoreOptions<
  TSocket extends BrowserNetworkTunnelClientSocket
> = {
  tunnelGeneration: number
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean
  /** Builds the byte stream `open` resolves to; Node's Duplex on desktop, a plain object on the phone. */
  createSocket: BrowserNetworkTunnelClientSocketFactory<TSocket>
  /** Charged for bytes the client buffers; a structural subset of the outbound memory lease. */
  outboundMemory?: { claimApplicationBytes: (bytes: number) => (() => void) | null }
  maxStreamIds?: number
  flowControl?: BrowserNetworkTunnelFlowControl
  onClosed?: (error: Error) => void
  now?: () => number
}
