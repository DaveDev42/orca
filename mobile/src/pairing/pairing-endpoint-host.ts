// The only name a pairing link carries is where the desktop answers; the host part alone, never the rest of the link.
export function pairingEndpointHost(endpoint: string): string | null {
  try {
    const host = new URL(endpoint).hostname
    return host === '' ? null : host
  } catch {
    return null
  }
}
