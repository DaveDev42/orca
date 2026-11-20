import { useEffect, useState } from 'react'
import { ListRow } from '../components/list/ListGroup'
import { MobileSwitch } from '../components/controls/MobileSwitch'
import { useForkTranslation } from '../fork-i18n/use-fork-translation'
import {
  loadDictationAutoSend,
  loadDictationAutoStop,
  saveDictationAutoSend,
  saveDictationAutoStop
} from '../storage/preferences'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { SettingsSection } from './settings-screen-frame'

// Phone-only switches for a tap-mode dictation that ends when the speaker goes quiet and then sends; both on until turned off.
export function VoiceAutoStopSection({ first }: { first: boolean }) {
  useMobileColorScheme()
  const t = useForkTranslation()
  const [autoStop, setAutoStop] = useState(true)
  const [autoSend, setAutoSend] = useState(true)
  useEffect(() => {
    let active = true
    void Promise.all([loadDictationAutoStop(), loadDictationAutoSend()]).then(([stop, send]) => {
      if (active) {
        setAutoStop(stop)
        setAutoSend(send)
      }
    })
    return () => {
      active = false
    }
  }, [])
  const stopTitle = t('settings.voiceAutoStop.stopTitle', 'Stop when I go quiet')
  const sendTitle = t('settings.voiceAutoStop.sendTitle', 'Send after stopping')
  return (
    <SettingsSection
      first={first}
      title={t('settings.voiceAutoStop.heading', 'WHEN YOU STOP TALKING')}
    >
      <ListRow
        key="auto-stop"
        title={stopTitle}
        subtitle={t(
          'settings.voiceAutoStop.stopSubtitle',
          'A tap-mode dictation ends by itself after about 1.6 seconds of silence.'
        )}
        accessory={
          <MobileSwitch
            testID="voice-auto-stop"
            accessibilityLabel={stopTitle}
            value={autoStop}
            onValueChange={(on) => {
              setAutoStop(on)
              void saveDictationAutoStop(on)
            }}
          />
        }
      />
      <ListRow
        key="auto-send"
        title={sendTitle}
        subtitle={t(
          'settings.voiceAutoStop.sendSubtitle',
          'Sends the message once the dictation ended by itself and its words are in the box.'
        )}
        disabled={!autoStop}
        accessory={
          <MobileSwitch
            testID="voice-auto-send"
            accessibilityLabel={sendTitle}
            value={autoSend}
            disabled={!autoStop}
            onValueChange={(on) => {
              setAutoSend(on)
              void saveDictationAutoSend(on)
            }}
          />
        }
      />
    </SettingsSection>
  )
}
