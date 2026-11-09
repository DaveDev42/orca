import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { usePageBridgeClientIfPresent } from '../transport/connection/client-context.web'
import type { BridgeKeyCommands } from '../mobile-web-shell/bridge/bridge-key-commands'
import {
  actionIdOfKeyCommand,
  keyCommandsForAction,
  type KeyCommandContext
} from './key-command-bindings'
import type { KeyCommandClaim } from './key-command-registry'
import type { PageKeyAction } from './use-page-key-commands'

export type { PageKeyAction } from './use-page-key-commands'

const NO_COMMANDS: BridgeKeyCommands = []

/**
 * Pushes one scope of chords onto the page's stack for as long as the caller is mounted, and
 * re-sends the claim whenever `active`, the focus `context` or the actions change. The shell turns
 * the claim into UIKeyCommands; a press runs the newest `run` for its action, read at press time.
 */
export function usePageKeyCommands(
  active: boolean,
  context: KeyCommandContext,
  actions: readonly PageKeyAction[]
): void {
  const client = usePageBridgeClientIfPresent()
  // The page's own stack keeps a screen mounted under the one pushed over it.
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )
  const signature = actions
    .map((action) => `${action.actionId}\u0000${action.title}`)
    .join('\u0001')
  const commands = useMemo(
    () =>
      active && focused
        ? actions.flatMap((action) => keyCommandsForAction(action.actionId, action.title, context))
        : NO_COMMANDS,
    // `actions` is a fresh array each render; its ids and titles are what the claim is built from.
    [active, focused, context, signature]
  )
  // Handlers change every render; the press reads the latest, never one captured at claim time.
  const actionsRef = useRef(actions)
  useLayoutEffect(() => {
    actionsRef.current = actions
  }, [actions])
  const claimRef = useRef<KeyCommandClaim | null>(null)
  useLayoutEffect(() => {
    if (client === null) {
      return
    }
    const claim = client.claimKeyCommands(NO_COMMANDS, (id) => {
      const actionId = actionIdOfKeyCommand(id)
      actionsRef.current.find((action) => action.actionId === actionId)?.run()
    })
    claimRef.current = claim
    return () => {
      claimRef.current = null
      claim()
    }
  }, [client])
  useLayoutEffect(() => {
    claimRef.current?.update(commands)
  }, [client, commands])
}
