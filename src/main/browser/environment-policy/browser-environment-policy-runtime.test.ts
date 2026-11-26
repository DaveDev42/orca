import { beforeEach, describe, expect, it, vi } from 'vitest'

type ElectronState = {
  created?: (event: unknown, contents: unknown) => void
  contents: unknown[]
  sessions: Map<string, unknown>
}

const electron = vi.hoisted((): ElectronState => ({ contents: [], sessions: new Map() }))

vi.mock('electron', () => ({
  app: {
    userAgentFallback: '',
    on: (_name: string, handler: (event: unknown, contents: unknown) => void) => {
      electron.created = handler
    }
  },
  webContents: { getAllWebContents: () => electron.contents },
  session: { fromPartition: (partition: string) => electron.sessions.get(partition) }
}))

import { asSession, emptyPreparePageInput } from './browser-environment-test-doubles'
import { ANCHOR_PEM, LEAF_PEM } from './browser-environment-test-certificates'
import { MAC_IDENTITY } from '../../../shared/browser/environment-policy/browser-environment-test-identity'
import {
  environmentTabIdentity,
  browserEnvironmentIdentityForSession,
  setBrowserEnvironmentIdentityDependencies
} from './browser-environment-identity'
import {
  applyBrowserEnvironmentPolicy,
  releaseBrowserEnvironmentPolicy,
  setBrowserEnvironmentPolicySettingsResolver,
  withBrowserEnvironmentPolicy
} from './browser-environment-policy-runtime'

const ROUTE_A = `persist:orca-browser-v1-${'a'.repeat(64)}`
const ROUTE_B = `persist:orca-browser-v1-${'b'.repeat(64)}`

type FakeSession = {
  proc?: unknown
  userAgent: string
  setCertificateVerifyProc(proc: unknown): void
  setUserAgent(userAgent: string): void
}

function fakeSession(): FakeSession {
  return {
    userAgent: '',
    setCertificateVerifyProc(proc) {
      this.proc = proc
    },
    setUserAgent(userAgent) {
      this.userAgent = userAgent
    }
  }
}

function fakeContents(session: unknown, url = 'https://example.test/') {
  const commands: { method: string; params: Record<string, unknown> }[] = []
  let attached = false
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    session,
    commands,
    userAgent: '',
    isDestroyed: () => false,
    getURL: () => url,
    id: 7,
    setUserAgent(userAgent: string) {
      this.userAgent = userAgent
    },
    on: (name: string, handler: (...args: unknown[]) => void) => listeners.set(name, handler),
    listeners,
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true
      },
      sendCommand: async (method: string, params: Record<string, unknown>) => {
        commands.push({ method, params })
      }
    }
  }
}

const settings = {
  browserEnvironmentTrustAnchors: { toss: [ANCHOR_PEM] },
  browserEnvironmentIdentity: { toss: MAC_IDENTITY }
}

beforeEach(() => {
  electron.contents = []
  electron.sessions.clear()
  setBrowserEnvironmentPolicySettingsResolver(() => settings)
  setBrowserEnvironmentIdentityDependencies({})
})

describe('applyBrowserEnvironmentPolicy', () => {
  it('pins trust anchors and identity on the environment partition only', async () => {
    const toss = fakeSession()
    const unrelated = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    electron.sessions.set('persist:default-profile', unrelated)
    const open = fakeContents(toss)
    const elsewhere = fakeContents(unrelated)
    electron.contents = [open, elsewhere]

    applyBrowserEnvironmentPolicy(ROUTE_A, { environmentId: 'id-1', environmentName: 'toss' })
    applyBrowserEnvironmentPolicy('persist:default-profile', {
      environmentId: 'id-1',
      environmentName: 'toss'
    })

    expect(typeof toss.proc).toBe('function')
    expect(toss.userAgent).toBe(MAC_IDENTITY.userAgent)
    await vi.waitFor(() => expect(open.commands).toHaveLength(1))
    expect(open.commands[0]).toEqual({
      method: 'Emulation.setUserAgentOverride',
      params: {
        userAgent: MAC_IDENTITY.userAgent,
        platform: 'MacIntel',
        userAgentMetadata: MAC_IDENTITY.userAgentMetadata
      }
    })
    expect(open.userAgent).toBe(MAC_IDENTITY.userAgent)
    // Other partitions keep Electron's defaults in every respect.
    expect(unrelated.proc).toBeUndefined()
    expect(unrelated.userAgent).toBe('')
    expect(elsewhere.commands).toEqual([])
    expect(browserEnvironmentIdentityForSession(asSession(unrelated))).toBeUndefined()
  })

  it('leaves another environment of the same app untouched', () => {
    const other = fakeSession()
    electron.sessions.set(ROUTE_B, other)
    applyBrowserEnvironmentPolicy(ROUTE_B, { environmentId: 'id-2', environmentName: 'wsl' })
    expect(other.proc).toBeUndefined()
    expect(other.userAgent).toBe('')
  })

  it('pins popups and new guests created later in the partition, not other sessions', async () => {
    const toss = fakeSession()
    const unrelated = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    applyBrowserEnvironmentPolicy(ROUTE_A, { environmentId: 'id-1', environmentName: 'toss' })
    const popup = fakeContents(toss, 'about:blank')
    const foreign = fakeContents(unrelated)
    electron.created?.({}, popup)
    electron.created?.({}, foreign)
    await vi.waitFor(() => expect(popup.commands).toHaveLength(1))
    expect(popup.userAgent).toBe(MAC_IDENTITY.userAgent)
    expect(foreign.commands).toEqual([])
    expect(foreign.listeners.size).toBe(0)
    // A later main-frame navigation re-pins after a detach.
    popup.debugger.attach()
    expect(popup.listeners.has('did-start-navigation')).toBe(true)
  })

  it('invokes the attach callback so memory protection sees the debugger', async () => {
    const onDebuggerAttached = vi.fn()
    setBrowserEnvironmentIdentityDependencies({ onDebuggerAttached })
    const toss = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    const open = fakeContents(toss)
    electron.contents = [open]
    applyBrowserEnvironmentPolicy(ROUTE_A, { environmentId: 'id-1', environmentName: 'toss' })
    await vi.waitFor(() => expect(onDebuggerAttached).toHaveBeenCalledWith(open))
  })

  it('applies once per settings state and re-applies when the settings change', () => {
    const toss = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    const spy = vi.spyOn(toss, 'setCertificateVerifyProc')
    const env = { environmentId: 'id-1', environmentName: 'toss' }
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    expect(spy).toHaveBeenCalledTimes(1)
    setBrowserEnvironmentPolicySettingsResolver(() => ({
      browserEnvironmentTrustAnchors: { toss: [ANCHOR_PEM, LEAF_PEM] },
      browserEnvironmentIdentity: { toss: MAC_IDENTITY }
    }))
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('clears the pin when settings no longer name the environment, and on release', () => {
    const toss = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    const env = { environmentId: 'id-1', environmentName: 'toss' }
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    setBrowserEnvironmentPolicySettingsResolver(() => ({}))
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    expect(toss.proc).toBeNull()
    expect(browserEnvironmentIdentityForSession(asSession(toss))).toBeUndefined()

    setBrowserEnvironmentPolicySettingsResolver(() => settings)
    applyBrowserEnvironmentPolicy(ROUTE_A, env)
    expect(browserEnvironmentIdentityForSession(asSession(toss))).toBeDefined()
    releaseBrowserEnvironmentPolicy(ROUTE_A)
    expect(toss.proc).toBeNull()
    expect(browserEnvironmentIdentityForSession(asSession(toss))).toBeUndefined()
  })

  it('applies after the route page is prepared, passing the handle through', async () => {
    const toss = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    const handle = { partition: ROUTE_A, release: () => {} }
    const routeSessions = withBrowserEnvironmentPolicy(
      { preparePage: async () => handle },
      { environmentId: 'id-1', environmentName: 'toss' }
    )
    expect(await routeSessions.preparePage(emptyPreparePageInput())).toBe(handle)
    expect(typeof toss.proc).toBe('function')
  })
})

describe('environmentTabIdentity', () => {
  it('presents the pin, and drops the Electron token only where a site rule needs it', () => {
    const toss = fakeSession()
    electron.sessions.set(ROUTE_A, toss)
    applyBrowserEnvironmentPolicy(ROUTE_A, { environmentId: 'id-1', environmentName: 'toss' })
    const plain = environmentTabIdentity(asSession(toss), 'https://example.test/')
    expect(plain).toMatchObject({
      kind: 'environment',
      userAgent: MAC_IDENTITY.userAgent,
      platform: 'MacIntel'
    })
    expect(plain?.userAgentMetadata.platform).toBe('macOS')
    const chase = environmentTabIdentity(asSession(toss), 'https://www.chase.com/')
    expect(chase?.userAgent).not.toContain('Electron/')
    expect(chase?.platform).toBe('MacIntel')
    expect(
      environmentTabIdentity(asSession(fakeSession()), 'https://example.test/')
    ).toBeUndefined()
  })
})
