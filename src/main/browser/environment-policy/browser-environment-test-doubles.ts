import type { Session } from 'electron'
import type { BrowserRouteSessionRegistry } from '../routing/sessions/browser-route-session-registry'

type PreparePageInput = Parameters<BrowserRouteSessionRegistry['preparePage']>[0]

/** Test doubles carry only the members the code under test reads. */
export function asSession(fake: Partial<Session> | Record<string, unknown>): Session {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the code under test touches only the members the fake defines.
  return fake as Session
}

export function emptyPreparePageInput(): PreparePageInput {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub registry ignores its input.
  return {} as PreparePageInput
}
