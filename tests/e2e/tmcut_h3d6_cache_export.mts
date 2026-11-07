/**
 * H3d-6 (§53.12): the export paints from the copy the browser kept.
 *
 * Until now both export legs opened the media by LOCATION: `bytes: null` in
 * `createPlateReader` and in `createExportMixLeg`. §53.11 named that as the
 * remaining hole — a project whose upload the server no longer has still exports
 * "no plate" even though the preview plays it, because the preview reads the
 * client byte cache (slice G4b) and the export did not.
 *
 * This harness is the end-to-end proof, and it is deliberately arranged so the
 * location CANNOT be the source:
 *
 *  1. the fixture is generated into a temp dir, never into `.data/uploads`;
 *  2. its back-reference is `/uploads/h3d6-<pid>.mp4`, which does not exist, so
 *     `resolveSrc` hands the reader a URL that 404s;
 *  3. the bytes go into the app's real OPFS cache under a real revision key;
 *  4. the export is asked for the cache first, exactly the way the modal now does
 *     it (`bytesFor: src => readCachedBytes(fingerprintFor(src))`).
 *
 * Then two checks that only mean something together:
 *   - with the port, the file is written and paints the authored colours;
 *   - without it, the same project fails with "no plate could be decoded",
 *     which is the behaviour this slice replaces. A harness that only ran the
 *     first check would pass on a machine where the location happened to work.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/e2e/tmcut_h3d6_cache_export.mts
 */
import { chromium } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEV_URL = process.env.TMCUT_DEV_URL || 'http://localhost:4003'
const FFMPEG = path.join(ROOT, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const FFPROBE = path.join(ROOT, 'resources', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const WORK = fs.mkdtempSync(path.join(ROOT, '.golden-render-h3d6-'))
const T = 120_000
const W = 320
const H = 180
const FPS = 30
const BG = '#101820'
const STRIDE = W * H * 3
const FLAT = [
  { name: 'red', hex: '0xE02020' },
  { name: 'green', hex: '0x20C040' },
  { name: 'blue', hex: '0x2040E0' },
  { name: 'yellow', hex: '0xF0C020' }
] as const

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`H3d-6 ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
  if (ok) pass++
  else fail++
}

function run(command: string, args: string[]): { code: number, out: string } {
  const r = spawnSync(command, args, { encoding: 'buffer', maxBuffer: 1 << 28 })
  return { code: r.status ?? -1, out: String(r.stderr ?? '') + String(r.stdout ?? '') }
}

/** One-shot HTTP sink: the page POSTs the exported bytes here, Node writes them to disk. */
function receiver(file: string): Promise<{ url: string, done: Promise<number>, close: () => void }> {
  return new Promise((resolve) => {
    let settle: (n: number) => void = () => {}
    const done = new Promise<number>((res) => {
      settle = res
    })
    const server = http.createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        fs.writeFileSync(file, body)
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(String(body.length))
        server.close()
        settle(body.length)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}/`, done, close: () => server.close() })
    })
  })
}

function probe(file: string) {
  const r = run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames,r_frame_rate',
    '-of', 'json', file
  ])
  const json = JSON.parse(r.out.slice(Math.max(0, r.out.indexOf('{'))))
  const stream = json.streams?.[0] ?? {}
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    frames: Number(stream.nb_frames),
    fps: String(stream.r_frame_rate ?? '')
  }
}

/** Decode to raw RGB honouring the file's own tags — the same rule §53.11 learned. */
function rgbFrames(file: string): Buffer {
  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', 'format=rgb24',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`could not decode ${path.basename(file)}: ${r.stderr}`)
  return r.stdout
}

function pixel(frames: Buffer, frame: number, x: number, y: number): [number, number, number] {
  const i = frame * STRIDE + (y * W + x) * 3
  return [frames[i]!, frames[i + 1]!, frames[i + 2]!]
}

/**
 * One authored project. `src` is a `/uploads/` path the server does NOT have:
 * that is the whole point, so the only place the bytes can come from is the cache.
 */
function projectFor(src: string, id: string) {
  return {
    id,
    version: 1,
    name: 'h3d-6 cache export',
    canvas: { width: W, height: H, fps: FPS, background: { type: 'color', value: BG } },
    timeline: {
      tracks: [{
        id: 't1',
        type: 'video',
        name: 'base',
        items: [{ id: 'c1', trackId: 't1', src, offset: 0, in: 0, out: 2 * T, effects: [], type: 'video' }]
      }]
    }
  }
}

function findBrowserExe(): string {
  const candidates = [
    process.env.CHROME_EXE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean) as string[]
  const found = candidates.find(c => fs.existsSync(c))
  if (!found) throw new Error('No Chromium-based browser found. Set CHROME_EXE.')
  return found
}

/** Put the fixture's bytes into the app's real cache, under a real revision key. */
async function seedCache(page: import('playwright-core').Page, base64: string, key: string): Promise<number> {
  const moduleUrl = '/_nuxt/@fs/' + path.join(ROOT, 'app', 'utils', 'tmcut', 'byteStore.ts').replace(/\\/g, '/')
  const script = `(async () => {
    const mod = await import(${JSON.stringify(moduleUrl)})
    const raw = atob(${JSON.stringify(base64)})
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const ok = await mod.putCachedBytes(${JSON.stringify(key)}, new Blob([bytes], { type: 'video/mp4' }), new Set([${JSON.stringify(key)}]))
    const back = await mod.readCachedBytes(${JSON.stringify(key)})
    return { ok, size: back ? back.size : 0, backend: await mod.byteStoreBackend() }
  })()`
  return (await page.evaluate(script)) as never
}

/** Run the app's own export host in the live page, with or without the cache port. */
async function browserExport(
  page: import('playwright-core').Page,
  project: unknown,
  file: string,
  key: string | null
): Promise<{ kind: string, size?: number, message?: string }> {
  const sink = await receiver(file)
  try {
    const hostUrl = '/_nuxt/@fs/' + path.join(ROOT, 'app', 'utils', 'tmcut', 'webExportHost.ts').replace(/\\/g, '/')
    const storeUrl = '/_nuxt/@fs/' + path.join(ROOT, 'app', 'utils', 'tmcut', 'byteStore.ts').replace(/\\/g, '/')
    // A self-contained expression: tsx compiles a closure with esbuild's `__name`
    // helper, which the page has never defined.
    const bytesFor = key === null
      ? 'undefined'
      : `async () => (await import(${JSON.stringify(storeUrl)})).readCachedBytes(${JSON.stringify(key)})`
    const script = `(async () => {
      const mod = await import(${JSON.stringify(hostUrl)})
      const res = await mod.createWebExportHost().run({
        project: ${JSON.stringify(project)},
        resolveSrc: (s) => s,
        bytesFor: ${bytesFor}
      })
      if (res.kind !== 'exported' || !res.output) return { kind: res.kind, message: res.message || '', reasons: res.reasons || [] }
      const bytes = new Uint8Array(await res.output.arrayBuffer())
      const up = await fetch(${JSON.stringify(sink.url)}, { method: 'POST', body: bytes })
      return { kind: res.kind, size: bytes.length, echoed: Number(await up.text()) }
    })()`
    const result = await page.evaluate(script) as { kind: string, size?: number, message?: string }
    if (result.kind === 'exported') await sink.done
    return result
  } finally {
    sink.close()
  }
}

async function main() {
  console.log(`H3d-6 cache-backed export against ${DEV_URL}`)
  if (!fs.existsSync(FFMPEG)) {
    console.log('SKIP  H3d-6 cache export: no FFmpeg binary')
    return
  }
  const alive = await fetch(DEV_URL + '/login').then(r => r.ok, () => false)
  if (!alive) {
    console.log(`SKIP  H3d-6 cache export: no dev server at ${DEV_URL}`)
    return
  }

  const tag = ['-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv']
  const source = path.join(WORK, 'flat.mp4')
  // Generated into WORK, never into `.data/uploads`: the server must not have it.
  const made = run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    ...FLAT.flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c.hex}:s=${W}x${H}:r=${FPS}:d=0.5`]),
    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
    '-map', '[v]', '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30',
    ...tag, '-y', source.replace(/\\/g, '/')
  ])
  if (made.code !== 0) throw new Error(`could not generate the fixture: ${made.out}`)

  const base64 = fs.readFileSync(source).toString('base64')
  // A real revision key: `cacheKeyForPath` is what the library stamps, so the
  // store is asked under exactly the shape a live revision has.
  const keyScript = path.join(WORK, 'key.mts')
  fs.writeFileSync(keyScript, [
    'import { cacheKeyForPath } from \'tmcut-core\'',
    'process.stdout.write(cacheKeyForPath(\'/uploads/h3d6.mp4\', { mtimeMs: 1, size: 2 }))'
  ].join('\n'))
  const keyRun = run(process.execPath, [
    path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '--tsconfig', path.join(ROOT, 'tsconfig.test.json'),
    keyScript
  ])
  const key = keyRun.out.trim()
  if (keyRun.code !== 0 || !/^[0-9a-f]{8}$/.test(key)) {
    throw new Error(`could not derive a revision key: ${keyRun.code} ${keyRun.out}`)
  }
  const src = `/uploads/h3d6-${process.pid}.mp4`
  const project = projectFor(src, 'h3d6')
  const cleanup = () => fs.rmSync(WORK, { recursive: true, force: true })

  try {
    const browser = await chromium.launch({
      executablePath: findBrowserExe(),
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--mute-audio']
    })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      const pageErrors: string[] = []
      page.on('pageerror', e => pageErrors.push(String(e)))
      await page.goto(DEV_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 90_000 })

      check('the revision key is one the store may hold', /^[0-9a-f]{8}$/.test(key), `key ${key}`)

      // The location really is dead: if this URL answered, the export below could
      // have painted from the stream and the whole harness would prove nothing.
      const dead = await page.evaluate(`fetch(${JSON.stringify(src)}, { method: 'GET' })
        .then(r => r.status, () => -1)`)
      check('the server does not have this file, so only the cache can paint it', dead !== 200, `status ${dead}`)

      const seeded = await seedCache(page, base64, key)
      check(
        'the fixture bytes are in the browser cache under that key',
        seeded.ok === true && seeded.size > 0,
        `backend ${seeded.backend}, ${seeded.size} bytes`
      )

      const served = path.join(WORK, 'cached-attempt.mp4')
      const result = await browserExport(page, project, served, key)
      check(
        'the export is written from the cached copy, with no server file to fall back to',
        result.kind === 'exported' && fs.existsSync(served) && fs.statSync(served).size > 0,
        `${result.kind} ${result.size ?? 0} bytes${result.message ? ' — ' + result.message : ''}`
      )

      if (result.kind === 'exported') {
        const info = probe(served)
        check(
          'the file carries the project canvas, rate and frame count',
          info.width === W && info.height === H && info.fps === `${FPS}/1` && info.frames === 60,
          `${info.width}x${info.height}@${info.fps} ${info.frames}f`
        )
        const frames = rgbFrames(served)
        const sampled = FLAT.map((c, i) => {
          const frame = Math.round((i * 0.5 + 0.25) * FPS)
          return { name: c.name, rgb: pixel(frames, frame, 160, 90) }
        })
        const distinct = new Set(sampled.map(s => s.rgb.join(','))).size
        check(
          'the picture painted is the authored footage, not the background',
          distinct === FLAT.length
          && sampled.every(s => Math.max(...s.rgb) - Math.min(...s.rgb) > 80)
          && !sampled.some(s => Math.abs(s.rgb[0] - 0x10) < 8 && Math.abs(s.rgb[1] - 0x18) < 8 && Math.abs(s.rgb[2] - 0x20) < 8),
          sampled.map(s => `${s.name}=${s.rgb.join('/')}`).join(' ')
        )
      }

      // The control: the same project, the same dead location, no cache port.
      // This is the behaviour §53.12 replaces, and running it is what makes the
      // check above evidence instead of a coincidence. The failure surfaces either
      // as the glue's "no plate" or as the reader's own fetch error — both are a
      // refusal to write a file, which is the point; an `exported` here would mean
      // the first check proved nothing.
      const control = await browserExport(page, project, path.join(WORK, 'control.mp4'), null)
      check(
        'without the port the same project fails, which is the hole this slice closes',
        control.kind === 'failed' && !fs.existsSync(path.join(WORK, 'control.mp4')),
        `${control.kind} — ${String(control.message).slice(0, 110)}`
      )

      check('the live page raised no error while exporting', pageErrors.length === 0, pageErrors.join(' | '))
    } finally {
      await browser.close()
    }
  } finally {
    cleanup()
  }
}

await main()
console.log(`\nH3d-6 cache export: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
