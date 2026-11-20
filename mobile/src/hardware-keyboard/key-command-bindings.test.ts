import { describe, expect, it } from 'vitest'
import { BridgeKeyCommandSchema } from '../mobile-web-shell/bridge/native-capabilities/bridge-key-commands'
import {
  actionIdOfKeyCommand,
  digitOfKeyCommand,
  isTextEditingChord,
  keyCommandsForAction,
  keyCommandsForDigitAction
} from './key-command-bindings'

describe('keyCommandsForAction', () => {
  it('reads the darwin binding from the shared keymap: Mod+W is Cmd+W', () => {
    expect(keyCommandsForAction('tab.close', 'Close Tab')).toEqual([
      { id: 'tab.close', input: 'w', modifiers: ['command'], title: 'Close Tab' }
    ])
  })

  it('keeps the chord in a terminal under the default orca-first policy', () => {
    expect(keyCommandsForAction('tab.close', 'Close Tab', 'terminal')).toHaveLength(1)
  })

  it('drops a chord the terminal owns while the terminal has focus under terminal-first', () => {
    expect(keyCommandsForAction('tab.close', 'Close Tab', 'terminal', 'terminal-first')).toEqual([])
    expect(keyCommandsForAction('tab.close', 'Close Tab', 'app', 'terminal-first')).toHaveLength(1)
  })

  it('leaves digit actions to keyCommandsForDigitAction', () => {
    expect(keyCommandsForAction('tab.selectByIndex', 'Select Tab')).toEqual([])
  })

  it('claims only the chords it is handed when an action names them', () => {
    expect(keyCommandsForAction('worktree.palette', 'Search', 'app', undefined, ['Mod+J'])).toEqual(
      [{ id: 'worktree.palette', input: 'j', modifiers: ['command'], title: 'Search' }]
    )
  })

  it('maps a named key to the character UIKeyCommand matches', () => {
    expect(keyCommandsForAction('tab.nextAllTypes', 'Next Tab')).toEqual([
      { id: 'tab.nextAllTypes', input: ']', modifiers: ['command', 'shift'], title: 'Next Tab' }
    ])
  })
})

describe('isTextEditingChord', () => {
  it.each([
    [{ input: 'a', modifiers: ['command'] }, true],
    [{ input: 'z', modifiers: ['command', 'shift'] }, true],
    [{ input: 'arrowLeft', modifiers: ['command'] }, true],
    [{ input: 'arrowUp', modifiers: ['command', 'shift'] }, true],
    [{ input: 'w', modifiers: ['command'] }, false],
    [{ input: 'c', modifiers: ['control'] }, false],
    [{ input: 'arrowLeft', modifiers: ['command', 'alternate'] }, false]
  ] as const)('%o is %s', (command, expected) => {
    expect(isTextEditingChord({ ...command, modifiers: [...command.modifiers] })).toBe(expected)
  })
})

describe('actionIdOfKeyCommand', () => {
  it('strips the index a second binding carries, and nothing else', () => {
    expect(actionIdOfKeyCommand('tab.close')).toBe('tab.close')
    expect(actionIdOfKeyCommand('tab.close:1')).toBe('tab.close')
    expect(actionIdOfKeyCommand('plugin:acme.run')).toBe('plugin:acme.run')
  })
})

describe('keyCommandsForDigitAction', () => {
  const title = (digit: number) => `Item ${digit}`

  it('gives tabs Ctrl+1-9, the desktop meaning on darwin', () => {
    const commands = keyCommandsForDigitAction('tab.selectByIndex', title)
    expect(commands.map((command) => command.input)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9'
    ])
    expect(commands.every((command) => command.modifiers.join() === 'control')).toBe(true)
    expect(commands[2]).toEqual({
      id: 'tab.selectByIndex:d3',
      input: '3',
      modifiers: ['control'],
      title: 'Item 3'
    })
  })

  it('gives workspaces Cmd+1-9', () => {
    const commands = keyCommandsForDigitAction('workspace.selectByIndex', title)
    expect(commands).toHaveLength(9)
    expect(commands.every((command) => command.modifiers.join() === 'command')).toBe(true)
  })

  it('never claims the same chord for a tab and a workspace', () => {
    const chords = [
      ...keyCommandsForDigitAction('tab.selectByIndex', title),
      ...keyCommandsForDigitAction('workspace.selectByIndex', title)
    ].map((command) => `${command.modifiers.join('+')}+${command.input}`)
    expect(new Set(chords).size).toBe(18)
  })

  it('produces commands the bridge accepts, and none for a non-digit action', () => {
    for (const command of keyCommandsForDigitAction('tab.selectByIndex', title)) {
      expect(BridgeKeyCommandSchema.safeParse(command).success).toBe(true)
    }
    expect(keyCommandsForDigitAction('tab.close', title)).toEqual([])
  })

  it('drops tab digits in a terminal under terminal-first, keeps them under orca-first', () => {
    expect(
      keyCommandsForDigitAction('tab.selectByIndex', title, 'terminal', 'orca-first')
    ).toHaveLength(9)
    expect(
      keyCommandsForDigitAction('tab.selectByIndex', title, 'terminal', 'terminal-first')
    ).toEqual([])
  })
})

describe('digit command ids', () => {
  it('reads the digit and the action back out of an id', () => {
    expect(digitOfKeyCommand('tab.selectByIndex:d7')).toBe(7)
    expect(digitOfKeyCommand('tab.close:1')).toBeNull()
    expect(digitOfKeyCommand('tab.close')).toBeNull()
    expect(actionIdOfKeyCommand('tab.selectByIndex:d7')).toBe('tab.selectByIndex')
    expect(actionIdOfKeyCommand('workspace.selectByIndex:d1')).toBe('workspace.selectByIndex')
  })
})
