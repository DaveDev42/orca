import { describe, expect, it, vi } from 'vitest'
import { probeMobileAiVaultTranscriptOnSshHost } from './ai-vault-resume-transcript-probe'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'

const WSL_PATH = '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects\\p\\s.jsonl'
const CAPS = ['aiVault.v1', 'aiVault.host-scope.v1']

function sender(response: unknown): { client: RpcOperationSender; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => response)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe only calls sendRequest.
  return { client: { sendRequest: send } as unknown as RpcOperationSender, send }
}

describe('probeMobileAiVaultTranscriptOnSshHost', () => {
  it('reports present and missing from the host answer', async () => {
    for (const status of ['present', 'missing'] as const) {
      const { client, send } = sender({ id: '1', ok: true, result: { status } })
      await expect(
        probeMobileAiVaultTranscriptOnSshHost({
          client,
          session: { filePath: WSL_PATH },
          targetHostId: 'ssh:builder',
          hostCapabilities: CAPS
        })
      ).resolves.toBe(status)
      expect(send).toHaveBeenCalledWith(
        'aiVault.probeSessionTranscript',
        { executionHostId: 'ssh:builder', filePath: WSL_PATH },
        expect.anything()
      )
    }
  })

  it('never calls a host that does not advertise the capability', async () => {
    const { client, send } = sender({ id: '1', ok: true, result: { status: 'missing' } })
    await expect(
      probeMobileAiVaultTranscriptOnSshHost({
        client,
        session: { filePath: WSL_PATH },
        targetHostId: 'ssh:builder',
        hostCapabilities: ['aiVault.v1']
      })
    ).resolves.toBe('unverifiable')
    expect(send).not.toHaveBeenCalled()
  })

  it('treats a refusal, a thrown error and a malformed reply as unverifiable', async () => {
    const refused = sender({
      id: '1',
      ok: false,
      error: { code: 'method_not_found', message: 'nope' }
    })
    const malformed = sender({ id: '1', ok: true, result: { status: 'weird' } })
    const thrown = { client: { sendRequest: vi.fn().mockRejectedValue(new Error('x')) } }
    for (const client of [
      refused.client,
      malformed.client,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe only calls sendRequest.
      thrown.client as unknown as RpcOperationSender
    ]) {
      await expect(
        probeMobileAiVaultTranscriptOnSshHost({
          client,
          session: { filePath: WSL_PATH },
          targetHostId: 'ssh:builder',
          hostCapabilities: CAPS
        })
      ).resolves.toBe('unverifiable')
    }
  })
})
