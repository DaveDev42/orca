const RELAY_PROXY_ENV = 'ORCA_RELAY_PROXY'

let capturedRelayProxy: string | undefined

/**
 * Reads ORCA_RELAY_PROXY once at startup and removes it from the process environment, so a
 * terminal, agent or CLI that Orca spawns never inherits the SOCKS URL it cannot speak (the same
 * promise the unset-by-default switch makes for the standard proxy variables). Later calls to
 * relayProxyEnv() read the captured value. Call it before anything spawns; calling it again is a
 * no-op.
 */
export function captureRelayProxyAtStartup(env: NodeJS.ProcessEnv = process.env): void {
  const url = env[RELAY_PROXY_ENV]?.trim()
  if (url && capturedRelayProxy === undefined) {
    capturedRelayProxy = url
  }
  delete env[RELAY_PROXY_ENV]
}

/** Test seam: forget what captureRelayProxyAtStartup() read. */
export function resetCapturedRelayProxyForTests(): void {
  capturedRelayProxy = undefined
}

/**
 * The environment the account/relay proxy resolver reads. An inherited proxy variable wins; otherwise
 * ORCA_RELAY_PROXY (e.g. socks5h://127.0.0.1:21080) supplies ALL_PROXY for these calls only, so child
 * processes (agents, CLIs) never inherit a proxy URL they cannot speak. Off when unset.
 */
export function relayProxyEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const inherited = ['http_proxy', 'https_proxy', 'all_proxy'].some(
    (name) => env[name]?.trim() || env[name.toUpperCase()]?.trim()
  )
  const url = env[RELAY_PROXY_ENV]?.trim() || (env === process.env ? capturedRelayProxy : undefined)
  return !inherited && url ? { ...env, ALL_PROXY: url } : env
}
