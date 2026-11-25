import { describe, expect, it } from 'vitest'
import {
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_SCREENCAST_RUNTIME_CAPABILITY
} from '../runtime/browser-runtime-capabilities'
import {
  BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
  expectsBrowserClientHosting
} from './browser-client-hosting-eligibility'

const CAPABLE = [
  ...BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
  BROWSER_SCREENCAST_RUNTIME_CAPABILITY
]

describe('expectsBrowserClientHosting', () => {
  it("lets a person's 'client' move override the setting, never the server's capabilities or a phone", () => {
    const serverSetting = { enabled: false, deviceScope: 'desktop', capabilities: CAPABLE }
    expect(expectsBrowserClientHosting({ ...serverSetting, preference: 'auto' })).toBe(false)
    expect(expectsBrowserClientHosting({ ...serverSetting, preference: 'client' })).toBe(true)
    expect(
      expectsBrowserClientHosting({
        ...serverSetting,
        preference: 'client',
        capabilities: CAPABLE.filter(
          (capability) => capability !== BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY
        )
      })
    ).toBe(false)
    expect(
      expectsBrowserClientHosting({ ...serverSetting, preference: 'client', deviceScope: 'mobile' })
    ).toBe(false)
  })

  describe('browserServerRenderedEnvironments', () => {
    const base = {
      enabled: true,
      preference: 'auto' as const,
      deviceScope: 'desktop',
      capabilities: CAPABLE,
      environmentId: 'env-toss',
      environmentName: 'Dave-MBP16-Toss'
    }

    it('changes nothing while the list is unset or empty', () => {
      expect(expectsBrowserClientHosting(base)).toBe(true)
      expect(expectsBrowserClientHosting({ ...base, serverRenderedEnvironments: [] })).toBe(true)
      expect(expectsBrowserClientHosting({ ...base, enabled: false })).toBe(false)
    })

    it('streams a listed environment by id or by exact name and leaves others client-hosted', () => {
      expect(
        expectsBrowserClientHosting({ ...base, serverRenderedEnvironments: ['env-toss'] })
      ).toBe(false)
      expect(
        expectsBrowserClientHosting({ ...base, serverRenderedEnvironments: ['Dave-MBP16-Toss'] })
      ).toBe(false)
      expect(
        expectsBrowserClientHosting({ ...base, serverRenderedEnvironments: ['dave-mbp16-toss'] })
      ).toBe(true)
      expect(
        expectsBrowserClientHosting({ ...base, serverRenderedEnvironments: ['env-other', 'Other'] })
      ).toBe(true)
      expect(
        expectsBrowserClientHosting({
          ...base,
          environmentName: undefined,
          serverRenderedEnvironments: ['Dave-MBP16-Toss']
        })
      ).toBe(true)
    })

    it('keeps a listed environment client-hosted when its server cannot stream', () => {
      expect(
        expectsBrowserClientHosting({
          ...base,
          serverRenderedEnvironments: ['env-toss'],
          capabilities: CAPABLE.filter(
            (capability) => capability !== BROWSER_SCREENCAST_RUNTIME_CAPABILITY
          )
        })
      ).toBe(true)
    })

    it("lets a person's explicit client move win and never hosts for a phone", () => {
      const listed = { ...base, serverRenderedEnvironments: ['env-toss'] }
      expect(expectsBrowserClientHosting({ ...listed, preference: 'client' })).toBe(true)
      expect(expectsBrowserClientHosting({ ...listed, preference: 'server' })).toBe(false)
      expect(expectsBrowserClientHosting({ ...listed, enabled: false })).toBe(false)
      expect(
        expectsBrowserClientHosting({ ...listed, preference: 'client', deviceScope: 'mobile' })
      ).toBe(false)
    })
  })
})
