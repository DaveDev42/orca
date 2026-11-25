import '../../remote-runtime/protocol/protocol-version'
import {
  BROWSER_CLIENT_AUTOMATION_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_EXECUTION_HOSTS_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_TUNNEL_RUNTIME_CAPABILITY,
  BROWSER_SCREENCAST_RUNTIME_CAPABILITY
} from '../runtime/browser-runtime-capabilities'
import type { BrowserClientHostPlacementPreference } from './browser-client-host-placement'

/** Every capability a runtime must advertise before this client can host its browser pages. */
export const BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES = [
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_AUTOMATION_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_TUNNEL_RUNTIME_CAPABILITY,
  BROWSER_NETWORK_EXECUTION_HOSTS_RUNTIME_CAPABILITY
] as const

export function runtimeAdvertisesBrowserClientHosting(
  capabilities: readonly string[] | undefined
): boolean {
  return BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES.every((capability) =>
    capabilities?.includes(capability)
  )
}

export type BrowserServerRenderedGlobalSettings = {
  /**
   * Paired environments (id or display name, exact match) whose browser tabs always open
   * server-rendered (streamed), whatever `browserClientHostedRemoteEnabled` says. Unset or empty
   * changes nothing. A server that cannot stream stays client-hosted.
   */
  browserServerRenderedEnvironments?: string[]
}

/**
 * True when the viewer pinned this environment to server-rendered (streamed) browser tabs.
 * Entries match the environment id or its display name, exactly and case-sensitively, so fleet
 * config can use a stable name while ids differ per viewer.
 */
export function isServerRenderedBrowserEnvironment(input: {
  serverRenderedEnvironments: readonly string[] | undefined
  environmentId: string | null | undefined
  environmentName: string | null | undefined
}): boolean {
  const list = input.serverRenderedEnvironments
  if (!list || list.length === 0) {
    return false
  }
  return (
    (!!input.environmentId && list.includes(input.environmentId)) ||
    (!!input.environmentName && list.includes(input.environmentName))
  )
}

/** Share main placement and renderer staging prediction to avoid panes stuck connecting. Pairing/graph/lease conditions visible on one side stay there. */
export function expectsBrowserClientHosting(input: {
  enabled: boolean
  preference: BrowserClientHostPlacementPreference | undefined
  deviceScope: string | null | undefined
  capabilities: readonly string[] | undefined
  /** `browserServerRenderedEnvironments`: environments always streamed regardless of `enabled`. */
  serverRenderedEnvironments?: readonly string[]
  environmentId?: string | null
  environmentName?: string | null
}): boolean {
  // Why: a server that cannot stream can't honor the server-render setting; its pages would become unregistered desktop tabs.
  const serverCanStream = input.capabilities?.includes(BROWSER_SCREENCAST_RUNTIME_CAPABILITY)
  // Why: a pinned environment streams, but a person's explicit 'client' move still wins, as it does over `enabled`.
  if (
    serverCanStream &&
    input.preference !== 'client' &&
    isServerRenderedBrowserEnvironment({
      serverRenderedEnvironments: input.serverRenderedEnvironments,
      environmentId: input.environmentId,
      environmentName: input.environmentName
    })
  ) {
    return false
  }
  return (
    (input.enabled || input.preference === 'client' || !serverCanStream) &&
    (input.preference ?? 'auto') !== 'server' &&
    input.deviceScope !== 'mobile' &&
    runtimeAdvertisesBrowserClientHosting(input.capabilities)
  )
}
