import { z } from 'zod'

const MAX_ANCHORS_PER_ENVIRONMENT = 8
const MAX_ANCHOR_PEM_LENGTH = 16_384

const BrandVersion = z.strictObject({
  brand: z.string().min(1).max(64),
  version: z.string().max(32)
})

/** What a client-hosted tab of one environment presents instead of the viewing desktop's identity. */
export const BrowserEnvironmentIdentity = z.strictObject({
  userAgent: z.string().min(1).max(1024),
  /** `navigator.platform`, e.g. `MacIntel`. */
  platform: z.string().min(1).max(64),
  /** Client hints: `navigator.userAgentData` and every `Sec-CH-UA-*` request header. */
  userAgentMetadata: z.strictObject({
    brands: z.array(BrandVersion).min(1).max(8),
    fullVersionList: z.array(BrandVersion).min(1).max(8),
    fullVersion: z.string().min(1).max(64),
    platform: z.string().min(1).max(32),
    platformVersion: z.string().max(32),
    architecture: z.string().max(16),
    bitness: z.string().max(8).optional(),
    model: z.string().max(64),
    mobile: z.boolean()
  })
})
export type BrowserEnvironmentIdentity = z.infer<typeof BrowserEnvironmentIdentity>

export type BrowserEnvironmentPolicyGlobalSettings = {
  /**
   * Extra PEM trust anchors for one paired environment's client-hosted browser partition, keyed by
   * environment id or display name (exact, case-sensitive). Used only when Chromium's own
   * verification fails and the chain builds to one of them for the requested hostname. Unset
   * changes nothing.
   */
  browserEnvironmentTrustAnchors?: Record<string, string[]>
  /**
   * Identity pin for one paired environment's client-hosted browser tabs, keyed like
   * `browserEnvironmentTrustAnchors`: the user agent, `navigator.platform` and client hints the
   * environment's own browser presents. Unset changes nothing.
   */
  browserEnvironmentIdentity?: Record<string, BrowserEnvironmentIdentity>
}

export type BrowserEnvironmentPolicy = {
  trustAnchorsPem: readonly string[]
  identity: BrowserEnvironmentIdentity | null
}

function entryFor<T>(
  map: Record<string, T> | undefined,
  environmentId: string,
  environmentName: string | null | undefined
): T | undefined {
  if (!map || typeof map !== 'object') {
    return undefined
  }
  // Own keys only: an environment named `constructor` must not read Object.prototype.
  const own = (key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined)
  return own(environmentId) ?? (environmentName ? own(environmentName) : undefined)
}

/** Id wins over name. Malformed entries resolve to no policy, never a partial one. */
export function resolveBrowserEnvironmentPolicy(
  settings: BrowserEnvironmentPolicyGlobalSettings | undefined,
  environment: { environmentId: string; environmentName?: string | null }
): BrowserEnvironmentPolicy {
  const anchorsRaw = entryFor(
    settings?.browserEnvironmentTrustAnchors,
    environment.environmentId,
    environment.environmentName
  )
  const trustAnchorsPem = Array.isArray(anchorsRaw)
    ? anchorsRaw
        .filter(
          (pem): pem is string =>
            typeof pem === 'string' && pem.length > 0 && pem.length <= MAX_ANCHOR_PEM_LENGTH
        )
        .slice(0, MAX_ANCHORS_PER_ENVIRONMENT)
    : []
  const identityRaw = entryFor(
    settings?.browserEnvironmentIdentity,
    environment.environmentId,
    environment.environmentName
  )
  const parsed =
    identityRaw === undefined ? null : BrowserEnvironmentIdentity.safeParse(identityRaw)
  return { trustAnchorsPem, identity: parsed?.success ? parsed.data : null }
}
