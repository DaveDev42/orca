import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decideEnvironmentCertificateVerification,
  parseEnvironmentTrustAnchors
} from './browser-environment-certificate-decision'
import {
  ANCHOR_PEM,
  INTER_PEM,
  LEAF_PEM,
  LEAFINTER_PEM,
  LEAFOTHER_PEM,
  OTHER_PEM
} from './browser-environment-test-certificates'

const UNKNOWN_ISSUER = 'net::ERR_CERT_AUTHORITY_INVALID'
const NOW = Date.parse('2027-01-01T00:00:00Z')
const anchors = parseEnvironmentTrustAnchors([ANCHOR_PEM])

function decide(
  overrides: Partial<Parameters<typeof decideEnvironmentCertificateVerification>[0]>
) {
  return decideEnvironmentCertificateVerification({
    hostname: 'example.test',
    verificationResult: UNKNOWN_ISSUER,
    chainPem: [LEAF_PEM],
    anchors,
    now: NOW,
    ...overrides
  })
}

describe('decideEnvironmentCertificateVerification', () => {
  it('trusts a leaf signed directly by a listed anchor when Chromium found the issuer unknown', () => {
    expect(decide({})).toBe('trust')
  })

  it('trusts a chain through an intermediate and through a served anchor', () => {
    expect(decide({ chainPem: [LEAFINTER_PEM, INTER_PEM] })).toBe('trust')
    expect(decide({ chainPem: [LEAFINTER_PEM, INTER_PEM, ANCHOR_PEM] })).toBe('trust')
  })

  it('rejects a chain that builds to a different root', () => {
    expect(decide({ chainPem: [LEAFOTHER_PEM] })).toBe('default')
    expect(decide({ chainPem: [LEAFOTHER_PEM, OTHER_PEM] })).toBe('default')
  })

  it('rejects a leaf whose signature is not by the claimed anchor', () => {
    // Same names, different key: the intermediate does not sign LEAF_PEM.
    expect(decide({ chainPem: [LEAF_PEM, INTER_PEM] })).toBe('default')
  })

  it('rejects a hostname the leaf does not name', () => {
    expect(decide({ hostname: 'evil.test' })).toBe('default')
    expect(decide({ hostname: 'sub.example.test' })).toBe('default')
  })

  it('accepts the leaf only for its own hostname, case-insensitively', () => {
    expect(decide({ hostname: 'EXAMPLE.test' })).toBe('trust')
  })

  it('keeps every Chromium verdict other than an unknown issuer', () => {
    for (const verificationResult of [
      'OK',
      'net::ERR_CERT_DATE_INVALID',
      'net::ERR_CERT_COMMON_NAME_INVALID',
      'net::ERR_CERT_REVOKED',
      'net::ERR_CERT_WEAK_KEY'
    ]) {
      expect(decide({ verificationResult })).toBe('default')
    }
  })

  it('rejects an expired or not-yet-valid leaf', () => {
    expect(decide({ now: Date.parse('2040-01-01T00:00:00Z') })).toBe('default')
    expect(decide({ now: Date.parse('2000-01-01T00:00:00Z') })).toBe('default')
  })

  it('rejects an expired anchor', () => {
    expect(decide({ now: Date.parse('2130-01-01T00:00:00Z'), chainPem: [LEAF_PEM] })).toBe(
      'default'
    )
  })

  it('decides nothing without anchors, a chain or a parseable chain', () => {
    expect(decide({ anchors: [] })).toBe('default')
    expect(decide({ chainPem: [] })).toBe('default')
    expect(decide({ chainPem: ['not a certificate'] })).toBe('default')
  })

  it('never lets a lone served leaf act as its own anchor', () => {
    const leafAsAnchor = [new X509Certificate(LEAF_PEM)]
    expect(decide({ anchors: leafAsAnchor })).toBe('default')
  })
})

describe('parseEnvironmentTrustAnchors', () => {
  it('keeps CA certificates and drops malformed or end-entity entries', () => {
    expect(parseEnvironmentTrustAnchors(['junk', LEAF_PEM, ANCHOR_PEM, INTER_PEM])).toHaveLength(2)
  })
})
