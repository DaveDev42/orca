import { describe, expect, it } from 'vitest'
import { clientFrame } from './bridge-host-test-fakes'
import { harness } from './bridge-host-test-harness'
import { MOBILE_WEB_SHELL_GRANTS } from './page-route-policy'
import { readBridgeClientMessage } from './bridge/bridge-envelope'
import {
  BRIDGE_KEY_COMMAND_FRAME,
  BRIDGE_KEY_COMMANDS_CLAIM_NOTIFY,
  BRIDGE_KEY_COMMANDS_GRANT,
  BRIDGE_MAX_KEY_COMMANDS,
  type BridgeKeyCommand
} from './bridge/bridge-key-commands'
import { createPageClient, INIT } from './bridge/bridge-page-client-test-harness'

const CLOSE: BridgeKeyCommand = {
  id: 'tab.close',
  input: 'w',
  modifiers: ['command'],
  title: 'Close Tab'
}

function claim(commands: unknown): string {
  return clientFrame({ type: 'notify', name: BRIDGE_KEY_COMMANDS_CLAIM_NOTIFY, commands })
}

describe('the key-commands claim schema', () => {
  it.each([
    ['no modifier', [{ ...CLOSE, modifiers: [] }]],
    ['an unknown modifier', [{ ...CLOSE, modifiers: ['hyper'] }]],
    ['a repeated modifier', [{ ...CLOSE, modifiers: ['command', 'command'] }]],
    ['an uppercase letter', [{ ...CLOSE, input: 'W' }]],
    ['a two-character input', [{ ...CLOSE, input: 'ww' }]],
    ['an empty title', [{ ...CLOSE, title: '' }]],
    ['a malformed id', [{ ...CLOSE, id: '<script>' }]],
    ['a repeated id', [CLOSE, { ...CLOSE, input: 'q' }]],
    [
      'more commands than the cap',
      Array.from({ length: BRIDGE_MAX_KEY_COMMANDS + 1 }, (_, index) => ({
        ...CLOSE,
        id: `action.${index}`
      }))
    ]
  ])('refuses %s', (_, commands) => {
    expect(readBridgeClientMessage(claim(commands)).ok).toBe(false)
  })

  it('reads a well-formed claim', () => {
    expect(readBridgeClientMessage(claim([CLOSE])).ok).toBe(true)
  })
})

describe('a key-commands claim at the shell', () => {
  it('registers nothing for a page whose route was not granted key commands', () => {
    const { host, keyCommandClaims, diagnostics } = harness({
      ready: true,
      routeGrants: MOBILE_WEB_SHELL_GRANTS.filter((grant) => grant !== BRIDGE_KEY_COMMANDS_GRANT)
    })
    host.receive(claim([CLOSE]))
    expect(keyCommandClaims).toEqual([])
    expect(diagnostics).toContainEqual({
      kind: 'notify-refused',
      name: BRIDGE_KEY_COMMANDS_CLAIM_NOTIFY,
      why: 'ungranted'
    })
    expect(host.sendKeyCommand('tab.close')).toBe(false)
  })

  it('forwards a claimed id and ignores one the page does not hold', () => {
    const { host, keyCommandClaims, last, posted } = harness({ ready: true })
    host.receive(claim([CLOSE]))
    expect(keyCommandClaims).toEqual([[CLOSE]])
    const before = posted.length
    expect(host.sendKeyCommand('tab.closeAll')).toBe(false)
    expect(posted).toHaveLength(before)
    expect(host.sendKeyCommand('tab.close')).toBe(true)
    expect(last()).toEqual({ v: 1, type: BRIDGE_KEY_COMMAND_FRAME, id: 'tab.close' })
  })

  it('drops the claim when the document ends and carries it across a rebuild', () => {
    const first = harness({ ready: true })
    first.host.receive(claim([CLOSE]))
    const rebuilt = harness({
      sessionEstablished: true,
      sessionBack: first.host.readSessionBack()
    })
    expect(rebuilt.host.sendKeyCommand('tab.close')).toBe(true)
    rebuilt.host.receive(clientFrame({ type: 'close' }))
    expect(rebuilt.keyCommandClaims).toEqual([[]])
    expect(rebuilt.host.sendKeyCommand('tab.close')).toBe(false)
  })
})

describe('a key-commands claim at the page', () => {
  it('sends nothing to a shell that did not grant key commands', () => {
    const page = createPageClient()
    page.start()
    page.client.claimKeyCommands([CLOSE], () => {})
    expect(page.frames().filter((frame) => frame.type === 'notify')).toEqual([])
  })

  it('claims on a granting shell and ignores a press for an id it does not hold', () => {
    const page = createPageClient()
    const pressed: string[] = []
    page.client.claimKeyCommands([CLOSE], (id) => pressed.push(id))
    page.deliver({ ...INIT, grants: { ...INIT.grants, native: [BRIDGE_KEY_COMMANDS_GRANT] } })
    expect(page.frames().at(-1)).toMatchObject({
      name: BRIDGE_KEY_COMMANDS_CLAIM_NOTIFY,
      commands: [CLOSE]
    })
    page.deliver({ v: 1, type: BRIDGE_KEY_COMMAND_FRAME, id: 'tab.closeAll' })
    page.deliver({ v: 1, type: BRIDGE_KEY_COMMAND_FRAME, id: 'tab.close' })
    expect(pressed).toEqual(['tab.close'])
  })
})
