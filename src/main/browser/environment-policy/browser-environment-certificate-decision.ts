import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'

/** The only Chromium verdict an environment's anchors may overturn: an unknown issuer. */
export const ENVIRONMENT_ANCHOR_ELIGIBLE_RESULT = 'net::ERR_CERT_AUTHORITY_INVALID'
const MAX_CHAIN_LENGTH = 6

export type EnvironmentCertificateDecision = 'trust' | 'default'

/** Anchors that parse as CA certificates; anything else in the setting is ignored. */
export function parseEnvironmentTrustAnchors(pems: readonly string[]): X509Certificate[] {
  const anchors: X509Certificate[] = []
  for (const pem of pems) {
    try {
      const anchor = new X509Certificate(pem)
      if (anchor.ca) {
        anchors.push(anchor)
      }
    } catch {
      // A malformed entry never becomes an anchor.
    }
  }
  return anchors
}

function validAt(certificate: X509Certificate, now: number): boolean {
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo)
}

function certificateIssuedBy(certificate: X509Certificate, issuer: X509Certificate): boolean {
  return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey)
}

function leafMatchesHostname(leaf: X509Certificate, hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return isIP(name) ? leaf.checkIP(name) !== undefined : leaf.checkHost(name) !== undefined
}

/**
 * Overturn Chromium's "unknown issuer" only when the served chain really builds to one of this
 * environment's anchors: every signature checks, every certificate is inside its validity window
 * and the leaf names the requested host. Every other verdict (OK, expired, revoked, wrong host,
 * weak key, ...) stays Chromium's.
 */
export function decideEnvironmentCertificateVerification(input: {
  hostname: string
  /** Chromium's own result: `OK` or a `net::ERR_*` name. */
  verificationResult: string
  /** PEM certificates as served, leaf first. */
  chainPem: readonly string[]
  anchors: readonly X509Certificate[]
  now?: number
}): EnvironmentCertificateDecision {
  if (
    input.verificationResult !== ENVIRONMENT_ANCHOR_ELIGIBLE_RESULT ||
    input.anchors.length === 0 ||
    input.chainPem.length === 0 ||
    input.chainPem.length > MAX_CHAIN_LENGTH
  ) {
    return 'default'
  }
  const now = input.now ?? Date.now()
  try {
    const chain = input.chainPem.map((pem) => new X509Certificate(pem))
    if (!chain.every((certificate) => validAt(certificate, now))) {
      return 'default'
    }
    if (!leafMatchesHostname(chain[0], input.hostname)) {
      return 'default'
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      if (!chain[index + 1].ca || !certificateIssuedBy(chain[index], chain[index + 1])) {
        return 'default'
      }
    }
    const top = chain.at(-1)
    if (!top) {
      return 'default'
    }
    const anchored = input.anchors.some(
      (anchor) =>
        validAt(anchor, now) &&
        // A leaf served alone is never its own anchor; only a CA served as the top may be one.
        ((chain.length > 1 && top.fingerprint256 === anchor.fingerprint256) ||
          certificateIssuedBy(top, anchor))
    )
    return anchored ? 'trust' : 'default'
  } catch {
    return 'default'
  }
}
