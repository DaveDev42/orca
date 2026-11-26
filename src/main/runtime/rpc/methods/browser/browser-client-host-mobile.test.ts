import { describe, expect, it } from 'vitest'
import {
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY
} from '../../../../../shared/browser/runtime/browser-runtime-capabilities'
import { createProfile } from '../../../browser/client-pages/client-hosted-browser-persistence-test-harness'
import { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcContext } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { BROWSER_CLIENT_HOST_METHODS } from './browser-client-host'

class PhoneHostRuntime extends OrcaRuntimeService {
  override getRuntimeId(): string {
    return 'runtime-a'
  }
}

const AUTHORITY = {
  authorityRuntimeId: 'runtime-a',
  authorityEpoch: 'epoch-a',
  browserHostClientId: 'phone-host',
  browserHostGeneration: 1
}

function phoneRuntime(allowed: boolean | undefined) {
  const { store } = createProfile()
  return new PhoneHostRuntime(
    {
      ...store,
      getSettings: () => ({ ...store.getSettings(), browserMobileClientHostingAllowed: allowed })
    },
    undefined,
    {}
  )
}

type PhoneOptions = Partial<RpcContext> & { scope?: { kind: 'mobile'; delegated: boolean } }

async function call(
  runtime: OrcaRuntimeService,
  method: string,
  params: Record<string, unknown>,
  options: PhoneOptions = {}
): Promise<{ result?: { type?: string; accepted?: boolean }; error?: string }> {
  const { scope, ...context } = options
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: BROWSER_CLIENT_HOST_METHODS,
    callerScope: scope ?? { kind: 'mobile', delegated: false }
  })
  const replies: string[] = []
  const stop = new AbortController()
  const done = dispatcher.dispatchStreaming(
    { id: 'phone-call', authToken: 'bound-by-websocket', method, params },
    (reply) => {
      replies.push(reply)
      stop.abort()
    },
    {
      connectionId: 'phone-connection',
      pairedDeviceId: 'phone-a',
      clientKind: 'mobile',
      clientCapabilities: [
        BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
        BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY
      ],
      signal: stop.signal,
      ...context
    }
  )
  await done
  const parsed = JSON.parse(replies[0]!)
  return parsed.error ? { error: parsed.error.message } : { result: parsed.result }
}

const ATTACH = {
  authorityRuntimeId: 'runtime-a',
  browserHostClientId: 'phone-host',
  hostCapabilities: ['webview'],
  pageCommandProtocolVersion: 1,
  pageReconciliationProtocolVersion: 1,
  pageInventoryProtocolVersion: 1,
  pageInventory: [],
  leaseReconnectProtocolVersion: 1
}
const CHUNK = {
  ...AUTHORITY,
  pageCommandProtocolVersion: 1,
  browserPageId: 'page-a',
  pageHostGeneration: 1,
  commandSequence: 1,
  commandId: 'command-a',
  offset: 0,
  contentBase64: 'AAAA'
}
const METADATA = {
  browserHostClientId: 'phone-host',
  browserHostGeneration: 1,
  browserPageId: 'page-a',
  pageHostGeneration: 1,
  revision: 1,
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false
}

describe('browser client-host methods for a paired phone', () => {
  it('attaches a phone as a browser host only while the host allows it', async () => {
    expect(await call(phoneRuntime(true), 'browser.clientHost.attach', ATTACH)).toMatchObject({
      result: { type: 'ready' }
    })
    for (const allowed of [false, undefined]) {
      expect(await call(phoneRuntime(allowed), 'browser.clientHost.attach', ATTACH)).toEqual({
        error: 'browser_mobile_client_hosting_disabled'
      })
    }
  })

  it('refuses attach from a delegated phone or one without the mobile capability', async () => {
    const runtime = phoneRuntime(true)
    expect(
      await call(runtime, 'browser.clientHost.attach', ATTACH, { pairedDeviceParentId: 'desktop' })
    ).toEqual({ error: 'authenticated_browser_client_host_required' })
    expect(
      await call(runtime, 'browser.clientHost.attach', ATTACH, {
        scope: { kind: 'mobile', delegated: true }
      })
    ).toEqual({ error: 'authenticated_browser_client_host_required' })
    expect(
      await call(runtime, 'browser.clientHost.attach', ATTACH, {
        clientCapabilities: [BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY]
      })
    ).toEqual({ error: 'browser_mobile_client_host_capability_required' })
  })

  it.each([
    ['browser.clientHost.commandResultChunk', CHUNK],
    ['browser.clientHost.pageMetadata', METADATA]
  ])('gates %s on the same host setting', async (method, params) => {
    const refused = await call(phoneRuntime(false), method, params)
    expect(refused).toEqual({ error: 'browser_mobile_client_hosting_disabled' })
    const admitted = await call(phoneRuntime(true), method, params)
    expect(admitted.error).not.toBe('browser_mobile_client_hosting_disabled')
    expect(admitted.error).not.toBe('authenticated_browser_client_host_required')
  })

  it('keeps the request result off the phone allowlist', async () => {
    const result = await call(phoneRuntime(true), 'browser.clientHost.requestResult', {
      browserHostClientId: 'phone-host',
      requestId: 'request-a'
    })
    expect(result).toEqual({
      error: "Method 'browser.clientHost.requestResult' is not available to mobile clients"
    })
  })
})
