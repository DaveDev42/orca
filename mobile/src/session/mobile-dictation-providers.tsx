import type { ReactNode } from 'react'
import type { UseMobileDictationResult } from '../hooks/mobile-dictation-session-state'
import { MobileDictationMeterContext } from './mobile-dictation-meter-context'
import { MobileDictationStopContext } from './mobile-dictation-stop-context'

/** What the chat composers read from the live dictation: its meter, and the stop their Send uses (null while dictation is off). */
export function MobileDictationProviders({
  dictation,
  enabled,
  children
}: {
  dictation: Pick<UseMobileDictationResult, 'meter' | 'stop'>
  enabled: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <MobileDictationMeterContext.Provider value={dictation.meter}>
      <MobileDictationStopContext.Provider value={enabled ? dictation.stop : null}>
        {children}
      </MobileDictationStopContext.Provider>
    </MobileDictationMeterContext.Provider>
  )
}
