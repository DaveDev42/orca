import type { KeybindingActionId } from '../../../src/shared/keybindings/types'
import type { KeyCommandContext } from './key-command-bindings'

export type PageKeyAction = {
  readonly actionId: KeybindingActionId
  /** Shown in the iPad's Cmd-hold overlay. */
  readonly title: string
  readonly run: () => void
}

/** Native screens get no hardware-keyboard chords; only the page, inside the web shell, claims them. */
export function usePageKeyCommands(
  _active: boolean,
  _context: KeyCommandContext,
  _actions: readonly PageKeyAction[]
): void {}
