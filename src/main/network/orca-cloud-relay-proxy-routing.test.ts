import { createServer, type AddressInfo, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeOrcaServerSignIn } from '../orca-profiles/orca-cloud-server-sign-in-probe'
import { startServerSignInRequest } from '../orca-profiles/orca-cloud-server-sign-in-requests'
import { skillCloudRequest } from '../skills/cloud/skill-cloud-request'

// A SOCKS5 listener that records every CONNECT destination and then drops the connection, so a
// call that reaches it fails fast and the test only asserts where the call went.
function socksRecorder(): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = []
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.write(Buffer.from([0x05, 0x00]))
        socket.once('data', (request) => {
          if (request[3] === 0x03) {
            const length = request[4]
            seen.push(
              `${request.subarray(5, 5 + length).toString()}:${request.readUInt16BE(5 + length)}`
            )
          } else {
            seen.push('ip-literal')
          }
          socket.destroy()
        })
      })
      socket.on('error', () => {})
    })
    server.listen(0, '127.0.0.1', () => {
      const address: AddressInfo | string | null = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('server is not listening on a TCP port')
      }
      resolve({ server, port: address.port, seen })
    })
  })
}

describe('Orca Cloud calls follow ORCA_RELAY_PROXY', () => {
  let server: Server | null = null
  afterEach(() => {
    server?.close()
    server = null
    vi.unstubAllEnvs()
  })

  async function withRelayProxy(): Promise<string[]> {
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
    const recorder = await socksRecorder()
    server = recorder.server
    vi.stubEnv('ORCA_RELAY_PROXY', `socks5h://127.0.0.1:${recorder.port}`)
    return recorder.seen
  }

  it('sends the server sign-in probe through the proxy with the name left to it', async () => {
    const seen = await withRelayProxy()
    await expect(
      probeOrcaServerSignIn({ apiBaseUrl: 'https://login.onorca.dev' }, 'client')
    ).rejects.toThrow()
    expect(seen).toEqual(['login.onorca.dev:443'])
  })

  it('sends server sign-in requests through the proxy', async () => {
    const seen = await withRelayProxy()
    await expect(
      startServerSignInRequest(
        { apiBaseUrl: 'https://login.onorca.dev' },
        {
          clientId: 'client',
          codeChallenge: 'challenge',
          codeChallengeMethod: 'S256',
          state: 'state',
          nonce: 'nonce',
          scope: 'openid',
          machineLabel: 'machine',
          machinePlatform: 'macos',
          localProfileId: 'profile'
        },
        new AbortController().signal
      )
    ).rejects.toThrow()
    expect(seen).toEqual(['login.onorca.dev:443'])
  })

  it('sends skill cloud requests through the proxy', async () => {
    const seen = await withRelayProxy()
    await expect(
      skillCloudRequest({ path: '/v1/skills/packages', timeoutMs: 2000 })
    ).rejects.toThrow()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/onorca\.dev:443$/)
  })
})
