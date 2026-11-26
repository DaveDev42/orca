import { initializeBrowserProcessUserAgent } from '../identity/browser-process-user-agent'

/** Test helper: the process identity can be set once and only before the app is ready. */
export function initializeBrowserProcessUserAgentForTest(): void {
  try {
    initializeBrowserProcessUserAgent('native')
  } catch {
    // Already initialized by an earlier test in this worker.
  }
}
