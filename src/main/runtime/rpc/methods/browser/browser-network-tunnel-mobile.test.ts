import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import '../../../../../shared/remote-runtime/protocol/protocol-version'
import {
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_TUNNEL_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_TUNNEL_WINDOW_V2_CAPABILITY
} from '../../../../../shared/browser/runtime/browser-runtime-capabilities'
import { browserNetworkExecutionHostKey } from '../../../../../shared/browser/client-hosting/browser-network-execution-host'
import { BrowserNetworkTunnelClientCore } from '../../../../../shared/browser/network/tunnels/browser-network-tunnel-client-core'
import type {
  BrowserNetworkTunnelClientSocket,
  BrowserNetworkTunnelClientSocketCallbacks
} from '../../../../../shared/browser/network/tunnels/browser-network-tunnel-client-socket'
import {
  BrowserNetworkTunnelOpcode,
  decodeBrowserNetworkTunnelFrame,
  encodeBrowserNetworkTunnelFrame
} from '../../../../../shared/browser/network/tunnels/browser-network-tunnel-protocol'
import {
  BROWSER_NETWORK_TUNNEL_LEGACY_FLOW_CONTROL,
  BROWSER_NETWORK_TUNNEL_WINDOW_V2_FLOW_CONTROL,
  type BrowserNetworkTunnelSocket
} from '../../../../../shared/browser/network/tunnels/browser-network-tunnel-stream-state'
import { BrowserNetworkTunnelOutboundMemoryBudgetRegistry } from '../../../../browser/network/tunnels/browser-network-tunnel-outbound-memory-budget'
import type { BrowserNetworkExecutionRouteResolver } from '../../../../browser/network/execution-routes/browser-network-execution-route-contract'
import { getBrowserHostLeaseRegistry } from '../../../browser-host/leases/browser-host-lease-registry-instance'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { RpcDispatcher } from '../../dispatcher'
import { createBrowserNetworkTunnelMethods } from './browser-network-tunnel'

const EXECUTION_HOST = { kind: 'native' as const, runtimeId: 'runtime-a', revision: 1 }
const PHONE_CAPABILITIES = [
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_TUNNEL_RUNTIME_CAPABILITY,
  BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY
]

// A phone-shaped stream: no node:stream, only what the shared client's socket contract names.
class PlainSocket implements BrowserNetworkTunnelClientSocket {
  destroyed = false
  readonly received: Uint8Array[] = []
  ended = false
  private readonly endListeners: (() => void)[] = []
  constructor(private readonly callbacks: BrowserNetworkTunnelClientSocketCallbacks) {}

  startReading(): void {
    this.callbacks.requestRead()
  }

  push(bytes: Uint8Array<ArrayBufferLike> | null): boolean {
    if (bytes === null) {
      this.ended = true
      queueMicrotask(() => this.endListeners.splice(0).forEach((listener) => listener()))
      return false
    }
    this.received.push(bytes)
    // The reader takes the bytes on the next tick and then asks for more.
    queueMicrotask(() => {
      this.callbacks.consumeReadBytes(bytes.byteLength)
      this.callbacks.requestRead()
    })
    return false
  }

  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) =>
      this.callbacks.writeBytes(bytes, (error) => (error ? reject(error) : resolve()))
    )
  }

  end(): void {
    this.callbacks.finishWrite(() => {})
  }

  destroy(error?: Error): void {
    this.destroyed = true
    this.callbacks.destroyStream(error ?? null, () => {})
  }

  once(_event: 'end', listener: () => void): void {
    this.endListeners.push(listener)
  }

  receivedBytes(): number {
    return this.received.reduce((total, chunk) => total + chunk.byteLength, 0)
  }
}

class FakeDestination extends EventEmitter implements BrowserNetworkTunnelSocket {
  destroyed = false
  ended = false
  readonly written: Uint8Array[] = []
  setNoDelay(): this {
    return this
  }
  pause(): this {
    return this
  }
  resume(): this {
    return this
  }
  write(bytes: Uint8Array, callback?: () => void): boolean {
    this.written.push(bytes.slice())
    if (callback) {
      queueMicrotask(callback)
    }
    return true
  }
  end(): this {
    this.ended = true
    return this
  }
  destroy(): this {
    this.destroyed = true
    return this
  }
  writtenBytes(): number {
    return this.written.reduce((total, chunk) => total + chunk.byteLength, 0)
  }
}

function runtimeWith(allowed: boolean): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tunnel methods, caller check and lease registry read only these accessors; OrcaRuntimeService is a class, so a structural double needs the cast.
  return {
    getRuntimeId: () => 'runtime-a',
    getStartedAt: () => 1,
    registerSubscriptionCleanup: () => {},
    requireStore: () => ({ getSettings: () => ({ browserMobileClientHostingAllowed: allowed }) })
  } as unknown as OrcaRuntimeService
}

type Harness = ReturnType<typeof startPhoneTunnel>

function startPhoneTunnel(options: {
  allowed?: boolean
  capabilities?: readonly string[]
  scope?: { kind: 'mobile'; delegated: boolean }
  parent?: string
}) {
  const hostRuntime = runtimeWith(options.allowed ?? true)
  const lease = getBrowserHostLeaseRegistry(hostRuntime).attach({
    browserHostClientId: 'phone-host',
    connectionId: 'phone-control-connection',
    pairedDeviceId: 'phone-a',
    hostCapabilities: ['webview']
  }).lease
  const destinations: FakeDestination[] = []
  const resolver: BrowserNetworkExecutionRouteResolver = async () => ({
    key: browserNetworkExecutionHostKey(EXECUTION_HOST),
    connect: () => {
      const destination = new FakeDestination()
      destinations.push(destination)
      return destination
    },
    isValid: () => true,
    close: () => {}
  })
  const dispatcher = new RpcDispatcher({
    runtime: hostRuntime,
    methods: createBrowserNetworkTunnelMethods(
      new BrowserNetworkTunnelOutboundMemoryBudgetRegistry(),
      resolver
    ),
    callerScope: options.scope ?? { kind: 'mobile', delegated: false }
  })
  const replies: {
    type?: string
    capabilities?: string[]
    tunnelGeneration?: number
    error?: string
  }[] = []
  const toHandler: { handler: ((bytes: Uint8Array) => void) | null } = { handler: null }
  const frames: { direction: 'toHost' | 'toPhone'; opcode: BrowserNetworkTunnelOpcode }[] = []
  const state: { client: BrowserNetworkTunnelClientCore<PlainSocket> | null } = { client: null }
  const abort = new AbortController()
  const done = dispatcher.dispatchStreaming(
    {
      id: 'phone-tunnel',
      authToken: 'bound-by-websocket',
      method: 'network.browserTunnel',
      params: {
        authorityRuntimeId: 'runtime-a',
        authorityEpoch: lease.authorityEpoch,
        browserHostClientId: lease.browserHostClientId,
        browserHostGeneration: lease.browserHostGeneration,
        executionHost: EXECUTION_HOST
      }
    },
    (reply) => {
      const parsed = JSON.parse(reply)
      replies.push(parsed.error ? { error: parsed.error.message } : parsed.result)
      const ready = parsed.result
      if (ready?.type === 'ready') {
        const windowV2 = ready.capabilities?.includes(BROWSER_NETWORK_TUNNEL_WINDOW_V2_CAPABILITY)
        state.client = new BrowserNetworkTunnelClientCore({
          tunnelGeneration: ready.tunnelGeneration,
          flowControl: windowV2
            ? BROWSER_NETWORK_TUNNEL_WINDOW_V2_FLOW_CONTROL
            : BROWSER_NETWORK_TUNNEL_LEGACY_FLOW_CONTROL,
          createSocket: (callbacks) => new PlainSocket(callbacks),
          sendBinary: (bytes) => {
            frames.push({
              direction: 'toHost',
              opcode: decodeBrowserNetworkTunnelFrame(bytes)!.opcode
            })
            toHandler.handler?.(bytes)
            return true
          }
        })
      }
    },
    {
      connectionId: 'phone-connection',
      clientKind: 'mobile',
      pairedDeviceId: 'phone-a',
      pairedDeviceParentId: options.parent,
      clientCapabilities: options.capabilities ?? PHONE_CAPABILITIES,
      sendBinary: (bytes) => {
        frames.push({
          direction: 'toPhone',
          opcode: decodeBrowserNetworkTunnelFrame(bytes)!.opcode
        })
        state.client?.handleBinary(bytes)
        return true
      },
      registerBinaryMessageHandler: (handler) => {
        toHandler.handler = handler
        return () => {
          toHandler.handler = null
        }
      },
      signal: abort.signal
    }
  )
  return {
    replies,
    frames,
    destinations,
    toHandler,
    get client() {
      return state.client
    },
    async stop() {
      state.client?.close()
      abort.abort()
      await done
    },
    done
  }
}

async function openEcho(
  tunnel: Harness
): Promise<{ socket: PlainSocket; destination: FakeDestination }> {
  await vi.waitFor(() => expect(tunnel.client).not.toBeNull())
  const opening = tunnel.client!.open({ host: 'site.example', port: 443 })
  await vi.waitFor(() => expect(tunnel.destinations).toHaveLength(1))
  const destination = tunnel.destinations[0]!
  destination.emit('connect')
  const socket = await opening
  socket.startReading()
  return { socket, destination }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('network.browserTunnel for a paired phone', () => {
  it.each([
    ['window v2', [...PHONE_CAPABILITIES, BROWSER_NETWORK_TUNNEL_WINDOW_V2_CAPABILITY], true],
    ['legacy flow control', PHONE_CAPABILITIES, false]
  ])('carries both directions past one stream window with %s', async (_name, capabilities, v2) => {
    const tunnel = startPhoneTunnel({ capabilities })
    const { socket, destination } = await openEcho(tunnel)
    expect(
      tunnel.replies[0]?.capabilities?.includes(BROWSER_NETWORK_TUNNEL_WINDOW_V2_CAPABILITY) ??
        false
    ).toBe(v2)

    // 1.25 MiB each way exceeds the 256 KiB legacy window, so credit has to round-trip.
    const total = 1280 * 1024
    const chunk = 32 * 1024
    const upload = (async () => {
      for (let sent = 0; sent < total; sent += chunk) {
        await socket.write(new Uint8Array(chunk).fill((sent / chunk) % 251))
      }
    })()
    const download = (async () => {
      for (let sent = 0; sent < total; sent += chunk) {
        destination.emit('data', new Uint8Array(chunk).fill((sent / chunk) % 241))
        await settle()
      }
    })()
    await Promise.all([upload, download])
    await vi.waitFor(() => expect(socket.receivedBytes()).toBe(total))
    expect(destination.writtenBytes()).toBe(total)
    expect(socket.received[0]![0]).toBe(0)
    expect(destination.written[1]![0]).toBe(1)
    await tunnel.stop()
  })

  it('half-closes and closes in both directions', async () => {
    const tunnel = startPhoneTunnel({})
    const { socket, destination } = await openEcho(tunnel)

    socket.end()
    await vi.waitFor(() => expect(destination.ended).toBe(true))

    destination.emit('end')
    destination.emit('close')
    await vi.waitFor(() => expect(socket.ended).toBe(true))
    await tunnel.stop()
  })

  it('tears the destination down when the phone destroys its stream', async () => {
    const tunnel = startPhoneTunnel({})
    const { socket, destination } = await openEcho(tunnel)

    socket.destroy()
    await vi.waitFor(() => expect(destination.destroyed).toBe(true))
    expect(socket.destroyed).toBe(true)
    await tunnel.stop()
  })

  it('answers pings on both sides and ignores a stale generation', async () => {
    const tunnel = startPhoneTunnel({})
    await vi.waitFor(() => expect(tunnel.client).not.toBeNull())
    const generation = tunnel.replies[0]!.tunnelGeneration!
    const ping = (tunnelGeneration: number): Uint8Array =>
      encodeBrowserNetworkTunnelFrame({
        opcode: BrowserNetworkTunnelOpcode.Ping,
        tunnelGeneration,
        streamId: 0,
        payload: new Uint8Array([1, 2, 3])
      })

    tunnel.toHandler.handler!(ping(generation))
    tunnel.client!.handleBinary(ping(generation))
    tunnel.toHandler.handler!(ping(generation + 1))
    await settle()

    const pongs = (direction: string): number =>
      tunnel.frames.filter(
        (frame) => frame.direction === direction && frame.opcode === BrowserNetworkTunnelOpcode.Pong
      ).length
    expect(pongs('toPhone')).toBe(1)
    expect(pongs('toHost')).toBe(1)
    await tunnel.stop()
  })

  it('refuses the phone, with no binary channel opened, while the host setting is off', async () => {
    const tunnel = startPhoneTunnel({ allowed: false })
    await tunnel.done
    expect(tunnel.replies).toEqual([{ error: 'browser_mobile_client_hosting_disabled' }])
    expect(tunnel.toHandler.handler).toBeNull()
  })

  it.each([
    [
      'delegated pairing',
      { parent: 'desktop-parent' },
      'authenticated_browser_client_host_required'
    ],
    [
      'delegated scope',
      { scope: { kind: 'mobile' as const, delegated: true } },
      'authenticated_browser_client_host_required'
    ],
    [
      'no mobile capability',
      { capabilities: PHONE_CAPABILITIES.slice(0, 2) },
      'browser_mobile_client_host_capability_required'
    ]
  ])('refuses the phone on %s', async (_name, options, message) => {
    const tunnel = startPhoneTunnel(options)
    await tunnel.done
    expect(tunnel.replies).toEqual([{ error: message }])
    expect(tunnel.toHandler.handler).toBeNull()
  })

  it('still requires the tunnel capabilities a desktop client needs', async () => {
    const tunnel = startPhoneTunnel({
      capabilities: [BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY]
    })
    await tunnel.done
    expect(tunnel.replies).toEqual([{ error: 'browser_tunnel_capability_required' }])
  })
})
