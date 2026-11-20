import type { KeybindingActionId } from '../../../src/shared/keybindings/types'
import type { KeyCommandContext } from './key-command-bindings'

/** One chord, or for a digit-index action the nine of them. */
export type PageKeyAction =
  | {
      readonly actionId: KeybindingActionId
      /** Shown in the iPad's Cmd-hold overlay. */
      readonly title: string
      readonly run: () => void
      /** Claim these chords instead of the keymap's. */
      readonly bindings?: readonly string[]
      readonly onDigit?: undefined
    }
  | {
      readonly actionId: KeybindingActionId
      /** Shown in the Cmd-hold overlay for each digit. */
      readonly title: (digit: number) => string
      readonly onDigit: (digit: number) => void
      readonly run?: undefined
      readonly bindings?: undefined
    }

/** Native screens get no hardware-keyboard chords; only the page, inside the web shell, claims them. */
export function usePageKeyCommands(
  _active: boolean,
  _context: KeyCommandContext,
  _actions: readonly PageKeyAction[]
): void {}
