import { describe, expect, it } from 'vitest'
import { resolveBrowserEnvironmentPolicy } from './browser-environment-policy'

import { MAC_IDENTITY } from './browser-environment-test-identity'

describe('resolveBrowserEnvironmentPolicy', () => {
  const settings = {
    browserEnvironmentTrustAnchors: { toss: ['PEM-A'], 'env-id': ['PEM-B'] },
    browserEnvironmentIdentity: { toss: MAC_IDENTITY }
  }

  it('matches the environment name or id exactly, id first', () => {
    expect(
      resolveBrowserEnvironmentPolicy(settings, { environmentId: 'x', environmentName: 'toss' })
    ).toMatchObject({ trustAnchorsPem: ['PEM-A'], identity: MAC_IDENTITY })
    expect(
      resolveBrowserEnvironmentPolicy(settings, {
        environmentId: 'env-id',
        environmentName: 'toss'
      }).trustAnchorsPem
    ).toEqual(['PEM-B'])
  })

  it('gives other environments nothing', () => {
    expect(
      resolveBrowserEnvironmentPolicy(settings, { environmentId: 'y', environmentName: 'Toss' })
    ).toEqual({ trustAnchorsPem: [], identity: null })
    expect(resolveBrowserEnvironmentPolicy(undefined, { environmentId: 'y' })).toEqual({
      trustAnchorsPem: [],
      identity: null
    })
  })

  it('never reads inherited object keys', () => {
    expect(
      resolveBrowserEnvironmentPolicy(settings, {
        environmentId: 'constructor',
        environmentName: 'toString'
      })
    ).toEqual({ trustAnchorsPem: [], identity: null })
  })

  it('drops a malformed identity and non-string anchors instead of half applying them', () => {
    const policy = resolveBrowserEnvironmentPolicy(
      {
        browserEnvironmentTrustAnchors: { toss: JSON.parse('["PEM", 5, ""]') },
        browserEnvironmentIdentity: {
          toss: { ...MAC_IDENTITY, platform: '' }
        }
      },
      { environmentId: 'x', environmentName: 'toss' }
    )
    expect(policy).toEqual({ trustAnchorsPem: ['PEM'], identity: null })
  })
})
