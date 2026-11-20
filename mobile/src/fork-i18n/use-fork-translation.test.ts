import { afterEach, describe, expect, it } from 'vitest'
import { activateMobileUiLocale } from '../i18n/mobile-i18n'
import { forkDictationCopy, forkTranslate } from './use-fork-translation'

describe('forkTranslate', () => {
  afterEach(async () => {
    await activateMobileUiLocale('en')
  })

  it('uses the inline English default for English', () => {
    expect(forkTranslate('session.keyCommands.closeTab', 'Close Tab')).toBe('Close Tab')
    expect(forkTranslate('session.keyCommands.selectTab', 'Tab {{n}}', { n: 3 })).toBe('Tab 3')
    expect(forkDictationCopy.stoppedAfterQuiet()).toBe('Stopped after you went quiet')
  })

  it('uses this fork’s table for the active language, with interpolation', async () => {
    await activateMobileUiLocale('ko')
    expect(forkTranslate('session.keyCommands.closeTab', 'Close Tab')).toBe('탭 닫기')
    expect(forkTranslate('hostScreen.keyCommands.openWorkspace', 'Workspace {{n}}', { n: 2 })).toBe(
      '워크스페이스 2'
    )
  })

  it('falls back to English for a key the table does not hold', async () => {
    await activateMobileUiLocale('ko')
    expect(forkTranslate('nope.key', 'Plain')).toBe('Plain')
  })
})
