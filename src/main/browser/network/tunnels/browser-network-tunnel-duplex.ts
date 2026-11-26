import { Duplex } from 'node:stream'
import type { BrowserNetworkTunnelClientSocketCallbacks } from '../../../../shared/browser/network/tunnels/browser-network-tunnel-client-socket'
import { BROWSER_NETWORK_TUNNEL_INITIAL_WINDOW_BYTES } from '../../../../shared/browser/network/tunnels/browser-network-tunnel-stream-state'

type BrowserNetworkTunnelDuplexOptions = BrowserNetworkTunnelClientSocketCallbacks

export class BrowserNetworkTunnelDuplex extends Duplex {
  private readonly options: BrowserNetworkTunnelDuplexOptions

  constructor(options: BrowserNetworkTunnelDuplexOptions) {
    super({
      allowHalfOpen: true,
      readableHighWaterMark: BROWSER_NETWORK_TUNNEL_INITIAL_WINDOW_BYTES
    })
    // Retirement can emit errors before consumers attach; unhandled 'error' events crash Node.
    this.on('error', () => {})
    this.options = options
  }

  // The shared client hands over plain Uint8Arrays it owns; Node's readable side wants Buffers.
  override push(chunk: Uint8Array<ArrayBufferLike> | null, encoding?: BufferEncoding): boolean {
    return super.push(
      chunk === null || Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      encoding
    )
  }

  override _read(): void {
    this.options.requestRead()
  }

  settleRead(bytes: number): void {
    this.options.consumeReadBytes(bytes)
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.options.writeBytes(chunk, callback)
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.options.finishWrite(callback)
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.options.destroyStream(error, callback)
  }
}
