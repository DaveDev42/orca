import { describe, expect, it } from 'vitest'
import {
  actionIdOfKeyCommand,
  isTextEditingChord,
  keyCommandsForAction
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

  it('leaves digit actions for the PR that wires them', () => {
    expect(keyCommandsForAction('tab.selectByIndex', 'Select Tab')).toEqual([])
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
