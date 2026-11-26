import { afterEach, describe, expect, it } from 'vitest'
import { BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY } from '../../../../../shared/browser/runtime/browser-runtime-capabilities'
import { buildDefaultSettings } from '../../../../../shared/settings/default-global-settings'
import { setRuntimeBrowserCommandsFactory } from '../../../browser/installation/runtime-browser-commands-factory'
import { createProfile } from '../../../browser/client-pages/client-hosted-browser-persistence-test-harness'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { MOBILE_RPC_METHOD_ROUTES } from '../../server/runtime-rpc-mobile-method-routing'

function runtimeWith(allowed: boolean | undefined): OrcaRuntimeService {
  const { store } = createProfile()
  return new OrcaRuntimeService(
    {
      ...store,
      getSettings: () => ({ ...store.getSettings(), browserMobileClientHostingAllowed: allowed })
    },
    undefined,
    {}
  )
}

describe('phone-hosted browser pages, host surface', () => {
  afterEach(() => setRuntimeBrowserCommandsFactory(null))

  it('is off by default', () => {
    const defaults = buildDefaultSettings({
      workspaceDir: '/tmp',
      appFontFamily: 'sans',
      editorAutoSaveDelayMs: 1000,
      primarySelectionMiddleClickPaste: false,
      primarySelectionDefaultedForLinux: false,
      terminalFontFamily: 'mono',
      terminalFontWeight: 400,
      terminalInactivePaneOpacity: 1,
      terminalRightClickToPaste: false,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the browser default is read; the notification and voice shapes are irrelevant here.
      notifications: {} as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      voice: {} as never
    })
    expect(defaults.browserMobileClientHostingAllowed).toBe(false)
  })

  it('advertises the capability only when the host allows it and can take client pages', () => {
    // Runtimes build their browser commands at construction, so install the factory afterwards.
    const [allowed, denied, unset] = [true, false, undefined].map(runtimeWith)
    setRuntimeBrowserCommandsFactory(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: getStatus reads only the factory options; no commands are built.
      (() => ({})) as never,
      { clientHostingWithoutEngine: true }
    )
    const advertised = (runtime: OrcaRuntimeService): boolean =>
      runtime.getStatus().capabilities?.includes(BROWSER_MOBILE_CLIENT_HOST_RUNTIME_CAPABILITY) ??
      false

    expect(advertised(allowed!)).toBe(true)
    expect(advertised(denied!)).toBe(false)
    expect(advertised(unset!)).toBe(false)

    setRuntimeBrowserCommandsFactory(null)
    expect(advertised(allowed!)).toBe(false)
  })

  it('answers the lease and tunnel from the runtime the phone is connected to, never relayed', () => {
    for (const method of [
      'browser.clientHost.attach',
      'browser.clientHost.commandResult',
      'browser.clientHost.commandResultChunk',
      'browser.clientHost.pageMetadata',
      'network.browserTunnel'
    ]) {
      expect(MOBILE_RPC_METHOD_ROUTES.get(method)).toBe('paired-desktop')
    }
    expect(MOBILE_RPC_METHOD_ROUTES.has('browser.clientHost.requestResult')).toBe(false)
    expect(MOBILE_RPC_METHOD_ROUTES.has('browser.clientHost.fileChannel.read')).toBe(false)
  })
})
