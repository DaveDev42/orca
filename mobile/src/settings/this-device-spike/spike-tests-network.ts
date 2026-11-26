import type { SpikeTestDefinition } from './spike-test-helpers'
import {
  hostOf,
  loadAndWait,
  proxySaw,
  verdict,
  waitPage,
  type SpikeContext
} from './spike-test-helpers'

export const runLocalhost: SpikeTestDefinition['run'] = async (context) => {
  const lines: string[] = []
  let allOk = true
  for (const host of ['localhost', '127.0.0.1']) {
    const mark = context.entryMark()
    const eventMark = context.events.length
    await context.loadUrl(`http://${host}:${context.localPort}/?r=${Date.now()}`)
    const page = await waitPage(context, eventMark, 'hello', 8000)
    await context.sleep(300)
    const seen = proxySaw(context.entriesSince(mark), `${host}:${context.localPort}`)
    const nav = page
      ? null
      : await context.events.wait(eventMark, (e) => e.kind === 'nav' && e.phase === 'fail', 500)
    const state = page
      ? seen
        ? 'loaded, proxied'
        : 'loaded, BYPASSED the proxy'
      : `not loaded (${nav ? `${String(nav.domain)} ${String(nav.code)}` : 'timeout'})`
    lines.push(`${host}: ${state}`)
    if (!page || !seen) {
      allOk = false
    }
  }
  return verdict(allOk, lines.join('; '))
}

export const runHttps: SpikeTestDefinition['run'] = async (context) => {
  const mark = context.entryMark()
  const eventMark = context.events.length
  const outcome = await loadAndWait(context, 'https://example.com/')
  await context.sleep(300)
  const entries = context.entriesSince(mark)
  const seen = proxySaw(entries, 'example.com:443')
  const challenges = context.events
    .since(eventMark)
    .filter((e) => e.kind === 'challenge' && e.isProxy === true).length
  return verdict(
    outcome.ok && seen,
    `${outcome.detail}; proxy saw CONNECT example.com:443 = ${seen}; 407s=${entries.filter((e) => e.kind === '407').length}; proxy challenges at delegate=${challenges}`
  )
}

const AUTH_HOSTS = [
  'https://example.org/',
  'https://example.net/',
  'https://www.iana.org/',
  'https://httpbin.org/get',
  'https://www.wikipedia.org/'
]

export const runAuth: SpikeTestDefinition['run'] = async (context) => {
  const lines: string[] = []
  let good = 0
  let delegateChallenges = 0
  let sent407 = 0
  for (const url of AUTH_HOSTS) {
    const mark = context.entryMark()
    const eventMark = context.events.length
    const outcome = await loadAndWait(context, url)
    await context.sleep(300)
    const entries = context.entriesSince(mark)
    const host = hostOf(url)
    const authorized = proxySaw(entries, `${host}:443`)
    delegateChallenges += context.events
      .since(eventMark)
      .filter((e) => e.kind === 'challenge' && e.isProxy === true).length
    sent407 += entries.filter((e) => e.kind === '407').length
    lines.push(
      `${host}: ${outcome.ok ? 'loaded' : outcome.detail}${authorized ? '' : ' (no authorized CONNECT)'}`
    )
    if (outcome.ok && authorized) {
      good += 1
    }
  }
  return verdict(
    good === AUTH_HOSTS.length,
    `${good}/${AUTH_HOSTS.length} cold hosts loaded with an authorized CONNECT; 407s sent=${sent407}; proxy challenges answered at the delegate=${delegateChallenges}. ${lines.join(' | ')}`
  )
}

export const runWebSocket: SpikeTestDefinition['run'] = async (context) => {
  const mark = context.entryMark()
  const eventMark = context.events.length
  await context.loadPage('ws')
  const message = await waitPage(context, eventMark, 'ws', 40000)
  await context.sleep(300)
  if (!message) {
    return verdict(false, 'page never reported')
  }
  if (message.ok !== true) {
    return verdict(false, `echo failed: ${JSON.stringify(message.tries)}`)
  }
  const host = hostOf(String(message.url))
  const seen = proxySaw(context.entriesSince(mark), `${host}:443`)
  return verdict(
    seen,
    `echo ok in ${String(message.ms)} ms via ${String(message.url)}; proxy saw CONNECT ${host}:443 = ${seen}${seen ? '' : ' (the WebSocket bypassed the proxy)'}`
  )
}

async function downloadOnce(
  context: SpikeContext,
  url: string,
  hostPort: string | null
): Promise<string> {
  const mark = context.entryMark()
  const eventMark = context.events.length
  await context.loadUrl(url)
  const hit = await context.events.wait(
    eventMark,
    (e) => e.kind === 'download' && (e.phase === 'finish' || e.phase === 'fail'),
    90000
  )
  await context.sleep(300)
  if (!hit) {
    return 'FAIL timeout'
  }
  if (hit.phase !== 'finish') {
    return `FAIL ${String(hit.error)}`
  }
  const bytes = Number(hit.bytes)
  const seen = hostPort ? proxySaw(context.entriesSince(mark), hostPort) : true
  return `${bytes >= 5_000_000 && seen ? 'ok' : 'FAIL'} ${bytes} bytes${hostPort ? `, proxy saw ${hostPort} = ${seen}` : ''}`
}

export const runDownload: SpikeTestDefinition['run'] = async (context) => {
  const publicLine = await downloadOnce(
    context,
    'https://proof.ovh.net/files/10Mb.dat',
    'proof.ovh.net:443'
  )
  const localLine = context.isLocalReachable()
    ? await downloadOnce(
        context,
        `http://localhost:${context.localPort}/download?n=10000000`,
        `localhost:${context.localPort}`
      )
    : 'skipped (localhost not loadable)'
  return verdict(publicLine.startsWith('ok'), `public: ${publicLine}; local: ${localLine}`)
}

export const runServerTrust: SpikeTestDefinition['run'] = async (context) => {
  context.setAcceptBadCerts(true)
  await context.sleep(400)
  const eventMark = context.events.length
  const outcome = await loadAndWait(context, 'https://self-signed.badssl.com/')
  context.setAcceptBadCerts(false)
  const trust = context.events
    .since(eventMark)
    .filter((e) => e.kind === 'challenge' && String(e.method).includes('ServerTrust'))
  return verdict(
    trust.length > 0 && outcome.ok,
    `server-trust challenges at the delegate = ${trust.length} (answered by accepting the cert); page ${outcome.detail}`
  )
}
