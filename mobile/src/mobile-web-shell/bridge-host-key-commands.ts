import { BRIDGE_PROTOCOL_VERSION, type BridgeHostMessage } from './bridge/bridge-envelope'
import { BRIDGE_KEY_COMMAND_FRAME, type BridgeKeyCommands } from './bridge/bridge-key-commands'
import type { BridgeHostOptions } from './bridge-host-contract'

/**
 * The chords one page session holds at the shell. Carried across a rebuild like the rail claim,
 * since the page never claims again for a client replacement; dropped when its document ends.
 */
export function createBridgeHostKeyCommands(
  options: Pick<BridgeHostOptions, 'sessionBack' | 'onKeyCommandsClaim'>,
  send: (frame: BridgeHostMessage) => void,
  deliverable: () => boolean
) {
  let held: BridgeKeyCommands = options.sessionBack?.keyCommandsClaim ?? []
  return {
    report(commands: BridgeKeyCommands): void {
      if (commands.length === 0 && held.length === 0) {
        return
      }
      held = commands
      options.onKeyCommandsClaim?.(commands)
    },
    /** False for an id the page does not hold now; nothing reaches the page for it. */
    send(id: string): boolean {
      if (!deliverable() || !held.some((command) => command.id === id)) {
        return false
      }
      send({ v: BRIDGE_PROTOCOL_VERSION, type: BRIDGE_KEY_COMMAND_FRAME, id })
      return true
    },
    read: () => (held.length > 0 ? { keyCommandsClaim: held } : {})
  }
}
