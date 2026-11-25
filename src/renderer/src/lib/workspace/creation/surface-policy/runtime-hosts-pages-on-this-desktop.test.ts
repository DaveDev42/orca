import { describe, expect, it } from 'vitest'
import { BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES } from '../../../../../../shared/browser/client-hosting/browser-client-hosting-eligibility'
import { BROWSER_SCREENCAST_RUNTIME_CAPABILITY } from '../../../../../../shared/browser/runtime/browser-runtime-capabilities'
import { runtimeHostsPagesOnThisDesktop } from './client-creation-action-policy'

const statuses: Parameters<typeof runtimeHostsPagesOnThisDesktop>[2] = new Map([
  [
    'env-toss',
    {
      status: {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: DeviceScope is not exported here; 'desktop' is one of its values.
        deviceScope: 'desktop' as never,
        capabilities: [
          ...BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
          BROWSER_SCREENCAST_RUNTIME_CAPABILITY
        ]
      }
    }
  ]
])
const runtimeEnvironments = [
  { id: 'env-toss', name: 'Dave-MBP16-Toss', orcadDeployment: undefined }
]

describe('runtimeHostsPagesOnThisDesktop with browserServerRenderedEnvironments', () => {
  const host = (list: string[] | undefined, preference?: 'client' | 'server') =>
    runtimeHostsPagesOnThisDesktop(
      {
        runtimeEnvironments,
        settings: {
          browserClientHostedRemoteEnabled: true,
          browserServerRenderedEnvironments: list
        }
      },
      'env-toss',
      statuses,
      preference
    )

  it('predicts the same verdict main reaches for a pinned environment', () => {
    expect(host(undefined)).toBe(true)
    expect(host([])).toBe(true)
    expect(host(['env-toss'])).toBe(false)
    expect(host(['Dave-MBP16-Toss'])).toBe(false)
    expect(host(['Dave-MBP16-Toss'], 'client')).toBe(true)
    expect(host(['Someone-Else'])).toBe(true)
  })
})
