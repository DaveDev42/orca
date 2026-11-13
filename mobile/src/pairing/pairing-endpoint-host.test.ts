import { describe, expect, it } from 'vitest'
import { pairingEndpointHost } from './pairing-endpoint-host'

describe('pairingEndpointHost', () => {
  it('keeps only the host of the link', () => {
    expect(pairingEndpointHost('ws://dave-windows.tail1234.ts.net:6768/path?x=1')).toBe(
      'dave-windows.tail1234.ts.net'
    )
    expect(pairingEndpointHost('wss://192.168.0.7:6768')).toBe('192.168.0.7')
  })

  it('is null for something that is not a URL', () => {
    expect(pairingEndpointHost('not a url')).toBeNull()
    expect(pairingEndpointHost('')).toBeNull()
  })
})
