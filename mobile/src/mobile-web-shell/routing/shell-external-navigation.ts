import type { NativeSyntheticEvent } from 'react-native'
import { cancelledShellNavigationTarget } from './cancelled-navigation-target'

/** The shell view's external-navigation handler, kept out of the screen file's line budget. */
export function shellExternalNavigationHandler(openUrl: (url: string) => void) {
  return (event: NativeSyntheticEvent<{ url: string }>): void => {
    const target = cancelledShellNavigationTarget(event.nativeEvent.url)
    if (target === null) {
      // Drop schemes outside the three allowed ones; shell-document URLs are already refused before this callback.
      return
    }
    openUrl(target)
  }
}
