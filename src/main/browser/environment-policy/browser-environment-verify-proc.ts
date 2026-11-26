import type { Session } from 'electron'
import {
  decideEnvironmentCertificateVerification,
  parseEnvironmentTrustAnchors
} from './browser-environment-certificate-decision'

// Electron's callback codes: 0 accepts, -3 keeps Chromium's own verdict.
const CERT_ACCEPT = 0
const CERT_USE_CHROMIUM_RESULT = -3
const MAX_ISSUER_WALK = 8

const installedSessions = new WeakSet<Session>()

type ServedCertificate = { data: string; issuerCert?: ServedCertificate | null }

function servedChainPem(certificate: ServedCertificate): string[] {
  const chain: string[] = []
  let current: ServedCertificate | null | undefined = certificate
  while (current?.data && chain.length < MAX_ISSUER_WALK) {
    if (chain.includes(current.data)) {
      break
    }
    chain.push(current.data)
    current = current.issuerCert
  }
  return chain
}

/**
 * Scoped to this one session: the proc is a per-session setting, so every other partition, the
 * SSH/WSL route partitions and the app's own sessions keep Electron's default verification.
 * Returns whether any usable anchor was installed.
 */
export function installBrowserEnvironmentTrustAnchors(
  sess: Session,
  anchorsPem: readonly string[]
): boolean {
  const anchors = parseEnvironmentTrustAnchors(anchorsPem)
  if (anchors.length === 0) {
    removeBrowserEnvironmentTrustAnchors(sess)
    return false
  }
  sess.setCertificateVerifyProc((request, callback) => {
    let decision: ReturnType<typeof decideEnvironmentCertificateVerification> = 'default'
    try {
      decision = decideEnvironmentCertificateVerification({
        hostname: request.hostname,
        verificationResult: request.verificationResult,
        chainPem: servedChainPem(request.certificate),
        anchors
      })
    } catch {
      // Any failure keeps Chromium's verdict.
    }
    callback(decision === 'trust' ? CERT_ACCEPT : CERT_USE_CHROMIUM_RESULT)
  })
  installedSessions.add(sess)
  return true
}

/** Only undoes what this module installed, so another owner's proc is never cleared. */
export function removeBrowserEnvironmentTrustAnchors(sess: Session): void {
  if (!installedSessions.delete(sess)) {
    return
  }
  sess.setCertificateVerifyProc(null)
}
