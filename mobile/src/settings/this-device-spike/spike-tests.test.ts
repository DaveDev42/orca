import { describe, expect, it } from 'vitest'
import { decodeBase64 } from './spike-base64'
import { SpikeEventLog } from './spike-event-log'
import { buildSpikePages } from './spike-pages'
import { formatSpikeReport } from './spike-report'
import { judgeWebRtc, parsePageMessage, proxySaw, SPIKE_TESTS } from './spike-tests'
import type { SpikeProxyEntry } from './spike-native'

const entry = (kind: string, target: string, auth = 'ok'): SpikeProxyEntry => ({
  i: 0,
  t: 0,
  kind,
  target,
  auth,
  extra: ''
})

describe('decodeBase64', () => {
  it('round-trips arbitrary bytes, padded or not', () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255)
      const text = Buffer.from(bytes).toString('base64')
      expect(Array.from(decodeBase64(text))).toEqual(Array.from(bytes))
      expect(Array.from(decodeBase64(text.replace(/=+$/, '')))).toEqual(Array.from(bytes))
    }
  })
})

describe('proxySaw', () => {
  it('counts only authorized CONNECT and FORWARD targets', () => {
    expect(proxySaw([entry('CONNECT', 'localhost:80')], 'localhost:80')).toBe(true)
    expect(proxySaw([entry('FORWARD', 'a:80')], 'a:80')).toBe(true)
    expect(proxySaw([entry('407', 'localhost:80', 'none')], 'localhost:80')).toBe(false)
    expect(proxySaw([entry('CONNECT', 'localhost:80', 'bad')], 'localhost:80')).toBe(false)
    expect(proxySaw([entry('CONNECT', 'b:80')], 'a:80')).toBe(false)
  })
})

describe('SpikeEventLog', () => {
  it('resolves a waiter on a later matching event and times out otherwise', async () => {
    const log = new SpikeEventLog()
    log.push({ kind: 'nav', phase: 'start' })
    const mark = log.length
    const pending = log.wait(mark, (event) => event.phase === 'finish', 500)
    log.push({ kind: 'nav', phase: 'finish' })
    expect((await pending)?.phase).toBe('finish')
    expect(await log.wait(log.length, () => true, 20)).toBeNull()
  })

  it('ignores events before the mark', async () => {
    const log = new SpikeEventLog()
    log.push({ kind: 'nav', phase: 'finish' })
    expect(await log.wait(log.length, (event) => event.phase === 'finish', 20)).toBeNull()
  })
})

describe('judgeWebRtc', () => {
  it('flags gathered candidates as a leak and a removed constructor as blocked', () => {
    const leak = judgeWebRtc(
      { hasRTC: true, candidates: [{ type: 'srflx', protocol: 'udp', address: '1.2.3.4' }] },
      false
    )
    expect(leak.status).toBe('fail')
    expect(judgeWebRtc({ hasRTC: true, candidates: [] }, false).status).toBe('pass')
    expect(judgeWebRtc({ hasRTC: false, candidates: [] }, true).status).toBe('pass')
    expect(judgeWebRtc({ hasRTC: true, candidates: [] }, true).status).toBe('fail')
  })
})

describe('parsePageMessage', () => {
  it('parses only page events carrying a JSON object', () => {
    const at = 0
    expect(parsePageMessage({ kind: 'page', at, json: '{"type":"x"}' })).toEqual({ type: 'x' })
    expect(parsePageMessage({ kind: 'nav', at, json: '{"type":"x"}' })).toBeNull()
    expect(parsePageMessage({ kind: 'page', at, json: 'nope' })).toBeNull()
  })
})

describe('spike pages', () => {
  it('ship scripts that parse', () => {
    const pages = buildSpikePages('http://localhost:1234')
    for (const [name, html] of Object.entries(pages)) {
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
      expect(scripts.length, name).toBeGreaterThan(0)
      for (const source of scripts) {
        expect(() => new Function(`return (async function(){${source}})`), name).not.toThrow()
      }
    }
    expect(pages.throughput).toContain('http://localhost:1234/bytes')
    expect(pages.throughput).not.toContain('__LOCAL__')
  })
})

describe('formatSpikeReport', () => {
  it('lists every test with its status and detail', () => {
    const text = formatSpikeReport({
      environment: {
        systemVersion: '26.1',
        major: 26,
        model: 'iPhone',
        proxyConfigurationsAvailable: true
      },
      ports: { proxyPort: 1, localPort: 2 },
      settings: { useProxy: true, applyCredential: false, blockWebRTC: false, viaJS: false },
      tests: SPIKE_TESTS,
      results: { localhost: { status: 'pass', detail: 'ok' } },
      statuses: { localhost: 'pass' },
      entries: [entry('CONNECT', 'example.com:443')],
      events: [{ kind: 'nav', at: 0, phase: 'finish' }]
    })
    expect(text).toContain('[PASS] 1. localhost')
    expect(text).toContain('iOS 26.1')
    expect(text).toContain('CONNECT example.com:443')
    for (const test of SPIKE_TESTS) {
      expect(text).toContain(test.title)
    }
  })
})
