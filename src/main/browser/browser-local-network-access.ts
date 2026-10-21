import { browserManager } from './browser-manager'
import { openBrowserPagePrompt } from './browser-page-prompts'
import {
  eligibleLocalNetworkOrigin,
  grantLocalNetworkAccess,
  hasLocalNetworkGrant
} from './browser-local-network-grants'

/**
 * Answers a guest's request to reach apps and services on this device or local network. Allowed
 * only after the window showing the page says yes; the grant then covers the origin for the rest
 * of the app session in this partition. Anything not eligible, unanswered or unattended is denied.
 * `respond` runs exactly once.
 */
export function requestBrowserLocalNetworkAccess(args: {
  partition: string
  requester: Electron.WebContents
  /** URL of the frame that asked. */
  requestingUrl: string | undefined
  respond: (allowed: boolean) => void
}): void {
  const { partition, requester } = args
  let responded = false
  const respond = (allowed: boolean): void => {
    if (!responded) {
      responded = true
      args.respond(allowed)
    }
  }
  const topLevelUrl = requester.isDestroyed() ? null : requester.getURL()
  const origin = eligibleLocalNetworkOrigin(args.requestingUrl, topLevelUrl)
  if (!origin) {
    respond(false)
    return
  }
  if (hasLocalNetworkGrant(partition, origin)) {
    respond(true)
    return
  }
  const opening = openBrowserPagePrompt({
    kind: 'local-network',
    requester,
    target: browserManager.resolvePagePromptTarget(requester),
    details: () => ({ origin }),
    // Why: a page probing several local ports at once gets one question.
    coalesceKey: origin,
    parseAnswer: (value) => (value === true ? true : undefined),
    settle: (allowed) => {
      if (allowed) {
        grantLocalNetworkAccess(partition, origin)
      }
      respond(allowed === true)
    }
  })
  // Why: settle never runs for a refused or windowless page, and the page must not wait on it.
  if (opening !== 'prompting') {
    respond(false)
  }
}

/** Answers `navigator.permissions.query`: true only for an origin the user already allowed. */
export function checkBrowserLocalNetworkAccess(args: {
  partition: string
  webContents: Electron.WebContents | null
  requestingOrigin: string | undefined
  details: { requestingUrl?: string; embeddingOrigin?: string } | undefined
}): boolean {
  const { webContents, details } = args
  const requesting = details?.requestingUrl || args.requestingOrigin
  // Electron sets embeddingOrigin only for cross-origin subframes, so it is checked first.
  const topLevel =
    details?.embeddingOrigin ||
    (webContents && !webContents.isDestroyed() ? webContents.getURL() : '') ||
    requesting
  const origin = eligibleLocalNetworkOrigin(requesting, topLevel)
  return origin !== null && hasLocalNetworkGrant(args.partition, origin)
}
