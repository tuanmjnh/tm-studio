/**
 * The server/ storage boundary (owner decision Q4, 2026-11-04).
 *
 * The Nitro server is a byte store and nothing else: it persists what the
 * browser hands it and streams it back. Everything that shells out to a media
 * binary sits on one frozen list and is marked ZERO-FFMPEG-LEGACY, because
 * slice I of the zero-FFmpeg audit (docs/audit/zero-ffmpeg-audit.md) deletes the binary those files
 * spawn. The list is allowed to shrink as slices C..H land browser
 * replacements; it is not allowed to grow, and a file cannot spawn without
 * saying which slice kills it.
 *
 * Two specs already cover other angles of the same surface: tmcut_web_upload
 * pins the upload helpers and their wiring, tmcut_platform_adapter pins who
 * calls the render route. This one pins the boundary itself, so a future
 * commit cannot quietly add server-side media processing back.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** Files that import a process spawner. The whole server-side media engine. */
const SPAWN_SITES = [
  'server/api/v1/media/analyze.post.ts',
  'server/api/v1/media/proxy.post.ts',
  'server/api/v1/media/render.post.ts',
  'server/utils/htmlVideoRender.ts'
]

/** Spawn sites plus the job registry and poller that only serve them. */
const LEGACY_MARKED = [
  ...SPAWN_SITES,
  'server/api/v1/media/render/[jobId].get.ts',
  'server/utils/renderJobs.ts'
]

/** The sanctioned storage surface: accept bytes, serve bytes. */
const STORAGE_FILES = [
  'server/api/v1/media/upload.post.ts',
  'server/routes/uploads/[...path].get.ts',
  'server/utils/uploads.ts'
]

function serverSources(dir = 'server'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...serverSources(rel))
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) && statSync(join(ROOT, rel)).isFile()) out.push(rel)
  }
  return out
}

describe('server media boundary', () => {
  it('spawns a process in exactly the frozen legacy sites', () => {
    const found = serverSources()
      .filter(rel => /from ['"]node:child_process['"]/.test(read(rel)))
      .sort()
    assert.deepEqual(found, [...SPAWN_SITES].sort(), `spawner set changed: ${JSON.stringify(found)}`)
  })

  it('names the slice that deletes each legacy site', () => {
    for (const rel of LEGACY_MARKED) {
      const head = read(rel).split('\n').slice(0, 20).join('\n')
      assert.match(head, /ZERO-FFMPEG-LEGACY/, `${rel} must declare itself legacy in its header`)
      assert.match(head, /slice I/, `${rel} must name the slice that removes it`)
    }
  })

  it('keeps the storage files free of any media-processing entrypoint', () => {
    for (const rel of STORAGE_FILES) {
      const src = read(rel)
      assert.doesNotMatch(src, /node:child_process/, `${rel} may not spawn`)
      assert.doesNotMatch(src, /\bspawn\s*\(/, `${rel} may not spawn`)
      assert.doesNotMatch(src, /tools\.(ffmpeg|ffprobe)Path/, `${rel} may not read a binary path`)
    }
  })

  it('still streams uploads to disk and answers with a durable URL', () => {
    const src = read('server/api/v1/media/upload.post.ts')
    assert.match(src, /createWriteStream/, 'bytes go straight to a file handle')
    assert.match(src, /req\.pipe\(stream\)/, 'the request body is piped, not buffered')
    assert.match(src, /config\.uploads\.maxMb/, 'the size guard reads the configured limit')
    assert.match(src, /url: `\/uploads\/\$\{storedName\}`/, 'the response is the serve-route URL')
  })

  it('serves stored bytes with range support', () => {
    const src = read('server/routes/uploads/[...path].get.ts')
    assert.match(src, /createReadStream\(target, \{ start, end \}\)/, 'ranges stream from a window')
    assert.match(src, /parseUploadRange/, 'the Range header is parsed')
    assert.match(src, /setResponseStatus\(event, 206\)/, 'partial content is answered as 206')
  })
})
