import { useCallback, useState } from 'react'
import { Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  BRIDGE_KEY_COMMANDS_GRANT,
  sameKeyCommands,
  type BridgeKeyCommands
} from './bridge/bridge-key-commands'

const NO_COMMANDS: BridgeKeyCommands = []

/**
 * The chords this shell screen registers natively: the page's latest claim, while the screen is
 * focused, not an overlay, and its route was granted key commands. iOS only; Android has no
 * UIKeyCommand and registers nothing, so the claim there is inert.
 */
export function useShellKeyCommands(args: {
  /** The session on screen, or null while none is ready. A claim belongs to the one that made it. */
  sessionId: string | null
  overlay: boolean
  routeGrants: readonly string[]
}): { commands: BridgeKeyCommands; reportClaim: (commands: BridgeKeyCommands) => void } {
  const { sessionId } = args
  const [claim, setClaim] = useState<{ sessionId: string | null; commands: BridgeKeyCommands }>({
    sessionId: null,
    commands: NO_COMMANDS
  })
  // Focus rather than mount: the stack keeps this screen mounted under whatever is pushed over it.
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )
  const took =
    Platform.OS === 'ios' &&
    sessionId !== null &&
    claim.sessionId === sessionId &&
    focused &&
    !args.overlay &&
    args.routeGrants.includes(BRIDGE_KEY_COMMANDS_GRANT)
  const reportClaim = useCallback(
    (commands: BridgeKeyCommands) =>
      // An equal claim re-sent on each `init` must not rebuild the native commands.
      setClaim((previous) =>
        previous.sessionId === sessionId && sameKeyCommands(previous.commands, commands)
          ? previous
          : { sessionId, commands }
      ),
    [sessionId]
  )
  return { commands: took ? claim.commands : NO_COMMANDS, reportClaim }
}
