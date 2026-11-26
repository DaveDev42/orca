import { BrowserNetworkTunnelClientCore } from '../../../../shared/browser/network/tunnels/browser-network-tunnel-client-core'
import type { BrowserNetworkTunnelClientCoreOptions } from '../../../../shared/browser/network/tunnels/browser-network-tunnel-client-socket'
import { BrowserNetworkTunnelDuplex } from './browser-network-tunnel-duplex'
import type { BrowserNetworkTunnelOutboundMemoryLease } from './browser-network-tunnel-outbound-memory-budget'

type BrowserNetworkTunnelClientOptions = Omit<
  BrowserNetworkTunnelClientCoreOptions<BrowserNetworkTunnelDuplex>,
  'createSocket' | 'outboundMemory'
> & {
  outboundMemory?: Pick<BrowserNetworkTunnelOutboundMemoryLease, 'claimApplicationBytes'>
}

/**
 * The desktop's tunnel client: the shared protocol engine, with Node Duplex streams so the
 * loopback SOCKS server and port forwards can treat each tunnel stream as a socket.
 */
export class BrowserNetworkTunnelClient extends BrowserNetworkTunnelClientCore<BrowserNetworkTunnelDuplex> {
  constructor(options: BrowserNetworkTunnelClientOptions) {
    super({
      ...options,
      createSocket: (callbacks) => new BrowserNetworkTunnelDuplex(callbacks)
    })
  }
}
