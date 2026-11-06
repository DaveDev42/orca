import { app } from 'electron'
import type { RemoteLeafTerminalEnvironmentClient } from '../runtime/remote-leaf-terminal-forwarding'
import {
  callRuntimeEnvironment,
  subscribeRuntimeEnvironment
} from './runtime-environment-transport-routing'

// Why a stream lasts this long to start: the host may wait up to 10s for a PTY to bind before answering.
const REMOTE_LEAF_SUBSCRIBE_TIMEOUT_MS = 15_000

/** Paired clients reach a mirrored orcad terminal through the desktop's own environment connection. */
export function createRuntimeEnvironmentRemoteLeafTerminalClient(): RemoteLeafTerminalEnvironmentClient {
  // Why userData: configured servers live where the runtime-environment handlers keep them.
  const userDataPath = app.getPath('userData')
  return {
    call: (environmentId, method, params) =>
      callRuntimeEnvironment(userDataPath, environmentId, method, params),
    subscribe: (environmentId, method, params, onEvent, signal) =>
      subscribeRuntimeEnvironment(
        userDataPath,
        environmentId,
        method,
        params,
        REMOTE_LEAF_SUBSCRIBE_TIMEOUT_MS,
        { onEvent, onClose: () => {} },
        () => !signal.aborted,
        signal
      )
  }
}
