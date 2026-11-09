import type { MobileSessionController } from '../session/use-mobile-session-controller'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { usePageKeyCommands } from './use-page-key-commands'

/**
 * The session's chords. Claimed while the session is on screen even when a sheet covers it or no
 * tab is open, so Cmd+W never falls through to iPadOS and closes the window; the press then does
 * nothing. A terminal tab claims in the terminal context, which drops what the terminal owns.
 */
export function useSessionKeyCommands(controller: MobileSessionController, sheetOpen: boolean) {
  const t = useMobileTranslation()
  const tab = controller.activeSessionTab
  usePageKeyCommands(true, tab?.type === 'terminal' ? 'terminal' : 'app', [
    {
      actionId: 'tab.close',
      title: t('session.keyCommands.closeTab', 'Close Tab'),
      run: () => {
        if (tab && !sheetOpen) {
          void controller.handleCloseSessionTab(tab)
        }
      }
    }
  ])
}
