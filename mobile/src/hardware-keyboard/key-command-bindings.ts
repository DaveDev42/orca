import type {
  KeybindingActionId,
  ParsedKeybinding,
  TerminalShortcutPolicy
} from '../../../src/shared/keybindings/types'
import {
  DEFINITIONS_BY_ID,
  isDigitIndexActionId
} from '../../../src/shared/keybindings/definitions'
import {
  getEffectiveKeybindingsForAction,
  keybindingIsActiveInContext
} from '../../../src/shared/keybindings/effective'
import { parseKeybinding } from '../../../src/shared/keybindings/parser'
import type {
  BridgeKeyCommand,
  BridgeKeyCommandModifier
} from '../mobile-web-shell/bridge/bridge-key-commands'

/** Where focus sits when the page builds its claim: the terminal owns some chords the app does not. */
export type KeyCommandContext = 'app' | 'terminal'

const NAMED_INPUTS: Readonly<Record<string, BridgeKeyCommand['input']>> = {
  Escape: 'escape',
  Enter: 'enter',
  Tab: 'tab',
  Space: 'space',
  ArrowUp: 'arrowUp',
  ArrowDown: 'arrowDown',
  ArrowLeft: 'arrowLeft',
  ArrowRight: 'arrowRight',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`'
}

const ARROWS = new Set(['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight'])
const TEXT_EDITING_LETTERS = new Set(['a', 'c', 'v', 'x', 'z'])

function inputOf(key: string): BridgeKeyCommand['input'] | null {
  if (/^[A-Z0-9]$/.test(key)) {
    // UIKeyCommand matches letters by their unshifted, lowercase character.
    return key.toLowerCase()
  }
  return NAMED_INPUTS[key] ?? null
}

// On darwin `Mod` is Cmd, the same reading the desktop menu gives it.
function modifiersOf(parsed: ParsedKeybinding): BridgeKeyCommandModifier[] {
  return [
    ...(parsed.mod || parsed.meta ? (['command'] as const) : []),
    ...(parsed.shift ? (['shift'] as const) : []),
    ...(parsed.alt ? (['alternate'] as const) : []),
    ...(parsed.control ? (['control'] as const) : [])
  ]
}

/**
 * Select all, copy, paste, cut, undo and redo, and Cmd(+Shift)+arrows, belong to whatever text
 * field has focus. A registered UIKeyCommand with priority would take them from every field on the
 * page, so the page never claims them, whatever the desktop keymap says.
 */
export function isTextEditingChord(command: Pick<BridgeKeyCommand, 'input' | 'modifiers'>) {
  const { input, modifiers } = command
  return (
    modifiers.includes('command') &&
    modifiers.every((modifier) => modifier === 'command' || modifier === 'shift') &&
    (ARROWS.has(input) || TEXT_EDITING_LETTERS.has(input))
  )
}

/**
 * The chords for one desktop action as the shell registers them, read from the shared keymap on
 * darwin rather than declared here. An action the terminal owns in `context` yields none, as do
 * double-tap bindings, keys UIKeyCommand cannot name, and text-editing chords. Digit actions (the
 * Cmd+1-9 family) are left for the PR that wires one, since each digit needs its own id.
 */
export function keyCommandsForAction(
  actionId: KeybindingActionId,
  title: string,
  context: KeyCommandContext = 'app',
  // The desktop default until the mobile setting lands: orca-first keeps app chords in a terminal.
  terminalShortcutPolicy?: TerminalShortcutPolicy
): BridgeKeyCommand[] {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (definition === undefined || isDigitIndexActionId(actionId)) {
    return []
  }
  if (!keybindingIsActiveInContext(definition, { context, terminalShortcutPolicy })) {
    return []
  }
  const commands: BridgeKeyCommand[] = []
  for (const binding of getEffectiveKeybindingsForAction(actionId, 'darwin')) {
    const parsed = parseKeybinding(binding)
    if (parsed === null || parsed.doubleTapModifier !== undefined) {
      continue
    }
    const input = inputOf(parsed.key)
    const modifiers = modifiersOf(parsed)
    if (input === null || modifiers.length === 0) {
      continue
    }
    const command = {
      id: commands.length === 0 ? actionId : `${actionId}:${commands.length}`,
      input,
      modifiers,
      title
    }
    if (!isTextEditingChord(command)) {
      commands.push(command)
    }
  }
  return commands
}

/** The action a command id names: the id itself, or the id before a second binding's `:n`. */
export function actionIdOfKeyCommand(id: string): string {
  const colon = id.lastIndexOf(':')
  return colon > 0 && /^\d+$/.test(id.slice(colon + 1)) ? id.slice(0, colon) : id
}
