import { app } from 'electron'

// Fork builds update from the fork's own GitHub releases, never from the upstream repo.
export const UPDATE_RELEASE_REPO = 'DaveDev42/orca'

export const UPDATE_FEED = {
  provider: 'generic',
  url: `https://github.com/${UPDATE_RELEASE_REPO}/releases/latest/download`
} as const

/** ORCA_UPDATER_DISABLED=1 turns the in-app updater off on a host whose version is managed elsewhere. */
export function isUpdaterAvailable(): boolean {
  return app.isPackaged && process.env.ORCA_UPDATER_DISABLED !== '1'
}
