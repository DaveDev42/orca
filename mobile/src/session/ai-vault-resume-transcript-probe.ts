import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import { MOBILE_AI_VAULT_HOST_SCOPE_CAPABILITY } from '../agent-history/agent-history-capability'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import { aiVaultTranscriptProbeRun } from './mobile-session-launch-operations'

export const TRANSCRIPT_PROBE_RPC_TIMEOUT_MS = 15_000

export type MobileTranscriptProbeResult = 'present' | 'missing' | 'unverifiable'

/**
 * Asks the serving host whether a host-local WSL transcript also exists on the SSH host a resume
 * targets. Only `missing` blocks: an older host, a refusal or a dropped link stays unverifiable
 * and keeps the pre-probe behavior.
 */
export async function probeMobileAiVaultTranscriptOnSshHost(args: {
  client: RpcOperationSender
  session: Pick<AiVaultSession, 'filePath'>
  targetHostId: `ssh:${string}` | null
  hostCapabilities: readonly string[] | undefined
}): Promise<MobileTranscriptProbeResult> {
  if (
    !args.targetHostId ||
    !args.hostCapabilities?.includes(MOBILE_AI_VAULT_HOST_SCOPE_CAPABILITY)
  ) {
    return 'unverifiable'
  }
  try {
    const response = await aiVaultTranscriptProbeRun.request(
      args.client,
      { executionHostId: args.targetHostId, filePath: args.session.filePath },
      { timeoutMs: TRANSCRIPT_PROBE_RPC_TIMEOUT_MS }
    )
    if (!response.ok) {
      return 'unverifiable'
    }
    return aiVaultTranscriptProbeRun.interpret(response)?.status ?? 'unverifiable'
  } catch {
    return 'unverifiable'
  }
}
