import { useMemo } from 'react'
import { getMobileUiLocale, translate, type Translate } from '../i18n/mobile-i18n'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { FORK_LOCALE_TEXT } from './fork-locale-text'

// The key lookup stays first: only when the served catalog has no entry does the default apply,
// and the default is this fork's text for the active language, else the English inline default.
function forkDefault(key: string, fallback: string): string {
  return FORK_LOCALE_TEXT[getMobileUiLocale()]?.[key] ?? fallback
}

export const forkTranslate: Translate = (key, fallback, options) =>
  translate(key, forkDefault(key, fallback), options)

/** `useMobileTranslation` for this fork's own strings; re-renders with the language the same way. */
export function useForkTranslation(): Translate {
  const t = useMobileTranslation()
  return useMemo<Translate>(
    () => (key, fallback, options) => t(key, forkDefault(key, fallback), options),
    [t]
  )
}

/** Dictation toast copy of this fork; the upstream copy table stays untouched. */
export const forkDictationCopy = {
  stoppedAfterQuiet: () =>
    forkTranslate(
      'session.useNativeChatDictation.stoppedAfterQuiet',
      'Stopped after you went quiet'
    )
}
