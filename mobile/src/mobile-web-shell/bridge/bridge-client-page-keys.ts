import { createKeyCommandRegistry } from '../../hardware-keyboard/key-command-registry'
import type { BridgeClientNotifications } from './bridge-client-notifications'
import { createBridgeClientTerminalKeys } from './bridge-client-terminal-keys'

/** The page's two key lanes from the shell: presses on the Duo rail, and iPad keyboard chords. */
export function createBridgeClientPageKeys(
  notifications: Pick<
    BridgeClientNotifications,
    'notifyTerminalKeyRailClaim' | 'notifyKeyCommandsClaim'
  >
) {
  const terminal = createBridgeClientTerminalKeys(notifications.notifyTerminalKeyRailClaim)
  const commands = createKeyCommandRegistry(notifications.notifyKeyCommandsClaim)
  return {
    terminal,
    commands,
    // A new `init` drops both claims at the shell; call only after it has been applied.
    reassert: () => {
      terminal.reassert()
      commands.reassert()
    },
    claims: {
      /**
       * Asks the shell to draw its key rail, while a terminal and its key row are on screen, until
       * the dispose is called; `listener` takes each press. Nothing is sent to a shell without the grant.
       */
      claimTerminalKeyRail: terminal.claim,
      /**
       * Pushes a scope of hardware-keyboard chords onto the page's stack until the dispose is called;
       * `onCommand` takes each press the scope still owns. Nothing is sent to a shell without the grant.
       */
      claimKeyCommands: commands.claim
    }
  }
}
