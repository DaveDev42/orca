import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import {
  encodeTerminalStreamFrame,
  readTerminalStreamFrameId,
  writeTerminalStreamFrameId
} from '../../shared/terminal-stream-protocol'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { RpcContext } from './rpc/core'
import type { RpcBinarySender } from './rpc/rpc-binary-sender'
import { allocateTerminalSubscriptionStreamId } from './rpc/methods/terminal/terminal-subscription-stream-id'
import type { TerminalSubscriptionRegistration } from './rpc/methods/terminal/terminal-subscription-registration'
import {
  isRecord,
  remoteLeafTerminalFailure,
  type RemoteLeafTerminalEnvironmentClient,
  type RemoteLeafTerminalIdentity,
  type RemoteLeafTerminalUpstream,
  type RemoteLeafTerminalUpstreamEvent
} from './remote-leaf-terminal-forwarding'

/**
 * Relays a paired client's `terminal.subscribe` for a `remote:` leaf to the environment that owns
 * the PTY, over the desktop's own connection to it. Resolves when the stream ends (either side) and
 * rejects with the environment's failure so the client sees it instead of an empty terminal.
 *
 * Why this and not MobileDesktopRelay (S2): S2 serves phones that address a server directly with
 * `executionHost` and needs the server to accept delegated phone devices. This path serves tabs the
 * desktop itself mirrors, so the phone keeps using desktop handles and any already-deployed server
 * works. The two never meet: S2 requests are routed before dispatch and never reach this handler.
 */
export function forwardRemoteLeafTerminalSubscribe(args: {
  client: RemoteLeafTerminalEnvironmentClient
  identity: RemoteLeafTerminalIdentity
  params: unknown
  registration: TerminalSubscriptionRegistration
  emit: (result: unknown) => void
  sendBinary?: RpcBinarySender
  registerBinaryStreamHandler?: RpcContext['registerBinaryStreamHandler']
}): Promise<void> {
  const { client, identity, registration, emit, sendBinary, registerBinaryStreamHandler } = args
  return new Promise<void>((resolve, reject) => {
    const desktopStreamIds = new Map<number, number>()
    const unregisterBinaryHandlers: (() => void)[] = []
    let upstream: RemoteLeafTerminalUpstream | null = null
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      for (const unregister of unregisterBinaryHandlers) {
        unregister()
      }
      upstream?.close()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    // Why: unsubscribe, a closed phone socket and slot replacement all release the registration.
    registration.setTeardown(() => finish())
    if (settled) {
      return
    }

    const desktopStreamId = (hostStreamId: number): number => {
      const known = desktopStreamIds.get(hostStreamId)
      if (known !== undefined) {
        return known
      }
      // Why the shared allocator: local and forwarded streams share the phone's desktop socket.
      const allocated = allocateTerminalSubscriptionStreamId()
      desktopStreamIds.set(hostStreamId, allocated)
      if (registerBinaryStreamHandler) {
        unregisterBinaryHandlers.push(
          registerBinaryStreamHandler(allocated, (frame) => {
            upstream?.sendBinary(encodeTerminalStreamFrame({ ...frame, streamId: hostStreamId }))
          })
        )
      }
      return allocated
    }

    const onResponse = (response: RuntimeRpcResponse<unknown>): void => {
      const failure = remoteLeafTerminalFailure(response)
      if (failure || !response.ok) {
        finish(failure ?? undefined)
        return
      }
      const result = identity.fromHostResult(response.result)
      if (isRecord(result) && result.type === 'end') {
        // The registration's release emits the phone's `end`.
        finish()
        return
      }
      if (isRecord(result) && typeof result.streamId === 'number') {
        result.streamId = desktopStreamId(result.streamId)
      }
      emit(result)
    }

    const onEvent = (event: RemoteLeafTerminalUpstreamEvent): void => {
      if (settled) {
        return
      }
      if (event.type === 'response') {
        onResponse(event.response)
      } else if (event.type === 'binary') {
        const hostStreamId = readTerminalStreamFrameId(event.bytes)
        const mapped = hostStreamId === null ? undefined : desktopStreamIds.get(hostStreamId)
        if (mapped !== undefined) {
          writeTerminalStreamFrameId(event.bytes, mapped)
          sendBinary?.(event.bytes)
        }
      } else if (event.type === 'error') {
        finish(new RemoteRuntimeClientError(event.code, event.message))
      } else {
        finish(
          new RemoteRuntimeClientError(
            'remote_runtime_unavailable',
            'The server closed the terminal stream.'
          )
        )
      }
    }

    client
      .subscribe(
        identity.target.environmentId,
        'terminal.subscribe',
        identity.toHostParams(args.params),
        onEvent,
        registration.signal
      )
      .then(
        (opened) => {
          if (settled) {
            opened.close()
            return
          }
          upstream = opened
        },
        (error: unknown) =>
          finish(
            error instanceof Error
              ? error
              : new RemoteRuntimeClientError('remote_runtime_unavailable', String(error))
          )
      )
  })
}
