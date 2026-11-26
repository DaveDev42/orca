import { app, webContents, type Session, type WebContents } from 'electron'
import type { BrowserEnvironmentIdentity } from '../../../shared/browser/environment-policy/browser-environment-policy'
import { stripElectronToken } from '../identity/browser-process-user-agent'
import { isChromeShapedSiteUrl } from '../identity/browser-site-user-agent'
import type { BrowserTabIdentity } from '../identity/browser-tab-identity'
import { notifyBrowserSessionUserAgentPolicyChanged } from '../identity/requests/browser-session-ua-demand'

export type EnvironmentTabIdentity = Extract<BrowserTabIdentity, { kind: 'environment' }>

type EnvironmentIdentityDependencies = {
  /** Called after a debugger attach so memory protection sees it, as the tab manager does. */
  onDebuggerAttached?: (contents: WebContents) => void
}

// Keyed by session: a route partition is one environment's pages and popups, nothing else's.
const identityBySession = new WeakMap<Session, BrowserEnvironmentIdentity>()
let dependencies: EnvironmentIdentityDependencies = {}
let hookInstalled = false

export function setBrowserEnvironmentIdentityDependencies(next: EnvironmentIdentityDependencies) {
  dependencies = next
}

export function browserEnvironmentIdentityForSession(
  sess: Session
): BrowserEnvironmentIdentity | undefined {
  return identityBySession.get(sess)
}

/**
 * The pinned identity as one navigation or request presents it. Sites that need Electron's token
 * gone still get that rule on top of the pin, as they do in the environment's own browser.
 */
export function environmentTabIdentity(
  sess: Session,
  url: string
): EnvironmentTabIdentity | undefined {
  const pinned = identityBySession.get(sess)
  if (!pinned) {
    return undefined
  }
  return {
    kind: 'environment',
    userAgent: isChromeShapedSiteUrl(url) ? stripElectronToken(pinned.userAgent) : pinned.userAgent,
    platform: pinned.platform,
    userAgentMetadata: pinned.userAgentMetadata
  }
}

/** Payload for `Emulation.setUserAgentOverride`: headers, `navigator.userAgent`, `.platform`, `.userAgentData`. */
export function environmentUserAgentOverride(identity: EnvironmentTabIdentity): {
  userAgent: string
  platform: string
  userAgentMetadata: EnvironmentTabIdentity['userAgentMetadata']
} {
  return {
    userAgent: identity.userAgent,
    platform: identity.platform,
    userAgentMetadata: identity.userAgentMetadata
  }
}

/** Set before the first navigation; CDP covers what the session-level user agent cannot reach. */
export async function applyBrowserEnvironmentIdentity(contents: WebContents): Promise<boolean> {
  try {
    if (contents.isDestroyed()) {
      return false
    }
    const identity = environmentTabIdentity(contents.session, contents.getURL())
    if (!identity) {
      return false
    }
    contents.setUserAgent(identity.userAgent)
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach('1.3')
      dependencies.onDebuggerAttached?.(contents)
    }
    await contents.debugger.sendCommand(
      'Emulation.setUserAgentOverride',
      environmentUserAgentOverride(identity)
    )
    return true
  } catch (error) {
    console.warn('[browser-environment-identity] failed to pin the tab identity', {
      webContentsId: contents.isDestroyed() ? null : contents.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

function watchContents(contents: WebContents): void {
  if (!identityBySession.has(contents.session)) {
    return
  }
  void applyBrowserEnvironmentIdentity(contents)
  // A closed DevTools or another detach drops the CDP override; the next navigation restores it.
  contents.on('did-start-navigation', (details: Electron.Event<{ isMainFrame: boolean }>) => {
    if (
      details.isMainFrame &&
      identityBySession.has(contents.session) &&
      !contents.debugger.isAttached()
    ) {
      void applyBrowserEnvironmentIdentity(contents)
    }
  })
}

function ensureContentsHook(): void {
  if (hookInstalled) {
    return
  }
  hookInstalled = true
  // Guests and popups both pass through here with their final session already assigned.
  app.on('web-contents-created', (_event, contents) => watchContents(contents))
}

/** Pins (or with null releases) one session's identity and applies it to every open page in it. */
export function setBrowserEnvironmentIdentity(
  sess: Session,
  identity: BrowserEnvironmentIdentity | null
): void {
  if (identity === null) {
    if (identityBySession.delete(sess)) {
      notifyBrowserSessionUserAgentPolicyChanged(sess)
    }
    return
  }
  identityBySession.set(sess, identity)
  sess.setUserAgent(identity.userAgent)
  ensureContentsHook()
  notifyBrowserSessionUserAgentPolicyChanged(sess)
  for (const contents of webContents.getAllWebContents()) {
    if (contents.session === sess) {
      void applyBrowserEnvironmentIdentity(contents)
    }
  }
}
