import * as z from 'zod'

/** iPad hardware-keyboard chords: the shell registers them natively, the page decides what they do. */

/**
 * The grant a page declares, optionally, when it can take key commands. An older page declares
 * none, so the shell registers no chords for it; an older shell never grants it, so a newer page
 * claims nothing and the system keeps every chord.
 */
export const BRIDGE_KEY_COMMANDS_GRANT = 'keyCommands'

/**
 * Page to shell, a notify on that grant: the whole set of chords the page wants now. Whole state,
 * like the Back claim, so a dropped frame cannot leave a chord registered; empty releases them all.
 */
export const BRIDGE_KEY_COMMANDS_CLAIM_NOTIFY = 'key-commands-claim'

/** Shell to page, a frame: one press of a claimed chord, named by the id the page gave it. */
export const BRIDGE_KEY_COMMAND_FRAME = 'keyCommand'

/** More than the page will ever claim at once; the cap keeps a bad page from flooding the menu. */
export const BRIDGE_MAX_KEY_COMMANDS = 32

/** Keys with no printable character, named as UIKeyCommand spells them on the native side. */
export const BRIDGE_KEY_COMMAND_NAMED_INPUTS = [
  'escape',
  'enter',
  'tab',
  'space',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'arrowRight'
] as const

export const BRIDGE_KEY_COMMAND_MODIFIERS = ['command', 'shift', 'alternate', 'control'] as const
export type BridgeKeyCommandModifier = (typeof BRIDGE_KEY_COMMAND_MODIFIERS)[number]

export const BridgeKeyCommandIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9.:_-]{0,95}$/)

export const BridgeKeyCommandSchema = z.object({
  id: BridgeKeyCommandIdSchema,
  // One printable ASCII character (lowercase letters, as UIKeyCommand matches them) or a named key.
  input: z.union([
    z.string().regex(/^[\x21-\x40\x5b-\x7e]$/),
    z.enum(BRIDGE_KEY_COMMAND_NAMED_INPUTS)
  ]),
  // A chord with no modifier would steal plain typing from every field on the page.
  modifiers: z
    .array(z.enum(BRIDGE_KEY_COMMAND_MODIFIERS))
    .min(1)
    .max(BRIDGE_KEY_COMMAND_MODIFIERS.length)
    .refine((modifiers) => new Set(modifiers).size === modifiers.length, 'duplicate modifier'),
  // Shown in the Cmd-hold overlay.
  title: z.string().min(1).max(64)
})
export type BridgeKeyCommand = z.infer<typeof BridgeKeyCommandSchema>

export const BridgeKeyCommandsSchema = z
  .array(BridgeKeyCommandSchema)
  .max(BRIDGE_MAX_KEY_COMMANDS)
  .refine(
    (commands) => new Set(commands.map((command) => command.id)).size === commands.length,
    'duplicate id'
  )
export type BridgeKeyCommands = readonly BridgeKeyCommand[]

/** The chord itself, ignoring id and title: two commands with one identity cannot both fire. */
export function keyCommandChordIdentity(command: Pick<BridgeKeyCommand, 'input' | 'modifiers'>) {
  return `${[...command.modifiers].sort().join('+')}+${command.input}`
}

export function sameKeyCommands(a: BridgeKeyCommands, b: BridgeKeyCommands): boolean {
  return (
    a.length === b.length &&
    a.every((command, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        command.id === other.id &&
        command.input === other.input &&
        command.title === other.title &&
        keyCommandChordIdentity(command) === keyCommandChordIdentity(other)
      )
    })
  )
}
