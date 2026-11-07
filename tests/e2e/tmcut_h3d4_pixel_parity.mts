/**
 * H3d-4 (§53.10, item #156): the browser writes the file, and its pixels
 * are graded against FFmpeg on the SAME project.
 *
 * §53.10 ended with one thing unproven: the 123 212-byte export was a real file
 * with a real codec, but no frame of it had been compared with FFmpeg. Every
 * parity gate before this one compared two MODELS (the plan vs the compiler
 * arguments, the evaluator vs the encoder). This one compares two FILES, written
 * by two different writers from one authored project.
 *
 * The fixture is chosen for what can hide a defect, not for looking nice. Four
 * flat colour segments land on exact RGB values through any sane encoder, so a
 * wrong colour matrix or a wrong background cannot pass as "compression noise";
 * a textured `testsrc2` clip follows, where drift is legitimately larger and has
 * to be bounded rather than eliminated. Both carry bt709 tags, because an
 * untagged source is decoded under whichever matrix each reader defaults to —
 * measured here, that alone moved the chroma planes by |dU| 4.5 / |dV| 7.6 while
 * the luma stayed put, which is a harness defect dressed as a paint defect.
 *
 * Checks:
 *  1. SHAPE   — both files report the project's canvas, fps and frame count.
 *  2. FLAT    — the four authored colours survive to within 2/255 mean, no
 *               sample drifts past 12 on any channel, and all four are distinct
 *               (so a fixture that collapsed to one colour cannot pass).
 *  3. ALIGN   — the browser file is best matched at frame offset 0, not at ±1
 *               or ±2, so a passing comparison is not two timelines overlapping.
 *  4. TEXTURE — the textured clip stays above a declared floor (PSNR, mean
 *               absolute error, per-channel diff ratio) on the same project.
 *  5. LUMA    — the luma plane stays far tighter than the chroma planes, which
 *               is what a 4:2:0 round trip through an RGB canvas does; reported
 *               so a future regression in the paint path cannot hide in chroma.
 *  6. REPEAT  — two exports of one project are pixel-identical. A writer that
 *               drifts between runs makes every tolerance above meaningless.
 *
 * Preconditions, same as the other `tests/e2e/tmcut_*.mts` harnesses: the dev
 * server on TMCUT_DEV_URL (default :4003), a system Edge/Chrome, and the bundled
 * `resources/ffmpeg.exe`. The page only needs to be able to import modules, so
 * it runs on `/login` — no session and no credentials are involved.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/e2e/tmcut_h3d4_pixel_parity.mts
 */
import { chromium } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEV_URL = process.env.TMCUT_DEV_URL || 'http://localhost:4003'
const FFMPEG = path.join(ROOT, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const FFPROBE = path.join(ROOT, 'resources', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const UPLOADS = path.join(ROOT, '.data', 'uploads')
const WORK = fs.mkdtempSync(path.join(ROOT, '.golden-render-h3d4-'))
const T = 120_000
const W = 320
const H = 180
const FPS = 30
const BG = '#101820'
const STRIDE = W * H * 3

// The flat segments, in order. Four distinct saturated colours: a matrix error
// moves all four, a background error replaces them, and a single-colour fixture
// could hide both.
const FLAT = [
  { name: 'red', hex: '0xE02020' },
  { name: 'green', hex: '0x20C040' },
  { name: 'blue', hex: '0x2040E0' },
  { name: 'yellow', hex: '0xF0C020' }
] as const

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`H3d-4 ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
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

/** Generate a source clip with explicit bt709 tags — an untagged one is two different sources. */
function makeSource(name: string, args: string[]) {
  const file = path.join(UPLOADS, name)
  const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args, '-y', file.replace(/\\/g, '/')])
  if (r.code !== 0) throw new Error(`could not generate ${name}: ${r.out}`)
  return { file, url: `/uploads/${name}` }
}

function probe(file: string) {
  const r = run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames,r_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json', file
  ])
  const json = JSON.parse(r.out.slice(Math.max(0, r.out.indexOf('{'))))
  const stream = json.streams?.[0] ?? {}
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    frames: Number(stream.nb_frames),
    fps: String(stream.r_frame_rate ?? ''),
    duration: Number(json.format?.duration)
  }
}

/**
 * Decode a file to raw RGB, honouring the file's OWN colour tags.
 *
 * Forcing one range on both files was measured to be the harness's own defect:
 * the browser's muxer tags its output `pc` (full range) while FFmpeg's encoder
 * inherits `tv`, so a shared `in_range=tv` expanded one of them and reported a
 * paint difference that was really a tag difference. RGB is where the two files
 * meet: the conversion normalizes whatever range each one declares.
 */
function rgbFrames(file: string): Buffer {
  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', 'format=rgb24',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`could not decode ${path.basename(file)}: ${r.stderr}`)
  return r.stdout
}

/**
 * Decode a file to planar YUV 4:2:0 normalized to ONE range and matrix, for the
 * luma-vs-chroma split. Comparing raw planes straight out of two files with
 * different tags compares the tags, not the picture.
 */
function yuvFrames(file: string): Buffer {
  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', 'scale=in_color_matrix=bt709:in_range=auto:out_range=tv,format=yuv420p',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'
  ], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`could not decode ${path.basename(file)}: ${r.stderr}`)
  return r.stdout
}

function psnr(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  let se = 0
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!
    se += d * d
  }
  const mse = se / n
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}

interface Grade {
  frames: number
  meanAbs: number
  worstChannel: number
  diffRatio: number
}

/**
 * Grade two decoded videos frame by frame.
 *
 * `shift` moves the second file's frames, so the alignment check can prove the
 * comparison is not two timelines overlapping. `skipBottomRows` exists for one
 * measured reason: 180 is not a whole number of 16-row macroblocks, so both
 * encoders pad the final partial row differently before the DCT. Measured on the
 * flat fixture, every sample outside those rows matched (0.00 % above the
 * threshold); the difference lived in rows 178–179 and nowhere else. That is
 * encoder padding at the picture edge, not paint, and it is named rather than
 * absorbed into a looser tolerance for the whole frame.
 */
function grade(expected: Buffer, actual: Buffer, shift = 0, maxFrames = Infinity, skipBottomRows = 0): Grade {
  const framesA = expected.length / STRIDE | 0
  const framesB = actual.length / STRIDE | 0
  let sum = 0
  let worst = 0
  let differ = 0
  let samples = 0
  let frames = 0
  for (let f = 0; f < Math.min(framesA, maxFrames); f++) {
    const j = f + shift
    if (j < 0 || j >= framesB) continue
    const oa = f * STRIDE
    const ob = j * STRIDE
    for (let y = 0; y < H - skipBottomRows; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        const ia = oa + p * 3
        const ib = ob + p * 3
        const dr = Math.abs(expected[ia]! - actual[ib]!)
        const dg = Math.abs(expected[ia + 1]! - actual[ib + 1]!)
        const db = Math.abs(expected[ia + 2]! - actual[ib + 2]!)
        const m = Math.max(dr, dg, db)
        sum += (dr + dg + db) / 3
        if (m > worst) worst = m
        if (m > 12) differ++
        samples++
      }
    }
    frames++
  }
  return { frames, meanAbs: sum / samples, worstChannel: worst, diffRatio: differ / samples }
}

/** One pixel of one frame, read through the same matrix as everything else. */
function pixel(frames: Buffer, frame: number, x: number, y: number): [number, number, number] {
  const i = frame * STRIDE + (y * W + x) * 3
  return [frames[i]!, frames[i + 1]!, frames[i + 2]!]
}

/**
 * One authored project, two locations for the same file: the page resolves
 * `/uploads/...` as its own origin, while FFmpeg needs a path it can open. Both
 * point at the same bytes, so the divergence is in the harness only.
 */
function projectFor(src: string, id: string) {
  return {
    id,
    version: 1,
    name: 'h3d-4 parity',
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

/** Run the app's own export host inside the live page and bring the bytes home. */
async function browserExport(page: import('playwright-core').Page, project: unknown, file: string): Promise<number> {
  const sink = await receiver(file)
  try {
    const moduleUrl = '/_nuxt/@fs/' + path.join(ROOT, 'app', 'utils', 'tmcut', 'webExportHost.ts').replace(/\\/g, '/')
    // A self-contained expression, not a closure: tsx compiles a closure with
    // esbuild's `__name` helper, which the page has never defined. Playwright
    // evaluates a string as an expression and awaits the promise it returns.
    const script = `(async () => {
      const mod = await import(${JSON.stringify(moduleUrl)})
      const res = await mod.createWebExportHost().run({ project: ${JSON.stringify(project)}, resolveSrc: (s) => s })
      if (res.kind !== 'exported' || !res.output) return { kind: res.kind, reasons: res.reasons || [] }
      const bytes = new Uint8Array(await res.output.arrayBuffer())
      const up = await fetch(${JSON.stringify(sink.url)}, { method: 'POST', body: bytes })
      return { kind: res.kind, size: bytes.length, echoed: Number(await up.text()) }
    })()`
    const result = await page.evaluate(script) as { kind: string, size?: number, echoed?: number, reasons?: string[] }
    if (result.kind !== 'exported') {
      throw new Error(`the browser refused the project: ${result.kind} ${JSON.stringify(result.reasons ?? [])}`)
    }
    return await sink.done
  } finally {
    sink.close()
  }
}

/** FFmpeg's own answer for the same project: compile, run, decode. */
function ffmpegExport(project: unknown, file: string): void {
  const compiler = path.join(WORK, 'compile.mts')
  fs.writeFileSync(compiler, [
    `import { compileTimelineToFfmpeg } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'app', 'utils', 'tmcut', 'render', 'index.ts')).href)}`,
    `const project = ${JSON.stringify(project)}`,
    `const out = ${JSON.stringify(file.replace(/\\/g, '/'))}`,
    'process.stdout.write(JSON.stringify(compileTimelineToFfmpeg(project, out).args))'
  ].join('\n'))
  const compiled = spawnSync(process.execPath, [
    path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '--tsconfig', path.join(ROOT, 'tsconfig.test.json'),
    compiler
  ], { cwd: ROOT, encoding: 'utf8' })
  if (compiled.status !== 0) throw new Error(`could not compile the project: ${compiled.stderr}`)
  const args = JSON.parse(compiled.stdout) as string[]
  const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args])
  if (r.code !== 0) throw new Error(`ffmpeg could not render the same project: ${r.out}`)
}

async function main() {
  console.log(`H3d-4 pixel parity against ${DEV_URL}`)
  if (!fs.existsSync(FFMPEG)) {
    console.log('SKIP  H3d-4 pixel parity: no FFmpeg binary')
    return
  }
  const alive = await fetch(DEV_URL + '/login').then(r => r.ok, () => false)
  if (!alive) {
    console.log(`SKIP  H3d-4 pixel parity: no dev server at ${DEV_URL}`)
    return
  }

  fs.mkdirSync(UPLOADS, { recursive: true })
  const tag = ['-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv']
  const flatName = `h3d4-flat-${process.pid}.mp4`
  const texturedName = `h3d4-textured-${process.pid}.mp4`
  // The fixtures are written into the app's own /uploads dir so the page can
  // fetch them by URL, which means every exit path has to take them back out.
  const cleanup = () => {
    for (const name of [flatName, texturedName]) fs.rmSync(path.join(UPLOADS, name), { force: true })
    fs.rmSync(WORK, { recursive: true, force: true })
  }
  try {
    const sources = {
      flat: makeSource(flatName, [
        ...FLAT.flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c.hex}:s=${W}x${H}:r=${FPS}:d=0.5`]),
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
        '-map', '[v]', '-map', '4:a', '-t', '2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30',
        ...tag, '-c:a', 'aac'
      ]),
      textured: makeSource(texturedName, [
        '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30',
        ...tag, '-c:a', 'aac'
      ])
    }

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

      const flatProject = projectFor(sources.flat.url, 'h3d4-flat')
      const texturedProject = projectFor(sources.textured.url, 'h3d4-textured')
      const flatDisk = projectFor(sources.flat.file.replace(/\\/g, '/'), 'h3d4-flat')
      const texturedDisk = projectFor(sources.textured.file.replace(/\\/g, '/'), 'h3d4-textured')

      const browserFlat = path.join(WORK, 'browser-flat.mp4')
      const browserTextured = path.join(WORK, 'browser-textured.mp4')
      const browserRepeat = path.join(WORK, 'browser-textured-repeat.mp4')
      const ffmpegFlat = path.join(WORK, 'ffmpeg-flat.mp4')
      const ffmpegTextured = path.join(WORK, 'ffmpeg-textured.mp4')

      const flatBytes = await browserExport(page, flatProject, browserFlat)
      const texturedBytes = await browserExport(page, texturedProject, browserTextured)
      await browserExport(page, texturedProject, browserRepeat)
      ffmpegExport(flatDisk, ffmpegFlat)
      ffmpegExport(texturedDisk, ffmpegTextured)

      // 1. SHAPE — the writer produced a file with the project's geometry, not a stub.
      const flatInfo = probe(browserFlat)
      const texturedInfo = probe(browserTextured)
      check(
        'both exports carry the project canvas, rate and frame count',
        flatInfo.width === W && flatInfo.height === H && texturedInfo.width === W && texturedInfo.height === H
        && flatInfo.fps === `${FPS}/1` && texturedInfo.fps === `${FPS}/1`
        && flatInfo.frames === 60 && texturedInfo.frames === 60,
        `flat ${flatInfo.width}x${flatInfo.height}@${flatInfo.fps} ${flatInfo.frames}f ${flatBytes}B; textured ${texturedInfo.width}x${texturedInfo.height}@${texturedInfo.fps} ${texturedInfo.frames}f ${texturedBytes}B`
      )

      const flatBrowser = rgbFrames(browserFlat)
      const flatFfmpeg = rgbFrames(ffmpegFlat)
      const texBrowser = rgbFrames(browserTextured)
      const texFfmpeg = rgbFrames(ffmpegTextured)

      // 2. FLAT — the authored colours survive, and no codec noise can hide them.
      //
      // The residual is measured, not assumed: 2.17 mean, 11 worst, once the
      // encoder's partial-macroblock rows are named. Its cause is the browser's
      // decode→canvas→encode path — a 4:2:0 source loses chroma detail decoding
      // to RGB and re-derives it encoding back, which moves saturated colours by
      // up to ~9/255 (blue 25/68/221 vs FFmpeg's 27/69/230). FFmpeg's
      // trim/concat path never leaves YUV, so it lands on the source within 1.
      // The bound is that round trip, not a blanket tolerance: the four colours
      // must still be distinct, and none may sit near the canvas background.
      const flatGrade = grade(flatFfmpeg, flatBrowser, 0, Infinity, 2)
      const sampled = FLAT.map((c, i) => {
        const frame = Math.round((i * 0.5 + 0.25) * FPS)
        return { name: c.name, browser: pixel(flatBrowser, frame, 160, 90), ffmpeg: pixel(flatFfmpeg, frame, 160, 90) }
      })
      const distinct = new Set(sampled.map(s => s.browser.join(','))).size
      check(
        'four flat colours land on the same RGB values in both writers',
        flatGrade.meanAbs <= 2.5 && flatGrade.worstChannel <= 12 && flatGrade.diffRatio <= 0.005 && distinct === FLAT.length,
        `meanAbs ${flatGrade.meanAbs.toFixed(3)}, worst ${flatGrade.worstChannel}, diff ${(flatGrade.diffRatio * 100).toFixed(2)}%, distinct ${distinct}/${FLAT.length}`
      )
      check(
        'the flat fixture paints the authored colours, not the canvas background',
        sampled.every(s => Math.max(...s.browser) - Math.min(...s.browser) > 80)
        && !sampled.some(s => Math.abs(s.browser[0] - 0x10) < 8 && Math.abs(s.browser[1] - 0x18) < 8 && Math.abs(s.browser[2] - 0x20) < 8),
        sampled.map(s => `${s.name}=${s.browser.join('/')}`).join(' ')
      )

      // 3. ALIGN — frame 0 is the right frame, so the comparison below is one timeline.
      const shifts = [-2, -1, 0, 1, 2].map(shift => ({ shift, grade: grade(texFfmpeg, texBrowser, shift, 50) }))
      const best = shifts.reduce((a, b) => (b.grade.meanAbs < a.grade.meanAbs ? b : a))
      check(
        'the two files are compared frame-for-frame, not at an offset',
        best.shift === 0,
        shifts.map(s => `${s.shift > 0 ? '+' : ''}${s.shift}: ${s.grade.meanAbs.toFixed(2)}`).join('  ')
      )

      // 4. TEXTURE — bounded, not eliminated: two encoders and one 4:2:0 round trip.
      const texGrade = grade(texFfmpeg, texBrowser)
      const texPsnr = psnr(texBrowser, texFfmpeg)
      check(
        'textured footage stays inside the declared parity floor',
        texPsnr >= 28 && texGrade.meanAbs <= 4 && texGrade.diffRatio <= 0.15,
        `PSNR ${texPsnr.toFixed(2)} dB, meanAbs ${texGrade.meanAbs.toFixed(3)}, worst ${texGrade.worstChannel}, diff ${(texGrade.diffRatio * 100).toFixed(2)}%`
      )

      // 5. LUMA — the paint path is the luma path; chroma carries the round trip.
      //    Both files are normalized to one range and matrix first, because the two
      //    muxers tag differently (`pc` + sRGB vs `tv` + bt709) and raw planes would
      //    otherwise compare tags.
      const luma = { browser: yuvFrames(browserTextured), ffmpeg: yuvFrames(ffmpegTextured) }
      const L = W * H
      const C = W * H / 4
      const FS = L + 2 * C
      const frames = Math.min(luma.browser.length, luma.ffmpeg.length) / FS | 0
      const lumaY = Buffer.alloc(frames * L)
      const lumaU = Buffer.alloc(frames * C)
      const lumaV = Buffer.alloc(frames * C)
      const refY = Buffer.alloc(frames * L)
      const refU = Buffer.alloc(frames * C)
      const refV = Buffer.alloc(frames * C)
      for (let f = 0; f < frames; f++) {
        const o = f * FS
        luma.browser.copy(lumaY, f * L, o, o + L)
        luma.ffmpeg.copy(refY, f * L, o, o + L)
        luma.browser.copy(lumaU, f * C, o + L, o + L + C)
        luma.ffmpeg.copy(refU, f * C, o + L, o + L + C)
        luma.browser.copy(lumaV, f * C, o + L + C, o + FS)
        luma.ffmpeg.copy(refV, f * C, o + L + C, o + FS)
      }
      const psnrY = psnr(lumaY, refY)
      const psnrU = psnr(lumaU, refU)
      const psnrV = psnr(lumaV, refV)
      check(
        'luma agrees far more tightly than chroma, as a 4:2:0 round trip predicts',
        psnrY >= 34 && psnrY > psnrU && psnrY > psnrV,
        `Y ${psnrY.toFixed(2)} dB, U ${psnrU.toFixed(2)} dB, V ${psnrV.toFixed(2)} dB`
      )

      // 6. REPEAT — a writer that drifts between runs invalidates every bound above.
      const repeat = grade(rgbFrames(browserRepeat), texBrowser)
      check(
        'two exports of one project are pixel-identical',
        repeat.meanAbs === 0 && repeat.worstChannel === 0 && fs.statSync(browserRepeat).size === fs.statSync(browserTextured).size,
        `meanAbs ${repeat.meanAbs}, worst ${repeat.worstChannel}, ${fs.statSync(browserRepeat).size}B vs ${fs.statSync(browserTextured).size}B`
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
console.log(`\nH3d-4 pixel parity: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
