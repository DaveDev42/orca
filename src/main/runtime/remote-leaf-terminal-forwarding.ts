import { createHash } from 'node:crypto'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { isRemoteRuntimePtyId, parseRemoteRuntimePtyId } from '../../shared/remote-runtime-pty-id'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { OrcaRuntimeService } from './orca-runtime'

export type RemoteLeafTerminalUpstreamEvent =
  | { type: 'response'; response: RuntimeRpcResponse<unknown> }
  | { type: 'binary'; bytes: Uint8Array<ArrayBufferLike> }
  | { type: 'error'; code: string; message: string }
  | { type: 'close' }

export type RemoteLeafTerminalUpstream = {
  close: () => void
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean
}

/** The desktop's own connection to its configured runtime environments. */
export type RemoteLeafTerminalEnvironmentClient = {
  call: (
    environmentId: string,
    method: string,
    params: unknown
  ) => Promise<RuntimeRpcResponse<unknown>>
  subscribe: (
    environmentId: string,
    method: string,
    params: unknown,
    onEvent: (event: RemoteLeafTerminalUpstreamEvent) => void,
    signal: AbortSignal
  ) => Promise<RemoteLeafTerminalUpstream>
}

export type RemoteLeafTerminalTarget = {
  environmentId: string
  /** The handle the environment itself issued for this terminal. */
  hostHandle: string
}

type LeafRuntime = Pick<OrcaRuntimeService, 'resolveLeafForHandle' | 'resolveLiveLeafForHandle'>

// Why only these: they act on one PTY that, for a `remote:` leaf, lives on the environment.
// terminal.focus stays local (it selects the desktop tab; orcad has no window to focus), and
// terminal.unsubscribe stays local because it releases the desktop registration that owns the upstream.
export const REMOTE_LEAF_FORWARDED_UNARY_METHODS: ReadonlySet<string> = new Set([
  'terminal.send',
  'terminal.read',
  'terminal.updateViewport',
  'terminal.resizeForClient',
  'terminal.setDisplayMode',
  'terminal.clearBuffer',
  'terminal.close',
  'terminal.closeTab',
  'terminal.rename'
])

/** The environment terminal behind a `remote:` PTY id, or null for a PTY this host owns. */
export function remoteLeafTerminalTargetForPty(
  ptyId: string | null | undefined
): RemoteLeafTerminalTarget | null {
  if (!ptyId || !isRemoteRuntimePtyId(ptyId)) {
    return null
  }
  const parts = parseRemoteRuntimePtyId(ptyId)
  // Why throw: a `remote:` PTY never runs here, so a local fallback would only answer with nothing.
  if (!parts?.environmentId) {
    throw new RemoteRuntimeClientError(
      'remote_runtime_unavailable',
      'This terminal runs on a server this computer cannot name; reopen it on the desktop.'
    )
  }
  return { environmentId: parts.environmentId, hostHandle: parts.handle }
}

export function resolveRemoteLeafTerminalTarget(
  runtime: LeafRuntime,
  handle: string
): RemoteLeafTerminalTarget | null {
  if (!isRemoteRuntimePtyId(runtime.resolveLeafForHandle(handle)?.ptyId)) {
    return null
  }
  // Why the live lookup only now: it throws terminal_handle_stale (#7718), which local leaves keep answering their own way.
  return remoteLeafTerminalTargetForPty(runtime.resolveLiveLeafForHandle(handle)?.ptyId)
}

/**
 * Rewrites a paired client's call for the environment and the reply back. The desktop handle
 * becomes the host's, and the client's id (which carries its desktop credential) becomes a
 * stable alias the host can key presence and input locks on without learning the credential.
 */
export class RemoteLeafTerminalIdentity {
  private readonly clientAlias: string | null

  constructor(
    readonly target: RemoteLeafTerminalTarget,
    readonly desktopHandle: string,
    private readonly clientId: string | undefined
  ) {
    this.clientAlias = clientId
      ? `desktop-relayed:${createHash('sha256').update(clientId).digest('hex').slice(0, 24)}`
      : null
  }

  toHostParams(params: unknown): Record<string, unknown> {
    const parsed: unknown = JSON.parse(this.swap(JSON.stringify(params ?? {}), true))
    return { ...(isRecord(parsed) ? parsed : {}), terminal: this.target.hostHandle }
  }

  fromHostResult(result: unknown): unknown {
    if (result === undefined) {
      return result
    }
    const text = this.swap(JSON.stringify(result), false)
      .split(JSON.stringify(this.target.hostHandle))
      .join(JSON.stringify(this.desktopHandle))
    return JSON.parse(text)
  }

  private swap(text: string, toHost: boolean): string {
    if (!this.clientId || !this.clientAlias) {
      return text
    }
    return toHost
      ? text.split(this.clientId).join(this.clientAlias)
      : text.split(this.clientAlias).join(this.clientId)
  }
}

export function remoteLeafTerminalFailure(response: RuntimeRpcResponse<unknown>): Error | null {
  if (response.ok) {
    return null
  }
  return new RemoteRuntimeClientError(response.error.code, response.error.message, {
    data: response.error.data
  })
}

/** Runs a one-shot terminal call on the environment that owns a `remote:` leaf; unhandled otherwise. */
export async function forwardRemoteLeafTerminalUnary(
  context: {
    runtime: LeafRuntime
    clientId?: string
    remoteLeafTerminals?: RemoteLeafTerminalEnvironmentClient
  },
  method: string,
  params: unknown
): Promise<{ handled: false } | { handled: true; result: unknown }> {
  const client = context.remoteLeafTerminals
  const handle = isRecord(params) ? params.terminal : undefined
  if (!client || !REMOTE_LEAF_FORWARDED_UNARY_METHODS.has(method) || typeof handle !== 'string') {
    return { handled: false }
  }
  const target = resolveRemoteLeafTerminalTarget(context.runtime, handle)
  if (!target) {
    return { handled: false }
  }
  const identity = new RemoteLeafTerminalIdentity(target, handle, context.clientId)
  const response = await client.call(target.environmentId, method, identity.toHostParams(params))
  const failure = remoteLeafTerminalFailure(response)
  if (failure) {
    throw failure
  }
  return { handled: true, result: identity.fromHostResult(response.ok ? response.result : null) }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
