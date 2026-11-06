import './unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { toRemoteRuntimePtyId } from '../../../shared/remote-runtime-pty-id'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  encodeTerminalStreamFrame,
  encodeTerminalStreamText,
  type TerminalStreamFrame
} from '../../../shared/terminal-stream-protocol'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  RemoteLeafTerminalEnvironmentClient,
  RemoteLeafTerminalUpstreamEvent
} from '../remote-leaf-terminal-forwarding'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'
import { createSubscriptionRegistryDouble } from './subscription-registry-test-double'

const REMOTE_PTY = toRemoteRuntimePtyId('host-term-7', 'env-orcad')
const PHONE = { id: 'phone-token-secret', type: 'mobile' as const }

function asRuntime(double: Record<string, unknown>): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the forwarded paths read only the members the double provides.
  return double as unknown as OrcaRuntimeService
}

function ok(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'host-req', ok: true, result, _meta: { runtimeId: 'orcad-rt' } }
}

function harness(leafPtyId: string | null, waitedPtyId: string | null = null) {
  const registry = createSubscriptionRegistryDouble()
  const runtime = {
    getRuntimeId: () => 'desktop-rt',
    resolveLeafForHandle: vi.fn(() => ({ ptyId: leafPtyId })),
    resolveLiveLeafForHandle: vi.fn(() => ({ ptyId: leafPtyId })),
    requestRendererTerminalTabMount: vi.fn(() => true),
    getRendererTerminalSerializerGenerationForHandle: vi.fn(() => 0),
    waitForLeafPtyId: vi.fn(async () => {
      if (!waitedPtyId) {
        throw new Error('timeout')
      }
      return waitedPtyId
    }),
    readTerminal: vi.fn().mockResolvedValue({ tail: ['local'], truncated: false }),
    subscribeToPtyExit: vi.fn(() => vi.fn()),
    handleMobileSubscribe: vi.fn(),
    handleMobileUnsubscribe: vi.fn(),
    clearTerminalBuffer: vi.fn().mockResolvedValue({ handle: 'term-desktop', cleared: true }),
    ...registry
  }
  let onEvent: (event: RemoteLeafTerminalUpstreamEvent) => void = () => {}
  const upstream = { close: vi.fn(), sendBinary: vi.fn((_bytes: Uint8Array) => true) }
  const client = {
    call: vi.fn(async (_env: string, _method: string, params: { terminal?: unknown }) =>
      ok({ send: { handle: params.terminal, accepted: true } })
    ),
    subscribe: vi.fn(
      async (
        _env: string,
        _method: string,
        _params: unknown,
        listener: (event: RemoteLeafTerminalUpstreamEvent) => void
      ) => {
        onEvent = listener
        return upstream
      }
    )
  } satisfies RemoteLeafTerminalEnvironmentClient
  const phoneHandlers = new Map<number, (frame: TerminalStreamFrame) => void>()
  const replies: { id: string; ok: boolean; result?: Record<string, unknown>; error?: unknown }[] =
    []
  const binary: Uint8Array<ArrayBufferLike>[] = []
  const abort = new AbortController()
  const dispatcher = new RpcDispatcher({ runtime: asRuntime(runtime), methods: TERMINAL_METHODS })
  const dispatch = (request: RpcRequest) =>
    dispatcher.dispatchStreaming(request, (raw) => replies.push(JSON.parse(raw)), {
      connectionId: 'conn-phone',
      clientId: PHONE.id,
      clientKind: 'mobile',
      signal: abort.signal,
      remoteLeafTerminals: client,
      sendBinary: (bytes) => {
        binary.push(bytes)
      },
      registerBinaryStreamHandler: (streamId, handler) => {
        phoneHandlers.set(streamId, handler)
        return () => phoneHandlers.delete(streamId)
      }
    })
  const subscribe = () =>
    dispatch({
      id: 'sub-1',
      authToken: 'tok',
      method: 'terminal.subscribe',
      params: {
        terminal: 'term-desktop',
        client: PHONE,
        capabilities: { terminalBinaryStream: 1 }
      }
    })
  return {
    runtime,
    client,
    upstream,
    replies,
    binary,
    phoneHandlers,
    abort,
    dispatch,
    subscribe,
    emitUpstream: (event: RemoteLeafTerminalUpstreamEvent) => onEvent(event)
  }
}

describe('paired-client terminal calls on a mirrored orcad leaf', () => {
  it('forwards terminal.subscribe and renumbers the host stream both ways', async () => {
    const h = harness(REMOTE_PTY)
    const done = h.subscribe()
    await vi.waitFor(() => expect(h.client.subscribe).toHaveBeenCalled())

    const [environmentId, method, params] = h.client.subscribe.mock.calls[0]
    expect(environmentId).toBe('env-orcad')
    expect(method).toBe('terminal.subscribe')
    expect(params).toMatchObject({
      terminal: 'host-term-7',
      capabilities: { terminalBinaryStream: 1 }
    })
    // The desktop credential in client.id never reaches the server.
    expect(JSON.stringify(params)).not.toContain(PHONE.id)

    h.emitUpstream({ type: 'response', response: ok({ type: 'subscribed', streamId: 1 }) })
    const subscribed = h.replies.find((reply) => reply.result?.type === 'subscribed')
    const desktopStreamId = subscribed?.result?.streamId
    expect(typeof desktopStreamId).toBe('number')

    h.emitUpstream({
      type: 'binary',
      bytes: encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        streamId: 1,
        seq: 3,
        payload: encodeTerminalStreamText('$ ')
      })
    })
    expect(decodeTerminalStreamFrame(h.binary[0])).toMatchObject({
      opcode: TerminalStreamOpcode.Output,
      streamId: desktopStreamId,
      seq: 3
    })
    // A frame for a stream the phone was never told of is dropped.
    h.emitUpstream({
      type: 'binary',
      bytes: encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        streamId: 99,
        seq: 0,
        payload: new Uint8Array()
      })
    })
    expect(h.binary).toHaveLength(1)

    if (typeof desktopStreamId !== 'number') {
      throw new Error('expected a desktop stream id')
    }
    h.phoneHandlers.get(desktopStreamId)?.({
      opcode: TerminalStreamOpcode.Input,
      streamId: desktopStreamId,
      seq: 0,
      payload: encodeTerminalStreamText('ls\r')
    })
    const sentUpstream: Uint8Array[] = []
    for (const call of h.upstream.sendBinary.mock.calls) {
      sentUpstream.push(...call)
    }
    expect(decodeTerminalStreamFrame(sentUpstream[0])).toMatchObject({
      opcode: TerminalStreamOpcode.Input,
      streamId: 1
    })

    await h.dispatch({
      id: 'unsub-1',
      authToken: 'tok',
      method: 'terminal.unsubscribe',
      params: { subscriptionId: 'term-desktop', requestId: 'sub-1', client: PHONE }
    })
    await done
    expect(h.upstream.close).toHaveBeenCalledTimes(1)
    expect(h.phoneHandlers.size).toBe(0)
    expect(h.replies.at(-2)?.result).toEqual({ type: 'end' })
    expect(h.runtime.readTerminal).not.toHaveBeenCalled()
  })

  it('closes the upstream when the phone socket goes away', async () => {
    const h = harness(REMOTE_PTY)
    const done = h.subscribe()
    await vi.waitFor(() => expect(h.client.subscribe).toHaveBeenCalled())
    h.abort.abort()
    await done
    expect(h.upstream.close).toHaveBeenCalledTimes(1)
  })

  it('ends the phone stream when the host ends it', async () => {
    const h = harness(REMOTE_PTY)
    const done = h.subscribe()
    await vi.waitFor(() => expect(h.client.subscribe).toHaveBeenCalled())
    h.emitUpstream({ type: 'response', response: ok({ type: 'end' }) })
    await done
    expect(h.replies.at(-1)?.result).toEqual({ type: 'end' })
    expect(h.upstream.close).toHaveBeenCalledTimes(1)
  })

  it('surfaces a host failure to the phone instead of an empty terminal', async () => {
    const h = harness(REMOTE_PTY)
    const done = h.subscribe()
    await vi.waitFor(() => expect(h.client.subscribe).toHaveBeenCalled())
    h.emitUpstream({
      type: 'response',
      response: {
        id: 'host-req',
        ok: false,
        error: { code: 'terminal_handle_stale', message: 'terminal_handle_stale' }
      }
    })
    await done
    expect(h.replies.at(-1)).toMatchObject({
      id: 'sub-1',
      ok: false,
      error: { code: 'terminal_handle_stale' }
    })
    expect(h.replies.some((reply) => reply.result?.type === 'end')).toBe(false)
  })

  it('surfaces an unreachable server', async () => {
    const h = harness(REMOTE_PTY)
    h.client.subscribe.mockRejectedValueOnce(
      Object.assign(new Error('Server unreachable'), { code: 'remote_runtime_unavailable' })
    )
    await h.subscribe()
    expect(h.replies.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'remote_runtime_unavailable' }
    })
  })

  it('forwards an unmounted tab once its mount publishes the remote id', async () => {
    const h = harness(null, REMOTE_PTY)
    const done = h.subscribe()
    await vi.waitFor(() => expect(h.client.subscribe).toHaveBeenCalled())
    expect(h.runtime.requestRendererTerminalTabMount).toHaveBeenCalledWith('term-desktop')
    h.abort.abort()
    await done
  })

  it('refuses a remote leaf whose server it cannot name', async () => {
    const h = harness(toRemoteRuntimePtyId('host-term-7'))
    await h.subscribe()
    expect(h.replies.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'remote_runtime_unavailable' }
    })
    expect(h.client.subscribe).not.toHaveBeenCalled()
  })

  it('forwards one-shot calls with the host handle and maps it back', async () => {
    const h = harness(REMOTE_PTY)
    await h.dispatch({
      id: 'send-1',
      authToken: 'tok',
      method: 'terminal.send',
      params: { terminal: 'term-desktop', text: 'ls', enter: true, client: PHONE }
    })
    expect(h.client.call).toHaveBeenCalledWith(
      'env-orcad',
      'terminal.send',
      expect.objectContaining({ terminal: 'host-term-7', text: 'ls', enter: true })
    )
    expect(JSON.stringify(h.client.call.mock.calls[0][2])).not.toContain(PHONE.id)
    expect(h.replies.at(-1)).toMatchObject({
      ok: true,
      result: { send: { handle: 'term-desktop', accepted: true } }
    })
  })

  it('surfaces a one-shot host failure', async () => {
    const h = harness(REMOTE_PTY)
    h.client.call.mockResolvedValueOnce({
      id: 'host-req',
      ok: false,
      error: { code: 'invalid_argument', message: 'bad viewport' }
    })
    await h.dispatch({
      id: 'vp-1',
      authToken: 'tok',
      method: 'terminal.clearBuffer',
      params: { terminal: 'term-desktop' }
    })
    expect(h.replies.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'bad viewport' }
    })
  })

  it('leaves local leaves to the local handlers', async () => {
    const h = harness('wt-1@@local-pty')
    await h.dispatch({
      id: 'clear-1',
      authToken: 'tok',
      method: 'terminal.clearBuffer',
      params: { terminal: 'term-desktop' }
    })
    expect(h.client.call).not.toHaveBeenCalled()
    expect(h.runtime.clearTerminalBuffer).toHaveBeenCalledWith('term-desktop')
    expect(h.replies.at(-1)).toMatchObject({ ok: true })
  })
})
