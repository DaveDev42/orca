import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    userAgentFallback:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.7871.250 Electron/43.8.10 Safari/537.36',
    isReady: () => false,
    on: () => {}
  },
  webContents: { getAllWebContents: () => [] },
  session: {}
}))

import { asSession } from './browser-environment-test-doubles'
import { MAC_IDENTITY } from '../../../shared/browser/environment-policy/browser-environment-test-identity'
import { initializeBrowserProcessUserAgentForTest } from './browser-environment-test-process-identity'
import { setBrowserEnvironmentIdentity } from './browser-environment-identity'
import { installBrowserSessionUserAgentPolicy } from '../identity/requests/browser-session-ua'

type BeforeSend = (
  details: Record<string, unknown>,
  callback: (response: { requestHeaders: Record<string, string> }) => void
) => void

function fakeSession() {
  const state: { listener: BeforeSend | null } = { listener: null }
  const sess = {
    setUserAgent: () => {},
    extensions: undefined,
    webRequest: {
      onBeforeSendHeaders: (_filter: unknown, listener?: BeforeSend | null) => {
        state.listener = listener ?? null
      }
    }
  }
  return { sess, state }
}

function send(listener: BeforeSend | null, url: string, requestHeaders: Record<string, string>) {
  if (!listener) {
    throw new Error('no header listener installed')
  }
  let out: Record<string, string> = {}
  listener({ url, requestHeaders, resourceType: 'mainFrame', webContentsId: 1 }, (response) => {
    out = response.requestHeaders
  })
  return out
}

describe('environment identity request headers', () => {
  initializeBrowserProcessUserAgentForTest()

  it('rewrites the user agent and client hints of a pinned session, Google sign-in included', () => {
    const { sess, state } = fakeSession()
    setBrowserEnvironmentIdentity(asSession(sess), MAC_IDENTITY)
    installBrowserSessionUserAgentPolicy(asSession(sess))
    expect(state.listener).not.toBeNull()
    const headers = send(state.listener, 'https://accounts.google.com/', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua': '"Chromium";v="150"',
      'sec-ch-ua-mobile': '?0'
    })
    expect(headers['User-Agent']).toBe(MAC_IDENTITY.userAgent)
    expect(headers['sec-ch-ua-platform']).toBe('"macOS"')
    expect(headers['sec-ch-ua']).toContain('"Chromium";v="150"')
    expect(headers['sec-ch-ua']).toContain('Not;A=Brand')
  })

  it('does not listen on a session without a pin', () => {
    const { sess, state } = fakeSession()
    installBrowserSessionUserAgentPolicy(asSession(sess))
    expect(state.listener).toBeNull()
  })
})
