import { BRIDGE_PROTOCOL_VERSION } from '../bridge/protocol/bridge-frame-fields'
import type { BridgeHostMessage } from '../bridge/protocol/bridge-envelope'
import {
  BRIDGE_TERMINAL_KEY_FRAME,
  type BridgeTerminalKeyId
} from '../bridge/native-capabilities/bridge-terminal-key'
import type { BridgeHostOptions } from './bridge-host-contract'

/** Whether the page holds the terminal key rail, and for which input owner; carried across a rebuild. */
export function createBridgeHostRailClaim(
  options: Pick<BridgeHostOptions, 'sessionBack' | 'onTerminalKeyRailClaim'>,
  sendFrame: (frame: BridgeHostMessage) => void,
  deliverable: () => boolean
) {
  let owner = options.sessionBack?.terminalKeyRailClaim?.inputOwner
  let claimed = options.sessionBack?.terminalKeyRailClaim !== undefined
  type RailClaim = NonNullable<BridgeHostOptions['onTerminalKeyRailClaim']>
  const report: RailClaim = (nowClaimed, inputOwner, toolbar) => {
    claimed = nowClaimed
    owner = nowClaimed ? inputOwner : undefined
    options.onTerminalKeyRailClaim?.(nowClaimed, inputOwner, toolbar)
  }
  return {
    report,
    send(key: BridgeTerminalKeyId, inputOwner?: string): boolean {
      if (!claimed || inputOwner !== owner || !deliverable()) {
        return false
      }
      sendFrame({
        v: BRIDGE_PROTOCOL_VERSION,
        type: BRIDGE_TERMINAL_KEY_FRAME,
        key,
        inputOwner
      })
      return true
    },
    read: () => (claimed ? { terminalKeyRailClaim: { inputOwner: owner } } : {})
  }
}
