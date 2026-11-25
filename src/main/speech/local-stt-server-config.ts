import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type LocalSttServer = { url: string; model: string }

const CONFIG_FILE = 'dictation-stt.json'

let cache: { path: string; mtimeMs: number; value: LocalSttServer | null } | null = null

function parse(raw: string): LocalSttServer | null {
  const json: unknown = JSON.parse(raw)
  if (typeof json !== 'object' || json === null || !('url' in json) || !('model' in json)) {
    return null
  }
  const { url, model } = json
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return null
  }
  if (typeof model !== 'string' || !model.trim()) {
    return null
  }
  return { url, model: model.trim() }
}

/**
 * The OpenAI-compatible transcription server named by `~/.orca/dictation-stt.json`
 * (`{"url": ..., "model": ...}`), or null when the file is absent or invalid.
 * Re-read when the file's mtime changes; the server needs no key.
 */
export async function readLocalSttServer(
  path = join(homedir(), '.orca', CONFIG_FILE)
): Promise<LocalSttServer | null> {
  try {
    const { mtimeMs } = await stat(path)
    if (cache?.path === path && cache.mtimeMs === mtimeMs) {
      return cache.value
    }
    const value = parse(await readFile(path, 'utf8'))
    cache = { path, mtimeMs, value }
    return value
  } catch {
    cache = null
    return null
  }
}
