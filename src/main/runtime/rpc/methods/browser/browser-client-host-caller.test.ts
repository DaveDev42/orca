import { describe, expect, it } from 'vitest'
import { BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY } from '../../../../../shared/browser/runtime/browser-runtime-capabilities'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcContext } from '../../core'
import { requireBrowserClientHostCaller } from './browser-client-host-caller'

function runtimeWith(allowed: boolean | undefined): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the caller check reads only requireStore().getSettings(); OrcaRuntimeService is a class, so a structural double needs the cast.
  return {
    requireStore: () => ({
      getSettings: () => ({ browserMobileClientHostingAllowed: allowed })
    })
  } as unknown as OrcaRuntimeService
}

function phone(
  allowed: boolean | undefined,
  overrides: Partial<RpcContext> = {}
): Parameters<typeof requireBrowserClientHostCaller>[0] {
  return {
    runtime: runtimeWith(allowed),
    clientKind: 'mobile',
    pairedDeviceId: 'phone-a',
    callerScope: { kind: 'mobile', delegated: false },
    clientCapabilities: [BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY],
    ...overrides
  }
}

describe('requireBrowserClientHostCaller', () => {
  it('admits a paired desktop without reading the host setting', () => {
    expect(() =>
      requireBrowserClientHostCaller({
        runtime: runtimeWith(false),
        clientKind: 'runtime',
        pairedDeviceId: 'desktop-a',
        callerScope: { kind: 'runtime-paired', grants: [] }
      })
    ).not.toThrow()
  })

  it('admits an own-paired phone that declared the capability when the host allows it', () => {
    expect(() => requireBrowserClientHostCaller(phone(true))).not.toThrow()
  })

  it.each([false, undefined])('refuses a phone while the host setting is %s', (allowed) => {
    expect(() => requireBrowserClientHostCaller(phone(allowed))).toThrow(
      'browser_mobile_client_hosting_disabled'
    )
  })

  it('refuses a phone that did not declare the mobile capability', () => {
    expect(() => requireBrowserClientHostCaller(phone(true, { clientCapabilities: [] }))).toThrow(
      'browser_mobile_client_host_capability_required'
    )
    expect(() =>
      requireBrowserClientHostCaller(phone(true, { clientCapabilities: undefined }))
    ).toThrow('browser_mobile_client_host_capability_required')
  })

  it('refuses a delegated phone however its scope is stamped', () => {
    expect(() =>
      requireBrowserClientHostCaller(phone(true, { pairedDeviceParentId: 'desktop-parent' }))
    ).toThrow('authenticated_browser_client_host_required')
    expect(() =>
      requireBrowserClientHostCaller(
        phone(true, { callerScope: { kind: 'mobile', delegated: true } })
      )
    ).toThrow('authenticated_browser_client_host_required')
  })

  it('refuses a phone whose scope is not a plain mobile scope or that has no device identity', () => {
    for (const callerScope of [undefined, { kind: 'owner' } as const]) {
      expect(() => requireBrowserClientHostCaller(phone(true, { callerScope }))).toThrow(
        'authenticated_browser_client_host_required'
      )
    }
    expect(() =>
      requireBrowserClientHostCaller(phone(true, { pairedDeviceId: undefined }))
    ).toThrow('authenticated_browser_client_host_required')
  })

  it('refuses a caller of unknown kind', () => {
    expect(() => requireBrowserClientHostCaller(phone(true, { clientKind: undefined }))).toThrow(
      'authenticated_browser_client_host_required'
    )
  })
})
