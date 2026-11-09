import {
  BRIDGE_MAX_KEY_COMMANDS,
  keyCommandChordIdentity,
  sameKeyCommands,
  type BridgeKeyCommand,
  type BridgeKeyCommands
} from '../mobile-web-shell/bridge/bridge-key-commands'

type Scope = { commands: BridgeKeyCommands; onCommand: (id: string) => void }

export type KeyCommandClaim = (() => void) & {
  /** Replaces this scope's chords in place, keeping its place in the stack. */
  update: (commands: BridgeKeyCommands) => void
}

/**
 * The page's scope stack for hardware-keyboard chords. The newest scope (a palette over a session
 * over the host) wins an id and a chord; older scopes keep whatever it does not take. The shell
 * gets the merged set as one whole claim, re-sent only when it changes or a new `init` asks.
 */
export function createKeyCommandRegistry(publish: (commands: BridgeKeyCommands) => void) {
  const scopes: Scope[] = []
  let published: BridgeKeyCommands = []
  let owners = new Map<string, Scope>()

  function refresh(): void {
    const ids = new Set<string>()
    const chords = new Set<string>()
    const merged: BridgeKeyCommand[] = []
    const nextOwners = new Map<string, Scope>()
    for (const scope of scopes.toReversed()) {
      for (const command of scope.commands) {
        const chord = keyCommandChordIdentity(command)
        if (ids.has(command.id) || chords.has(chord) || merged.length >= BRIDGE_MAX_KEY_COMMANDS) {
          continue
        }
        ids.add(command.id)
        chords.add(chord)
        merged.push(command)
        nextOwners.set(command.id, scope)
      }
    }
    owners = nextOwners
    if (!sameKeyCommands(merged, published)) {
      published = merged
      publish(merged)
    }
  }

  return {
    claim(commands: BridgeKeyCommands, onCommand: (id: string) => void): KeyCommandClaim {
      const scope: Scope = { commands, onCommand }
      scopes.push(scope)
      refresh()
      const release = () => {
        const index = scopes.indexOf(scope)
        if (index !== -1) {
          scopes.splice(index, 1)
          refresh()
        }
      }
      return Object.assign(release, {
        update: (next: BridgeKeyCommands) => {
          if (scopes.includes(scope) && !sameKeyCommands(scope.commands, next)) {
            scope.commands = next
            refresh()
          }
        }
      })
    },
    /** One press from the shell. An id no scope holds now (a press that raced a release) is dropped. */
    accept(id: string): void {
      owners.get(id)?.onCommand(id)
    },
    /** A new `init` drops the shell's copy of the claim, so the page states it again. */
    reassert(): void {
      if (published.length > 0) {
        publish(published)
      }
    }
  }
}

export type KeyCommandRegistry = ReturnType<typeof createKeyCommandRegistry>
