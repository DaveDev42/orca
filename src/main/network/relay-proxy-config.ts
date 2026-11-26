const RELAY_PROXY_ENV = 'ORCA_RELAY_PROXY'

/**
 * The environment the account/relay proxy resolver reads. An inherited proxy variable wins; otherwise
 * ORCA_RELAY_PROXY (e.g. socks5h://127.0.0.1:21080) supplies ALL_PROXY for these calls only, so child
 * processes (agents, CLIs) never inherit a proxy URL they cannot speak. Off when unset.
 */
export function relayProxyEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const inherited = ['http_proxy', 'https_proxy', 'all_proxy'].some(
    (name) => env[name]?.trim() || env[name.toUpperCase()]?.trim()
  )
  const url = env[RELAY_PROXY_ENV]?.trim()
  return !inherited && url ? { ...env, ALL_PROXY: url } : env
}
