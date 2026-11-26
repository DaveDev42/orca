import type { SpikeEvent, SpikeEventLog } from './spike-event-log'
import type { SpikeProxyEntry } from './spike-native'

export type SpikeStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip'
export type SpikeResult = { status: 'pass' | 'fail' | 'skip'; detail: string }

/** What a test may do. The screen implements it over the native module and the mounted WebView. */
export type SpikeContext = {
  localPort: number
  events: SpikeEventLog
  entryMark: () => number
  entriesSince: (mark: number) => SpikeProxyEntry[]
  loadUrl: (url: string) => Promise<void>
  /** A page from the local server; falls back to inline HTML when the local server cannot be loaded. */
  loadPage: (name: string, query?: string) => Promise<void>
  isLocalReachable: () => boolean
  setEgress: (mode: 'native' | 'js') => void
  jsChunkCount: () => number
  setBlockWebRTC: (value: boolean) => Promise<void>
  setAcceptBadCerts: (value: boolean) => void
  sleep: (ms: number) => Promise<void>
}

export type SpikeTestDefinition = {
  id: string
  title: string
  decides: string
  run: (context: SpikeContext) => Promise<SpikeResult>
}

export type PageMessage = Record<string, unknown>

export function proxySaw(entries: readonly SpikeProxyEntry[], hostPort: string): boolean {
  return entries.some(
    (entry) =>
      (entry.kind === 'CONNECT' || entry.kind === 'FORWARD') &&
      entry.auth === 'ok' &&
      entry.target === hostPort
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parsePageMessage(event: SpikeEvent): PageMessage | null {
  if (event.kind !== 'page' || typeof event.json !== 'string') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(event.json)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function waitPage(
  context: SpikeContext,
  mark: number,
  type: string,
  timeoutMs: number
): Promise<PageMessage | null> {
  const hit = await context.events.wait(
    mark,
    (event) => parsePageMessage(event)?.type === type,
    timeoutMs
  )
  return hit ? parsePageMessage(hit) : null
}

export type NavOutcome = { ok: boolean; detail: string }

export async function loadAndWait(
  context: SpikeContext,
  url: string,
  timeoutMs = 20000
): Promise<NavOutcome> {
  const mark = context.events.length
  await context.loadUrl(url)
  const hit = await context.events.wait(
    mark,
    (event) =>
      event.kind === 'nav' &&
      (event.phase === 'finish' || event.phase === 'fail' || event.phase === 'terminated'),
    timeoutMs
  )
  if (!hit) {
    return { ok: false, detail: 'timeout' }
  }
  if (hit.phase === 'finish') {
    return { ok: true, detail: 'loaded' }
  }
  return {
    ok: false,
    detail:
      `${String(hit.phase)} ${String(hit.domain ?? '')} ${String(hit.code ?? '')} ${String(hit.error ?? '')}`.trim()
  }
}

export function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//, '').split('/')[0]
}

export function verdict(ok: boolean, detail: string): SpikeResult {
  return { status: ok ? 'pass' : 'fail', detail }
}
