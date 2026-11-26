import { session, type Session } from 'electron'
import {
  resolveBrowserEnvironmentPolicy,
  type BrowserEnvironmentPolicyGlobalSettings
} from '../../../shared/browser/environment-policy/browser-environment-policy'
import { isBrowserRoutePartition } from '../routing/partitions/browser-route-identity'
import type { BrowserRouteSessionRegistry } from '../routing/sessions/browser-route-session-registry'
import { setBrowserEnvironmentIdentity } from './browser-environment-identity'
import {
  installBrowserEnvironmentTrustAnchors,
  removeBrowserEnvironmentTrustAnchors
} from './browser-environment-verify-proc'

type SettingsResolver = () => BrowserEnvironmentPolicyGlobalSettings | undefined
type EnvironmentRef = { environmentId: string; environmentName?: string | null }

/** What one partition applied, so a repeated page preparation changes nothing. */
const appliedKeyBySession = new WeakMap<Session, string>()
let settingsResolver: SettingsResolver | null = null

export function setBrowserEnvironmentPolicySettingsResolver(resolver: SettingsResolver | null) {
  settingsResolver = resolver
}

/**
 * Applies the environment's trust anchors and identity pin to its client-hosted route partition,
 * and nothing else: other partitions, SSH/WSL routes and the app's own sessions never reach here.
 * Never throws; a failed pin leaves the partition on Chromium's defaults.
 */
export function applyBrowserEnvironmentPolicy(
  partition: string,
  environment: EnvironmentRef,
  sessionForPartition: (partition: string) => Session = (name) => session.fromPartition(name)
): void {
  if (!isBrowserRoutePartition(partition)) {
    return
  }
  try {
    const policy = resolveBrowserEnvironmentPolicy(settingsResolver?.(), environment)
    const sess = sessionForPartition(partition)
    const key = JSON.stringify([policy.trustAnchorsPem, policy.identity])
    if (appliedKeyBySession.get(sess) === key) {
      return
    }
    if (policy.trustAnchorsPem.length > 0) {
      installBrowserEnvironmentTrustAnchors(sess, policy.trustAnchorsPem)
    } else {
      removeBrowserEnvironmentTrustAnchors(sess)
    }
    setBrowserEnvironmentIdentity(sess, policy.identity)
    appliedKeyBySession.set(sess, key)
  } catch (error) {
    console.warn('[browser-environment-policy] failed to apply the environment policy', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Runs when the partition's policies are cleared, so a retired partition keeps nothing. */
export function releaseBrowserEnvironmentPolicy(
  partition: string,
  sessionForPartition: (partition: string) => Session = (name) => session.fromPartition(name)
): void {
  if (!isBrowserRoutePartition(partition)) {
    return
  }
  try {
    const sess = sessionForPartition(partition)
    removeBrowserEnvironmentTrustAnchors(sess)
    setBrowserEnvironmentIdentity(sess, null)
    appliedKeyBySession.delete(sess)
  } catch {
    // The partition is already gone.
  }
}

/** The page executor's route sessions, with the environment's policy applied before any page loads. */
export function withBrowserEnvironmentPolicy(
  routeSessions: Pick<BrowserRouteSessionRegistry, 'preparePage'>,
  environment: EnvironmentRef
): Pick<BrowserRouteSessionRegistry, 'preparePage'> {
  return {
    preparePage: async (input) => {
      const handle = await routeSessions.preparePage(input)
      applyBrowserEnvironmentPolicy(handle.partition, environment)
      return handle
    }
  }
}
