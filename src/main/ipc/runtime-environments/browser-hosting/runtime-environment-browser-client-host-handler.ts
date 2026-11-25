import { ipcMain } from 'electron'
import {
  BrowserClientHostPlacementPreparationRequest,
  type BrowserPageCreationPlacement
} from '../../../../shared/browser/client-hosting/browser-client-host-placement'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { prepareRuntimeEnvironmentBrowserPlacement } from './runtime-environment-browser-placement'

export function registerRuntimeEnvironmentBrowserClientHostHandler(options: {
  getUserDataPath: () => string
  getSettings: () => Pick<
    GlobalSettings,
    'browserClientHostedRemoteEnabled' | 'browserServerRenderedEnvironments'
  >
}): void {
  ipcMain.handle(
    'runtimeEnvironments:prepareBrowserClientHostPlacement',
    async (_event, input: unknown): Promise<BrowserPageCreationPlacement> => {
      const args = BrowserClientHostPlacementPreparationRequest.parse(input)
      const userDataPath = options.getUserDataPath()
      const settings = options.getSettings()
      return prepareRuntimeEnvironmentBrowserPlacement(userDataPath, {
        ...args,
        enabled: settings.browserClientHostedRemoteEnabled !== false,
        serverRenderedEnvironments: settings.browserServerRenderedEnvironments
      })
    }
  )
}
