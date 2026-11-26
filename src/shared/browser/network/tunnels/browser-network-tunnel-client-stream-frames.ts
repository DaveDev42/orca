import {
  BrowserNetworkTunnelOpcode,
  decodeBrowserNetworkTunnelWindowUpdate,
  encodeBrowserNetworkTunnelWindowUpdate,
  type BrowserNetworkTunnelFrame
} from './browser-network-tunnel-protocol'
import { dispatchBrowserNetworkTunnelClientFrame } from './browser-network-tunnel-client-frame-dispatch'
import type { BrowserNetworkTunnelClientSocket } from './browser-network-tunnel-client-socket'
import type { BrowserNetworkTunnelClientStream } from './browser-network-tunnel-client-stream'
import {
  finishBrowserNetworkSourceData,
  queueBrowserNetworkSourceData
} from './browser-network-tunnel-source-receive-flow'

type BrowserNetworkTunnelClientStreamFrameActions<
  TSocket extends BrowserNetworkTunnelClientSocket
> = {
  send: (
    opcode: BrowserNetworkTunnelOpcode,
    streamId: number,
    payload?: Uint8Array<ArrayBufferLike>
  ) => boolean
  closeTunnel: (error: Error) => void
  flushWrites: (stream: BrowserNetworkTunnelClientStream<TSocket>) => void
  claimApplicationBytes: (bytes: number) => (() => void) | null
  retire: (stream: BrowserNetworkTunnelClientStream<TSocket>, error?: Error) => void
  fail: (stream: BrowserNetworkTunnelClientStream<TSocket>, error: Error) => void
}

export function handleBrowserNetworkTunnelClientStreamFrame<
  TSocket extends BrowserNetworkTunnelClientSocket
>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  frame: BrowserNetworkTunnelFrame,
  actions: BrowserNetworkTunnelClientStreamFrameActions<TSocket>
): void {
  dispatchBrowserNetworkTunnelClientFrame(frame, {
    opened: () => openedStream(stream, actions),
    grantCredit: () => grantStreamCredit(stream, frame.payload, actions),
    deliverData: () => deliverStreamData(stream, frame.payload, actions),
    halfClose: () => halfCloseStream(stream, actions.closeTunnel),
    close: () => closeStream(stream, actions),
    remoteFailure: (error) => actions.retire(stream, error),
    invalid: () =>
      actions.closeTunnel(new Error('Browser tunnel received an invalid stream transition'))
  })
}

function openedStream<TSocket extends BrowserNetworkTunnelClientSocket>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  actions: BrowserNetworkTunnelClientStreamFrameActions<TSocket>
): void {
  if (stream.opened) {
    actions.closeTunnel(new Error('Browser tunnel received a duplicate opened frame'))
    return
  }
  stream.opened = true
  clearTimeout(stream.connectTimeout)
  if (
    !actions.send(
      BrowserNetworkTunnelOpcode.WindowUpdate,
      stream.id,
      encodeBrowserNetworkTunnelWindowUpdate(stream.receiveWindowBytes)
    )
  ) {
    actions.closeTunnel(new Error('Browser tunnel transport rejected initial credit'))
    return
  }
  stream.resolveOpen(stream.socket)
}

function grantStreamCredit<TSocket extends BrowserNetworkTunnelClientSocket>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  payload: Uint8Array<ArrayBufferLike>,
  actions: BrowserNetworkTunnelClientStreamFrameActions<TSocket>
): void {
  const credit = decodeBrowserNetworkTunnelWindowUpdate(payload)
  if (!stream.opened || !credit || stream.sendCredit + credit > stream.windowBytes) {
    actions.closeTunnel(new Error('Browser tunnel received invalid stream credit'))
    return
  }
  stream.sendCredit += credit
  actions.flushWrites(stream)
}

function deliverStreamData<TSocket extends BrowserNetworkTunnelClientSocket>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  payload: Uint8Array<ArrayBufferLike>,
  actions: BrowserNetworkTunnelClientStreamFrameActions<TSocket>
): void {
  const result = queueBrowserNetworkSourceData(stream, payload, actions.claimApplicationBytes)
  // Valid credit can exceed the shared memory budget, so exhaustion must only fail its stream.
  if (result === 'budget_exhausted') {
    actions.fail(stream, new Error('Browser tunnel receive buffer overflow'))
  } else if (result === 'invalid') {
    actions.closeTunnel(new Error('Browser tunnel received invalid destination data'))
  }
}

function halfCloseStream<TSocket extends BrowserNetworkTunnelClientSocket>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  closeTunnel: (error: Error) => void
): void {
  if (!stream.opened || !finishBrowserNetworkSourceData(stream)) {
    closeTunnel(new Error('Browser tunnel received an invalid destination half-close'))
  }
}

function closeStream<TSocket extends BrowserNetworkTunnelClientSocket>(
  stream: BrowserNetworkTunnelClientStream<TSocket>,
  actions: BrowserNetworkTunnelClientStreamFrameActions<TSocket>
): void {
  if (!stream.opened || stream.remoteClosed) {
    actions.closeTunnel(new Error('Browser tunnel received an invalid destination close'))
    return
  }
  stream.remoteClosed = true
  stream.localEnded = true
  stream.socket.once('end', () => actions.retire(stream))
  if (!stream.remoteEnded) {
    finishBrowserNetworkSourceData(stream)
  }
  stream.socket.end()
}
