/**
 * media:// protocol module (R126, roadmap §190).
 *
 * The handler moved out of main.cjs and gained origin-scoped CORS, which
 * is what allows webSecurity:true again. The spec pins the contract
 * against the REAL module (electron/media-protocol.cjs) using the web
 * Request/Response globals available in Node:
 *  - media tags path: 200 with the right Content-Type + Accept-Ranges
 *  - seek path: 206 with exact Content-Range, suffix ranges, 416 guards
 *  - CORS: ACAO echoed ONLY for the app origins (fetch waveform/thumbs);
 *    a remote origin gets no ACAO and cannot read local files through it
 *  - OPTIONS preflight answers the Range header
 */
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { createMediaHandler, mediaSchemePrivileges } = require('../../electron/media-protocol.cjs')

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const dir = mkdtempSync(join(tmpdir(), 'tmcut-media-'))
const binPath = join(dir, 'clip.mp4')
const BIN = Buffer.from('0123456789ABCDEF', 'latin1')
writeFileSync(binPath, BIN)
const jsonPath = join(dir, 'wave.json')
writeFileSync(jsonPath, '{"buckets":[1,2,3]}')

const APP_ORIGINS = ['http://localhost:4002', 'http://127.0.0.1:4002']
const handler = createMediaHandler(() => APP_ORIGINS)

function mediaRequest(file: string, opts: { origin?: string, range?: string, method?: string } = {}) {
  const url = `media://local?file=${encodeURIComponent(file)}`
  const headers: Record<string, string> = {}
  if (opts.origin) headers.origin = opts.origin
  if (opts.range) headers.range = opts.range
  return { url, method: opts.method || 'GET', headers: new Headers(headers) } as unknown as Request
}

async function main() {
  await check('scheme privileges keep every flag the media pipeline needs', async () => {
    const p = mediaSchemePrivileges()
    if (p.scheme !== 'media') throw new Error('scheme')
    const want = ['standard', 'secure', 'supportFetchAPI', 'bypassCSP', 'stream', 'corsEnabled'] as const
    for (const flag of want) {
      if (p.privileges[flag] !== true) throw new Error(`privilege ${flag} missing`)
    }
  })

  await check('plain GET streams the file with media content-type and ranges', async () => {
    const res = await handler(mediaRequest(binPath))
    if (res.status !== 200) throw new Error(`status ${res.status}`)
    if (res.headers.get('content-type') !== 'video/mp4') throw new Error('content-type')
    if (res.headers.get('accept-ranges') !== 'bytes') throw new Error('accept-ranges')
    const body = Buffer.from(await res.arrayBuffer())
    if (!body.equals(BIN)) throw new Error('body mismatch')
  })

  await check('Range request answers 206 with the exact slice (the seek path)', async () => {
    const res = await handler(mediaRequest(binPath, { range: 'bytes=4-7' }))
    if (res.status !== 206) throw new Error(`status ${res.status}`)
    if (res.headers.get('content-range') !== 'bytes 4-7/16') throw new Error(`cr ${res.headers.get('content-range')}`)
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
    if (body !== '4567') throw new Error(`body ${body}`)
  })

  await check('suffix range and the 416 guard behave', async () => {
    const suffix = await handler(mediaRequest(binPath, { range: 'bytes=-4' }))
    if (suffix.status !== 206) throw new Error(`suffix status ${suffix.status}`)
    const body = Buffer.from(await suffix.arrayBuffer()).toString('latin1')
    if (body !== 'CDEF') throw new Error(`suffix body ${body}`)
    const bad = await handler(mediaRequest(binPath, { range: 'bytes=99-120' }))
    if (bad.status !== 416) throw new Error(`416 expected, got ${bad.status}`)
  })

  await check('app origin gets CORS (fetch waveform), remote origin does NOT', async () => {
    const app = await handler(mediaRequest(jsonPath, { origin: 'http://localhost:4002' }))
    if (app.headers.get('access-control-allow-origin') !== 'http://localhost:4002') throw new Error('app ACAO missing')
    const remote = await handler(mediaRequest(binPath, { origin: 'https://evil.example' }))
    if (remote.headers.get('access-control-allow-origin') !== null) throw new Error('remote origin must not get ACAO')
  })

  await check('OPTIONS preflight allows the Range header for app origins', async () => {
    const res = await handler(mediaRequest(binPath, { origin: 'http://127.0.0.1:4002', method: 'OPTIONS' }))
    if (res.status !== 204) throw new Error(`status ${res.status}`)
    if (res.headers.get('access-control-allow-origin') !== 'http://127.0.0.1:4002') throw new Error('preflight ACAO')
    if (!String(res.headers.get('access-control-allow-headers')).toLowerCase().includes('range')) throw new Error('Range not preflighted')
  })

  await check('missing file is a 404, not a crash', async () => {
    const res = await handler(mediaRequest(join(dir, 'nope.mp4')))
    if (res.status !== 404) throw new Error(`status ${res.status}`)
  })

  rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} checkpoints passed`)
}

main().catch((err) => {
  rmSync(dir, { recursive: true, force: true })
  console.error('FAILED:', err)
  process.exit(1)
})
