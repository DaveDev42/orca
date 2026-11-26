import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core'
import { createElement, forwardRef, type ComponentType, type RefAttributes } from 'react'
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native'

// Throwaway spike (PR 0 of the "This device" mobile browser design): not wired to anything outside the hidden screen.

export type SpikeProxyEntry = {
  i: number
  t: number
  kind: string
  target: string
  auth: string
  extra: string
}

export type SpikeEnvironment = {
  systemVersion: string
  major: number
  model: string
  proxyConfigurationsAvailable: boolean
}

export type SpikeTunnelChunk = { conn: number; dir: number; seq: number; b64: string }

export type SpikeNativeModule = {
  environment: () => SpikeEnvironment
  start: () => Promise<{ proxyPort: number; localPort: number }>
  setPages: (pages: Record<string, string>) => void
  setEgressMode: (mode: 'native' | 'js') => void
  proxyEntryCount: () => number
  proxyEntries: (since: number) => SpikeProxyEntry[]
  jsChunkCount: () => number
  tunnelReply: (conn: number, dir: number, seq: number, data: Uint8Array) => void
  log: (line: string) => void
  clearWebsiteData: () => Promise<void>
  addListener: (
    event: 'onTunnelChunk',
    listener: (chunk: SpikeTunnelChunk) => void
  ) => { remove: () => void }
}

export function getSpikeNativeModule(): SpikeNativeModule | null {
  if (Platform.OS !== 'ios') {
    return null
  }
  return requireOptionalNativeModule<SpikeNativeModule>('OrcaThisDeviceSpike')
}

export type SpikeWebViewProps = ViewProps & {
  useProxy: boolean
  applyCredential: boolean
  blockWebRTC: boolean
  acceptBadCerts: boolean
  onSpikeEvent: (event: NativeSyntheticEvent<Record<string, unknown>>) => void
}

export type SpikeWebViewHandle = {
  loadUrl: (url: string) => Promise<void>
  loadHtml: (html: string, baseUrl: string) => Promise<void>
}

let cachedView: ComponentType<SpikeWebViewProps & RefAttributes<SpikeWebViewHandle>> | null = null

// Resolved on first render so an Android bundle never asks for a view manager that is not there.
export const SpikeWebView = forwardRef<SpikeWebViewHandle, SpikeWebViewProps>((props, ref) => {
  cachedView ??= requireNativeViewManager<SpikeWebViewProps & RefAttributes<SpikeWebViewHandle>>(
    'OrcaThisDeviceSpike'
  )
  return createElement(cachedView, { ...props, ref })
})
SpikeWebView.displayName = 'SpikeWebView'
