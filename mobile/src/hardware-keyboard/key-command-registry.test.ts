import { describe, expect, it } from 'vitest'
import type {
  BridgeKeyCommand,
  BridgeKeyCommands
} from '../mobile-web-shell/bridge/bridge-key-commands'
import { createKeyCommandRegistry } from './key-command-registry'

function command(id: string, input = 'w', title = id): BridgeKeyCommand {
  return { id, input, modifiers: ['command'], title }
}

function setup() {
  const published: BridgeKeyCommands[] = []
  const registry = createKeyCommandRegistry((commands) => published.push(commands))
  return { registry, published }
}

describe('the key command scope stack', () => {
  it('gives a shared chord and a shared id to the newest scope, and back on release', () => {
    const { registry, published } = setup()
    const pressed: string[] = []
    registry.claim([command('tab.close'), command('tab.new', 't')], (id) =>
      pressed.push(`host:${id}`)
    )
    const palette = registry.claim([command('palette.close')], (id) =>
      pressed.push(`palette:${id}`)
    )
    expect(published.at(-1)?.map((entry) => entry.id)).toEqual(['palette.close', 'tab.new'])

    registry.accept('palette.close')
    registry.accept('tab.close')
    expect(pressed).toEqual(['palette:palette.close'])

    palette()
    expect(published.at(-1)?.map((entry) => entry.id)).toEqual(['tab.close', 'tab.new'])
    registry.accept('tab.close')
    expect(pressed).toEqual(['palette:palette.close', 'host:tab.close'])
  })

  it('dedups by id across scopes even when the chords differ', () => {
    const { registry, published } = setup()
    registry.claim([command('tab.close', 'w')], () => {})
    registry.claim([command('tab.close', 'q')], () => {})
    expect(published.at(-1)).toEqual([command('tab.close', 'q')])
  })

  it('publishes only real changes and reasserts the last set on a new init', () => {
    const { registry, published } = setup()
    const claim = registry.claim([], () => {})
    expect(published).toEqual([])
    claim.update([command('tab.close')])
    claim.update([command('tab.close')])
    expect(published).toHaveLength(1)
    registry.reassert()
    expect(published).toHaveLength(2)
    claim()
    expect(published.at(-1)).toEqual([])
  })

  it('ignores a press for an id no scope holds', () => {
    const { registry } = setup()
    const pressed: string[] = []
    const claim = registry.claim([command('tab.close')], (id) => pressed.push(id))
    claim()
    registry.accept('tab.close')
    registry.accept('never.claimed')
    expect(pressed).toEqual([])
  })
})
