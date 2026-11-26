import { BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY } from '../../../../../shared/browser/runtime/browser-runtime-capabilities'
import type { RpcContext } from '../../core'

type BrowserClientHostCallerContext = Pick<
  RpcContext,
  | 'runtime'
  | 'clientKind'
  | 'pairedDeviceId'
  | 'pairedDeviceParentId'
  | 'callerScope'
  | 'clientCapabilities'
>

/**
 * Admits the caller of a browser client-host or tunnel method. Paired desktops (`runtime`) always
 * qualify. A phone qualifies only when this host's owner turned `browserMobileClientHostingAllowed`
 * on, the phone paired with this host itself, and it declared browser.clientHost.mobile.v1.
 *
 * Why no new RpcMethodPermission: phones are admitted by the mobile method allowlist, never by
 * permission tier, so a tier would not bind them. The three checks here (host setting, own
 * pairing, declared capability) are the scope. A delegated phone reaches this host through
 * another desktop's pairing and must not open a network exit from here, even though its
 * 'host-admin' call passes the dispatcher.
 */
export function requireBrowserClientHostCaller(context: BrowserClientHostCallerContext): void {
  const { clientKind, pairedDeviceId } = context
  // Each method still rejects a runtime caller missing its connection or device identity.
  if (clientKind === 'runtime') {
    return
  }
  if (clientKind !== 'mobile' || !pairedDeviceId) {
    throw new Error('authenticated_browser_client_host_required')
  }
  // Checked before capability negotiation so a pinned-off host answers the same to every phone.
  if (context.runtime.requireStore().getSettings().browserMobileClientHostingAllowed !== true) {
    throw new Error('browser_mobile_client_hosting_disabled')
  }
  const { callerScope } = context
  if (
    context.pairedDeviceParentId !== undefined ||
    callerScope?.kind !== 'mobile' ||
    callerScope.delegated
  ) {
    throw new Error('authenticated_browser_client_host_required')
  }
  if (!context.clientCapabilities?.includes(BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY)) {
    throw new Error('browser_mobile_client_host_capability_required')
  }
}
