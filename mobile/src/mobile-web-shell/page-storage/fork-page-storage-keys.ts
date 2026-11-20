/**
 * Page storage keys this fork adds. Kept apart from page-storage-keys.ts and spread at the head of
 * its lists, so an upstream release that appends keys to those lists never touches the same hunk.
 */
export const FORK_PAGE_STORAGE_KEYS = [
  /** Phone-side dictation switches: a stored 'off' turns one off. */
  'orca:dictationAutoStop',
  'orca:dictationAutoSend'
] as const
