import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLocalSttServer } from './local-stt-server-config'

describe('readLocalSttServer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-stt-'))

  it('returns the server only for an http(s) url and a non-empty model', async () => {
    const ok = join(dir, 'ok.json')
    writeFileSync(
      ok,
      JSON.stringify({ url: 'http://127.0.0.1:8100/v1/audio/transcriptions', model: ' whisper ' })
    )
    expect(await readLocalSttServer(ok)).toEqual({
      url: 'http://127.0.0.1:8100/v1/audio/transcriptions',
      model: 'whisper'
    })
    const badUrl = join(dir, 'bad-url.json')
    writeFileSync(badUrl, JSON.stringify({ url: 'file:///x', model: 'm' }))
    expect(await readLocalSttServer(badUrl)).toBeNull()
    const noModel = join(dir, 'no-model.json')
    writeFileSync(noModel, JSON.stringify({ url: 'http://x/y', model: ' ' }))
    expect(await readLocalSttServer(noModel)).toBeNull()
  })

  it('is null for a missing or malformed file', async () => {
    expect(await readLocalSttServer(join(dir, 'missing.json'))).toBeNull()
    const junk = join(dir, 'junk.json')
    writeFileSync(junk, '{nope')
    expect(await readLocalSttServer(junk)).toBeNull()
  })
})
