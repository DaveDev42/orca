import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEnvProxy } from './env-proxy'
import {
  captureRelayProxyAtStartup,
  relayProxyEnv,
  resetCapturedRelayProxyForTests
} from './relay-proxy-config'

describe('relayProxyEnv', () => {
  it('feeds ALL_PROXY from ORCA_RELAY_PROXY only when the environment names no proxy', () => {
    const env = relayProxyEnv({ ORCA_RELAY_PROXY: 'socks5h://127.0.0.1:21080' })
    expect(resolveEnvProxy('wss://relay.example.com/x', env)?.url).toBe('socks5h://127.0.0.1:21080')
    expect(
      relayProxyEnv({
        ORCA_RELAY_PROXY: 'socks5h://127.0.0.1:21080',
        https_proxy: 'http://corp:3128'
      }).ALL_PROXY
    ).toBeUndefined()
  })

  it('changes nothing when unset or blank', () => {
    const env = { PATH: '/bin' }
    expect(relayProxyEnv(env)).toBe(env)
    expect(relayProxyEnv({ ORCA_RELAY_PROXY: '  ' }).ALL_PROXY).toBeUndefined()
  })
})

describe('captureRelayProxyAtStartup', () => {
  afterEach(() => {
    resetCapturedRelayProxyForTests()
    vi.unstubAllEnvs()
  })

  it('keeps the SOCKS URL for relay calls and out of what children inherit', () => {
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy'
    ]) {
      vi.stubEnv(name, '')
    }
    vi.stubEnv('ORCA_RELAY_PROXY', 'socks5h://127.0.0.1:21080')
    captureRelayProxyAtStartup()
    expect(process.env.ORCA_RELAY_PROXY).toBeUndefined()
    expect(relayProxyEnv().ALL_PROXY).toBe('socks5h://127.0.0.1:21080')
    // The proxy variable never reaches process.env, which spawned agents copy.
    expect(process.env.ALL_PROXY || undefined).toBeUndefined()
  })

  it('is a no-op when the variable is unset or blank', () => {
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy'
    ]) {
      vi.stubEnv(name, '')
    }
    captureRelayProxyAtStartup({})
    captureRelayProxyAtStartup({ ORCA_RELAY_PROXY: '  ' })
    expect(relayProxyEnv().ALL_PROXY || undefined).toBeUndefined()
  })

  it('reads the value once: a second capture does not replace it', () => {
    captureRelayProxyAtStartup({ ORCA_RELAY_PROXY: 'socks5h://127.0.0.1:1' })
    captureRelayProxyAtStartup({ ORCA_RELAY_PROXY: 'socks5h://127.0.0.1:2' })
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy'
    ]) {
      vi.stubEnv(name, '')
    }
    expect(relayProxyEnv().ALL_PROXY).toBe('socks5h://127.0.0.1:1')
  })
})
