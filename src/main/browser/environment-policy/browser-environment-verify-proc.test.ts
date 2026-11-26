import { describe, expect, it } from 'vitest'
import { asSession } from './browser-environment-test-doubles'
import {
  installBrowserEnvironmentTrustAnchors,
  removeBrowserEnvironmentTrustAnchors
} from './browser-environment-verify-proc'
import {
  ANCHOR_PEM,
  INTER_PEM,
  LEAF_PEM,
  LEAFINTER_PEM,
  LEAFOTHER_PEM
} from './browser-environment-test-certificates'

type Proc = (request: Record<string, unknown>, callback: (result: number) => void) => void

function fakeSession() {
  const state: { proc: Proc | null | undefined } = { proc: undefined }
  const sess = asSession({
    setCertificateVerifyProc: (proc: Proc | null) => {
      state.proc = proc
    }
  })
  return { sess, state }
}

function verify(proc: Proc, request: Record<string, unknown>): number {
  let result = Number.NaN
  proc(request, (value) => {
    result = value
  })
  return result
}

const served = (...pems: string[]) => {
  const build = (index: number): unknown =>
    index < pems.length ? { data: pems[index], issuerCert: build(index + 1) } : undefined
  return build(0)
}
const request = (certificate: unknown, over: Record<string, unknown> = {}) => ({
  hostname: 'example.test',
  verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
  certificate,
  ...over
})

describe('browser environment verify proc', () => {
  it('accepts anchored chains and leaves every other verdict to Chromium', () => {
    const { sess, state } = fakeSession()
    expect(installBrowserEnvironmentTrustAnchors(sess, [ANCHOR_PEM])).toBe(true)
    const proc = state.proc
    if (!proc) {
      throw new Error('no verify proc installed')
    }
    expect(verify(proc, request(served(LEAF_PEM)))).toBe(0)
    expect(verify(proc, request(served(LEAFINTER_PEM, INTER_PEM)))).toBe(0)
    expect(verify(proc, request(served(LEAFOTHER_PEM)))).toBe(-3)
    expect(verify(proc, request(served(LEAF_PEM), { hostname: 'evil.test' }))).toBe(-3)
    expect(verify(proc, request(served(LEAF_PEM), { verificationResult: 'OK' }))).toBe(-3)
    expect(verify(proc, request(undefined))).toBe(-3)
  })

  it('installs nothing for unusable anchors', () => {
    const { sess, state } = fakeSession()
    expect(installBrowserEnvironmentTrustAnchors(sess, ['junk', LEAF_PEM])).toBe(false)
    expect(state.proc).toBeUndefined()
  })

  it('touches only the session it was installed on', () => {
    const target = fakeSession()
    const other = fakeSession()
    installBrowserEnvironmentTrustAnchors(target.sess, [ANCHOR_PEM])
    removeBrowserEnvironmentTrustAnchors(other.sess)
    expect(other.state.proc).toBeUndefined()
    removeBrowserEnvironmentTrustAnchors(target.sess)
    expect(target.state.proc).toBeNull()
  })
})
