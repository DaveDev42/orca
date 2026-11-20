import type { MobileSessionController } from '../session/use-mobile-session-controller'
import { useForkTranslation } from '../fork-i18n/use-fork-translation'
import { usePageKeyCommands } from './use-page-key-commands'

/**
 * The session's chords. Claimed while the session is on screen even when a sheet covers it or no
 * tab is open, so Cmd+W never falls through to iPadOS and closes the window; the press then does
 * nothing. Ctrl+1-9 pick tabs by position. A terminal tab claims in the terminal context, which drops what the terminal owns.
 */
export function useSessionKeyCommands(controller: MobileSessionController, sheetOpen: boolean) {
  const t = useForkTranslation()
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
    },
    {
      // Ctrl+1-9 on darwin, as on the desktop: the Nth tab of this workspace; none when there is no Nth.
      actionId: 'tab.selectByIndex',
      title: (digit: number) => t('session.keyCommands.selectTab', 'Tab {{n}}', { n: digit }),
      onDigit: (digit: number) => {
        const target = controller.visibleTabs[digit - 1]
        if (target && !sheetOpen) {
          controller.switchSessionTab(target)
        }
      }
    }
  ])
}
