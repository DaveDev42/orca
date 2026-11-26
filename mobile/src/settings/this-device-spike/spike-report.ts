import type { SpikeEvent } from './spike-event-log'
import type { SpikeEnvironment, SpikeProxyEntry } from './spike-native'
import type { SpikeResult, SpikeStatus, SpikeTestDefinition } from './spike-tests'

export type SpikeReportInput = {
  environment: SpikeEnvironment | null
  ports: { proxyPort: number; localPort: number } | null
  settings: { useProxy: boolean; applyCredential: boolean; blockWebRTC: boolean; viaJS: boolean }
  tests: readonly SpikeTestDefinition[]
  results: Record<string, SpikeResult | undefined>
  statuses: Record<string, SpikeStatus | undefined>
  entries: readonly SpikeProxyEntry[]
  events: readonly SpikeEvent[]
}

export function formatProxyEntry(entry: SpikeProxyEntry): string {
  return `#${entry.i} +${entry.t}ms ${entry.kind} ${entry.target} auth=${entry.auth} ${entry.extra}`.trim()
}

export function formatEvent(event: SpikeEvent): string {
  const { at: _at, kind, ...rest } = event
  return `${kind} ${JSON.stringify(rest)}`
}

export function formatSpikeReport(input: SpikeReportInput): string {
  const lines: string[] = []
  const env = input.environment
  lines.push(`orca-spike report ${new Date().toISOString()}`)
  lines.push(
    `iOS ${env?.systemVersion ?? '?'} (${env?.model ?? '?'}) proxyConfigurations=${String(env?.proxyConfigurationsAvailable)}`
  )
  lines.push(
    `proxy 127.0.0.1:${input.ports?.proxyPort ?? '?'} local server 127.0.0.1:${input.ports?.localPort ?? '?'} settings=${JSON.stringify(input.settings)}`
  )
  lines.push('')
  for (const test of input.tests) {
    const status = input.statuses[test.id] ?? 'idle'
    const result = input.results[test.id]
    lines.push(`[${status.toUpperCase()}] ${test.title}${result ? `\n    ${result.detail}` : ''}`)
  }
  lines.push('')
  lines.push(`proxy log (${input.entries.length} entries, last 120)`)
  for (const entry of input.entries.slice(-120)) {
    lines.push(formatProxyEntry(entry))
  }
  lines.push('')
  const interesting = input.events.filter((event) => event.kind !== 'page')
  lines.push(`events (${interesting.length}, last 80)`)
  for (const event of interesting.slice(-80)) {
    lines.push(formatEvent(event))
  }
  return lines.join('\n')
}
