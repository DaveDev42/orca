import { describe, expect, it, vi } from 'vitest'
import { BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES } from '../../../../shared/browser/client-hosting/browser-client-hosting-eligibility'
import { BROWSER_SCREENCAST_RUNTIME_CAPABILITY } from '../../../../shared/browser/runtime/browser-runtime-capabilities'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { prepareBrowserClientHostPlacement } from './browser-client-host-placement-preparation'

const CAPABLE = [
  ...BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
  BROWSER_SCREENCAST_RUNTIME_CAPABILITY
]

function setup(capabilities: readonly string[] = CAPABLE) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the preparation code reads only id, name and createdAt.
  const environment = {
    id: 'env-toss',
    name: 'Dave-MBP16-Toss',
    createdAt: 1
  } as KnownRuntimeEnvironment
  const startHost = vi.fn().mockResolvedValue({
    authorityRuntimeId: 'rt-1',
    browserHostClientId: 'client-1'
  })
  const options = {
    selector: 'env-toss',
    preference: 'auto' as const,
    enabled: true,
    resolveEnvironment: async () => environment,
    getStatus: async () => ({
      ok: true,
      result: {
        runtimeId: 'rt-1',
        graphStatus: 'ready',
        deviceScope: 'desktop',
        capabilities
      },
      _meta: { runtimeId: 'rt-1' }
    }),
    startHost,
    closeHost: vi.fn().mockResolvedValue(true)
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub status carries only the fields the preparation reads.
    options: options as unknown as Parameters<typeof prepareBrowserClientHostPlacement>[0],
    startHost
  }
}

describe('prepareBrowserClientHostPlacement', () => {
  it('keeps hosting the page on this device when no environment is pinned', async () => {
    const { options } = setup()
    await expect(prepareBrowserClientHostPlacement(options)).resolves.toEqual({
      kind: 'client',
      browserHostClientId: 'client-1'
    })
  })

  it.each(['env-toss', 'Dave-MBP16-Toss'])(
    'places a pinned environment (%s) on the server without starting a host',
    async (entry) => {
      const { options, startHost } = setup()
      await expect(
        prepareBrowserClientHostPlacement({ ...options, serverRenderedEnvironments: [entry] })
      ).resolves.toEqual({ kind: 'server' })
      expect(startHost).not.toHaveBeenCalled()
    }
  )

  it('leaves an environment that is not pinned on this device', async () => {
    const { options } = setup()
    await expect(
      prepareBrowserClientHostPlacement({ ...options, serverRenderedEnvironments: ['Other'] })
    ).resolves.toMatchObject({ kind: 'client' })
  })

  it('keeps a pinned environment client-hosted when its server cannot stream', async () => {
    const { options } = setup(CAPABLE.filter((c) => c !== BROWSER_SCREENCAST_RUNTIME_CAPABILITY))
    await expect(
      prepareBrowserClientHostPlacement({ ...options, serverRenderedEnvironments: ['env-toss'] })
    ).resolves.toMatchObject({ kind: 'client' })
  })

  it('honors an explicit client move over the pin', async () => {
    const { options } = setup()
    await expect(
      prepareBrowserClientHostPlacement({
        ...options,
        preference: 'client',
        serverRenderedEnvironments: ['env-toss']
      })
    ).resolves.toMatchObject({ kind: 'client' })
  })
})
