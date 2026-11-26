import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text, TextInput, View, type NativeSyntheticEvent } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { SettingsScreen } from '../settings-screen-frame'
import { badgeStyle, Button, styles, ToggleRow } from './this-device-spike-parts'
import { decodeBase64 } from './spike-base64'
import { SpikeEventLog } from './spike-event-log'
import {
  getSpikeNativeModule,
  SpikeWebView,
  type SpikeEnvironment,
  type SpikeProxyEntry,
  type SpikeWebViewHandle
} from './spike-native'
import { buildSpikePages } from './spike-pages'
import { formatEvent, formatProxyEntry, formatSpikeReport } from './spike-report'
import { SPIKE_TESTS, type SpikeContext, type SpikeResult, type SpikeStatus } from './spike-tests'

const INLINE_BASE_URL = 'https://spike.invalid/'

type Ports = { proxyPort: number; localPort: number }

/** Hidden "Labs: This device spike" screen (design PR 0). Opened by tapping the version on About five times. */
export default function ThisDeviceSpikeScreen({ onBack }: { onBack: () => void }) {
  useMobileColorScheme()
  const native = useMemo(() => getSpikeNativeModule(), [])
  const events = useRef(new SpikeEventLog()).current
  const webRef = useRef<SpikeWebViewHandle | null>(null)
  const pagesRef = useRef<Record<string, string>>({})
  const localOkRef = useRef(true)
  const blockRef = useRef(false)
  const [environment, setEnvironment] = useState<SpikeEnvironment | null>(null)
  const [ports, setPorts] = useState<Ports | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [useProxy, setUseProxy] = useState(true)
  const [applyCredential, setApplyCredential] = useState(false)
  const [blockWebRTC, setBlockWebRTC] = useState(false)
  const [storeNonce, setStoreNonce] = useState(0)
  const [viaJS, setViaJS] = useState(false)
  const [acceptBadCerts, setAcceptBadCerts] = useState(false)
  const [viewReady, setViewReady] = useState(false)
  const [viewNonce, setViewNonce] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, SpikeStatus | undefined>>({})
  const [results, setResults] = useState<Record<string, SpikeResult | undefined>>({})
  const [entries, setEntries] = useState<SpikeProxyEntry[]>([])
  const [eventLines, setEventLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [urlText, setUrlText] = useState('https://example.com/')
  const [copied, setCopied] = useState(false)

  const refreshEntries = useCallback(() => {
    if (native) {
      setEntries(native.proxyEntries(0))
    }
  }, [native])

  useEffect(() => {
    if (!native) {
      return
    }
    setEnvironment(native.environment())
    native.log('screen opened')
    native
      .start()
      .then((started) => {
        pagesRef.current = buildSpikePages(`http://localhost:${started.localPort}`)
        native.setPages(pagesRef.current)
        setPorts(started)
      })
      .catch((error: unknown) => setStartError(String(error)))
  }, [native])

  // "Via JS" egress: each tunnel chunk comes up as an event, is decoded here, and goes back through a sync call.
  useEffect(() => {
    if (!native) {
      return
    }
    const subscription = native.addListener('onTunnelChunk', (chunk) => {
      native.tunnelReply(chunk.conn, chunk.dir, chunk.seq, decodeBase64(chunk.b64))
    })
    return () => subscription.remove()
  }, [native])

  useEffect(() => {
    const timer = setInterval(refreshEntries, 1500)
    return () => clearInterval(timer)
  }, [refreshEntries])

  const onSpikeEvent = useCallback(
    (event: NativeSyntheticEvent<Record<string, unknown>>) => {
      const payload = event.nativeEvent
      events.push(payload)
      if (payload.kind === 'ready') {
        setViewReady(true)
      }
      setEventLines((previous) => {
        const line =
          payload.kind === 'page'
            ? `page ${String(payload.json).slice(0, 300)}`
            : formatEvent({ ...payload, kind: String(payload.kind), at: 0 })
        return [...previous.slice(-79), line]
      })
    },
    [events]
  )

  const remountWith = useCallback(
    async (change: () => void): Promise<void> => {
      const mark = events.length
      setViewReady(false)
      change()
      setViewNonce((value) => value + 1)
      await events.wait(mark, (event) => event.kind === 'ready', 10000)
    },
    [events]
  )

  const context = useMemo((): SpikeContext | null => {
    if (!native || !ports) {
      return null
    }
    return {
      localPort: ports.localPort,
      events,
      entryMark: () => native.proxyEntryCount(),
      entriesSince: (mark) => native.proxyEntries(mark),
      loadUrl: async (url) => (await webRef.current?.loadUrl(url)) ?? -1,
      freshStore: () => remountWith(() => setStoreNonce((value) => value + 1)),
      loadPage: async (name, query = '') => {
        const mark = events.length
        await webRef.current?.loadUrl(`http://localhost:${ports.localPort}/p/${name}${query}`)
        const hit = await events.wait(
          mark,
          (event) => event.kind === 'nav' && (event.phase === 'finish' || event.phase === 'fail'),
          10000
        )
        if (hit?.phase === 'finish') {
          localOkRef.current = true
          return
        }
        localOkRef.current = false
        native.log(`local page ${name} not loadable, falling back to inline HTML`)
        await webRef.current?.loadHtml(pagesRef.current[name] ?? '', INLINE_BASE_URL)
      },
      isLocalReachable: () => localOkRef.current,
      setEgress: (mode) => {
        native.setEgressMode(mode)
        setViaJS(mode === 'js')
      },
      jsChunkCount: () => native.jsChunkCount(),
      setBlockWebRTC: async (value) => {
        if (blockRef.current === value) {
          return
        }
        blockRef.current = value
        await remountWith(() => setBlockWebRTC(value))
      },
      setAcceptBadCerts: (value) => setAcceptBadCerts(value),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    }
  }, [native, ports, events, remountWith])

  const runTest = useCallback(
    async (id: string): Promise<void> => {
      const definition = SPIKE_TESTS.find((test) => test.id === id)
      if (!definition || !context || !native) {
        return
      }
      setStatuses((previous) => ({ ...previous, [id]: 'running' }))
      native.log(`TEST ${id} start`)
      let result: SpikeResult
      try {
        result = await definition.run(context)
      } catch (error) {
        result = { status: 'fail', detail: `exception ${String(error)}` }
      }
      native.log(`RESULT ${id} ${result.status.toUpperCase()} ${result.detail}`)
      setStatuses((previous) => ({ ...previous, [id]: result.status }))
      setResults((previous) => ({ ...previous, [id]: result }))
      refreshEntries()
    },
    [context, native, refreshEntries]
  )

  const runExclusive = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (running) {
        return
      }
      setRunning(true)
      try {
        for (const id of ids) {
          await runTest(id)
        }
      } finally {
        setRunning(false)
      }
    },
    [running, runTest]
  )

  const copyResults = useCallback(async () => {
    const report = formatSpikeReport({
      environment,
      ports,
      settings: { useProxy, applyCredential, blockWebRTC, viaJS },
      tests: SPIKE_TESTS,
      results,
      statuses,
      entries: native ? native.proxyEntries(0) : [],
      events: events.since(0)
    })
    native?.log(`REPORT\n${report}`)
    await Clipboard.setStringAsync(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [
    environment,
    ports,
    useProxy,
    applyCredential,
    blockWebRTC,
    viaJS,
    results,
    statuses,
    native,
    events
  ])

  if (!native) {
    return (
      <SettingsScreen title="This device spike" onBack={onBack}>
        <Text style={styles.note}>
          This spike only exists in iOS builds that include the native module.
        </Text>
      </SettingsScreen>
    )
  }

  const supported = environment?.proxyConfigurationsAvailable ?? false
  const iosNote =
    environment && environment.major < 18
      ? 'iOS below 18: the design needs 18+ (http: tunnel fix). Results here are only partial.'
      : null

  return (
    <SettingsScreen title="This device spike" onBack={onBack}>
      <Text style={styles.note}>
        {`iOS ${environment?.systemVersion ?? '?'} - proxy 127.0.0.1:${ports?.proxyPort ?? '...'} - local server 127.0.0.1:${ports?.localPort ?? '...'}${supported ? '' : ' - proxyConfigurations unavailable (needs iOS 17)'}`}
      </Text>
      {iosNote ? <Text style={styles.warn}>{iosNote}</Text> : null}
      {startError ? <Text style={styles.warn}>{`start failed: ${startError}`}</Text> : null}

      <ToggleRow
        label="Use the proxy (off = control run)"
        value={useProxy}
        disabled={running}
        onChange={(value) => void remountWith(() => setUseProxy(value))}
      />
      <ToggleRow
        label="Pre-apply credential (ProxyConfiguration.applyCredential)"
        value={applyCredential}
        disabled={running}
        onChange={(value) => void remountWith(() => setApplyCredential(value))}
      />
      <ToggleRow
        label="Block WebRTC (document-start script)"
        value={blockWebRTC}
        disabled={running}
        onChange={(value) => {
          blockRef.current = value
          void remountWith(() => setBlockWebRTC(value))
        }}
      />
      <ToggleRow
        label="Egress via JS thread"
        value={viaJS}
        disabled={running}
        onChange={(value) => {
          native.setEgressMode(value ? 'js' : 'native')
          setViaJS(value)
        }}
      />

      <View style={styles.webFrame}>
        {ports ? (
          <SpikeWebView
            key={`${viewNonce}-${String(useProxy)}-${String(applyCredential)}-${String(blockWebRTC)}-${String(storeNonce)}`}
            ref={webRef}
            style={styles.web}
            useProxy={useProxy}
            applyCredential={applyCredential}
            blockWebRTC={blockWebRTC}
            storeNonce={storeNonce}
            acceptBadCerts={acceptBadCerts}
            onSpikeEvent={onSpikeEvent}
          />
        ) : (
          <Text style={styles.note}>starting...</Text>
        )}
      </View>

      <View style={styles.urlRow}>
        <TextInput
          style={styles.urlInput}
          value={urlText}
          onChangeText={setUrlText}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://..."
          placeholderTextColor={colors.textMuted}
        />
        <Button
          label="Go"
          disabled={!viewReady}
          onPress={() => void webRef.current?.loadUrl(urlText.trim())}
        />
      </View>

      <View style={styles.buttonRow}>
        <Button
          label={running ? 'Running...' : 'Run all'}
          disabled={!context || !viewReady || running}
          onPress={() => void runExclusive(SPIKE_TESTS.map((test) => test.id))}
        />
        <Button label={copied ? 'Copied' : 'Copy results'} onPress={() => void copyResults()} />
        <Button
          label="Clear site data"
          disabled={running}
          onPress={() => void native.clearWebsiteData()}
        />
      </View>

      {SPIKE_TESTS.map((test) => {
        const status = statuses[test.id] ?? 'idle'
        const result = results[test.id]
        return (
          <View key={test.id} style={styles.testCard}>
            <View style={styles.testHeader}>
              <Text style={styles.testTitle}>{test.title}</Text>
              <Text style={[styles.badge, badgeStyle(status)]}>{status.toUpperCase()}</Text>
            </View>
            {result ? <Text style={styles.detail}>{result.detail}</Text> : null}
            <Button
              label="Run"
              disabled={!context || !viewReady || running}
              onPress={() => void runExclusive([test.id])}
            />
          </View>
        )
      })}

      <Text style={styles.heading}>{`Proxy log (${entries.length})`}</Text>
      <Text style={styles.mono}>
        {entries.slice(-60).map(formatProxyEntry).join('\n') || '(empty)'}
      </Text>
      <Text style={styles.heading}>WebView events</Text>
      <Text style={styles.mono}>{eventLines.slice(-40).join('\n') || '(empty)'}</Text>
    </SettingsScreen>
  )
}
