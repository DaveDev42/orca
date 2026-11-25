import { describe, expect, it } from 'vitest'
import { resolveEnvProxy } from './env-proxy'
import { relayProxyEnv } from './relay-proxy-config'

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
