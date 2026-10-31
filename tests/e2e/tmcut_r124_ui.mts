/**
 * R124 automated UI check (dev build only): drives the REAL dev server at
 * http://localhost:3000 through a system Chromium-based browser (Edge or
 * Chrome, headless) and verifies, on the live editor DOM, the four R124
 * behaviors:
 *
 *   1. audio engine  — a hidden <audio> element exists for the audio clip
 *      under the playhead, unmuted, volume = clip.volume × previewVolume,
 *      and actually plays after a real user click (play() unblocked).
 *   2. gestures      — pointer-captured right-handle trim: live geometry
 *      lives in window.tmcutQaStore.gesturePreview while the pointer is
 *      down, and the store commits ONCE with the final values on
 *      pointerup (same for the sliding left handle).
 *   3. parallel drop — synthetic HTML5 DnD of a second audio asset onto
 *      the audio row lands a parallel clip on that track; dropping into
 *      the empty area below the last row creates a NEW audio track.
 *   4. vertical scroll — with 7 tracks the tracks container is
 *      vertically scrollable and the headers column follows scrollTop.
 *
 * Plus: HUD rework (two rows: labels-only row above icon-actions row)
 * and no pageerror during the whole run.
 *
 * Run:  pnpm dev                       # terminal 1 (http://localhost:3000)
 *       tsx tests/e2e/tmcut_r124_ui.mts # terminal 2
 *
 * Needs no TM Hub, no login, no real media files: the store hydrates
 * from localStorage keys that the harness seeds before reload, and the
 * QA hook (dev-only, useTmcutProject) exposes live refs.
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEV_URL = process.env.TMCUT_DEV_URL || 'http://localhost:4002'
const HUB_PORT = process.env.TMCUT_HUB_PORT || '4000'
const PROJECT_ID = 'qa-r124'
const VIDEO_ASSET_ID = 'qa-asset-video'
const AUDIO_A_ID = 'qa-asset-audio-a'
const AUDIO_B_ID = 'qa-asset-audio-b'

// --- fixtures -------------------------------------------------------------

// Real media, generated at runtime (no ffmpeg needed): a 1920x1080 1s
// PNG cover for the video asset, and two 3s mono 44.1kHz WAVs for the audio
// assets. The editor's preview engine plays audio through the hidden
// <audio> element, so the file MUST actually be playable by the browser —
// a fake src would silence the whole audio-engine check.
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
function makeWav(f1: number, f2: number): string {
  const sr = 44100
  const n = sr * 3
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    samples[i] = Math.round(32767 * 0.5 * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)))
  }
  const bytes = new Uint8Array(44 + samples.buffer.byteLength)
  const view = new DataView(bytes.buffer)
  let p = 0
  const w = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes[p++] = s.charCodeAt(i)
  }
  const u32 = (v: number) => {
    view.setUint32(p, v, true)
    p += 4
  }
  const u16 = (v: number) => {
    view.setUint16(p, v, true)
    p += 2
  }
  w('RIFF')
  u32(36 + samples.buffer.byteLength)
  w('WAVE')
  w('fmt ')
  u32(16)
  u16(1)
  u16(1)
  u32(sr)
  u32(sr * 2)
  u16(2)
  u16(16)
  w('data')
  u32(samples.buffer.byteLength)
  bytes.set(new Uint8Array(samples.buffer), 44)
  return 'data:audio/wav;base64,' + Buffer.from(bytes).toString('base64')
}
const WAV_A_DATA_URL = makeWav(440, 660)

const VIDEO_ASSET = {
  id: VIDEO_ASSET_ID,
  kind: 'video',
  name: 'qa-video.mp4',
  path: 'D:/qa/video.mp4',
  usedBy: [PROJECT_ID],
  status: 'ready',
  meta: { durationSec: 10, width: 1280, height: 720, fps: 30, fileSize: 1000, mtimeMs: 0, probedAt: null, hasVideo: true },
  thumbPath: PNG_DATA_URL,
  filmstripPath: null,
  waveformPath: null,
  proxyPath: null,
  proxyStatus: 'none',
  addedAt: new Date().toISOString()
}

const AUDIO_A_ASSET = {
  ...VIDEO_ASSET,
  id: AUDIO_A_ID,
  kind: 'audio',
  name: 'qa-audio-a.wav',
  path: 'D:/qa/audio-a.wav',
  meta: { durationSec: 3, width: 0, height: 0, fps: 0, fileSize: 1000, mtimeMs: 0, probedAt: null, hasVideo: false },
  thumbPath: null,
  waveformPath: null
}

const AUDIO_B_ASSET = {
  ...AUDIO_A_ASSET,
  id: AUDIO_B_ID,
  name: 'qa-audio-b.wav',
  path: 'D:/qa/audio-b.wav'
}

function buildProject(): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    name: 'QA R124',
    cover: '',
    durationMs: 0,
    canvas: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 }, aspectRatio: '16:9', background: { type: 'color', color: '#000000' } },
    timeline: {
      version: 1,
      tracks: [
        { id: 'qa-text', type: 'text', name: 'Text', items: [] },
        { id: 'qa-video', type: 'video', name: 'Video 1', items: [
          { id: 'qa-clip-v1', name: 'qa-video', src: PNG_DATA_URL, in: 0, out: 240000, offset: 600000, speed: 1, opacity: 1, scale: 1, x: 0, y: 0, rotation: 0 }
        ] },
        { id: 'qa-audio-1', type: 'audio', name: 'Audio 1', items: [
          // Store volume is PERCENT (0..100), not 0..1 — matches the
          // app's v1 heritage; the preview layer normalizes to el.volume.
          { id: 'qa-clip-a1', name: 'qa-audio-a', src: WAV_A_DATA_URL, in: 0, out: 600000, offset: 0, speed: 1, opacity: 1, scale: 1, x: 0, y: 0, rotation: 0, volume: 100 }
        ] }
      ],
      durationMs: 0,
      markers: []
    },
    settings: { resolution: '1920x1080', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 5000 },
    source: 'manual',
    schemaVersion: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

function seedScript(): string {
  const project = buildProject()
  return `(function () {
    localStorage.setItem('tmcut_project_${PROJECT_ID}', ${JSON.stringify(JSON.stringify(project))})
    return 'seeded'
  })()`
}

// Media assets are pushed through the dev QA hook, NOT localStorage: the
// web runtime (no Electron IPC) deliberately clears the library on load
// because blob: URLs die on reload. See useTmcutMedia.loadLibrary.
const ASSET_FIXTURES = [VIDEO_ASSET, AUDIO_A_ASSET, AUDIO_B_ASSET]

// --- tiny harness ----------------------------------------------------------

let passed = 0
let failed = 0
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  [ok] ${name}`)
  } catch (err) {
    failed++
    console.error(`  [FAIL] ${name}\n         ${(err as Error).message}`)
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// --- driver ----------------------------------------------------------------

async function findBrowserExe(): Promise<string> {
  const candidates = [
    process.env.CHROME_EXE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error('No Chromium-based browser found. Set CHROME_EXE to a chrome/msedge executable.')
}

async function waitForDev(timeoutMs = 120000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const r = await fetch(DEV_URL + '/login')
      if (r.ok) return
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`dev server not reachable at ${DEV_URL}`)
    await new Promise(r => setTimeout(r, 2000))
  }
}

async function main(): Promise<void> {
  console.log(`R124 UI check against ${DEV_URL}`)
  const browserExe = await findBrowserExe()
  console.log(`browser: ${browserExe}`)

  // The app needs a TM Hub for auth. Reuse one that is already up, else
  // spawn the local stub (tests/e2e/hub-stub.cjs: /auth/me returns a root
  // user, which short-circuits the RBAC route check in auth.global.ts).
  let hubProc: ReturnType<typeof spawn> | null = null
  const hubAlive = await fetch(`http://localhost:${HUB_PORT}/api/v1/auth/me`)
    .then(() => true)
    .catch(() => false)
  if (hubAlive) {
    console.log(`hub already answering on :${HUB_PORT} — reusing it`)
  } else {
    hubProc = spawn(process.execPath, [path.join(ROOT, 'tests/e2e/hub-stub.cjs')], {
      cwd: ROOT,
      env: { ...process.env, HUB_PORT },
      stdio: 'ignore'
    })
    console.log(`stub hub spawned on :${HUB_PORT} (pid ${hubProc.pid})`)
  }

  await waitForDev()

  const browser = await chromium.launch({
    executablePath: browserExe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
  })
  const context = await browser.newContext({ viewport: { width: 1680, height: 980 } })
  // Fake session cookie; only its PRESENCE matters — the stub accepts any
  // bearer token and answers /me with roles:['root'].
  await context.addCookies([
    { url: DEV_URL + '/login', name: 'accessToken', value: 'qa-token' },
    { url: DEV_URL + '/login', name: 'refreshToken', value: 'qa-refresh' }
  ])
  const page = await context.newPage()

  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const domPropWarnings: string[] = []
  page.on('pageerror', err => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    // Vue "Failed setting prop ... invalid" warnings are console.warn —
    // they signal a unit mismatch leaking straight into a DOM property
    // (the volume=100 bug). Fail the run on any of them.
    if (msg.text().includes('Failed setting prop')) domPropWarnings.push(msg.text())
  })

  // 1) load the app (unauthenticated lands on /login — fine, same origin)
  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })

  // 2) seed store state, then hard-reload straight into the editor
  await page.evaluate(seedScript())
  await page.goto(`${DEV_URL}/tmcut/editor?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded', timeout: 90000 })

  // 3) wait for the dev QA hook + hydrated current project
  await page.waitForFunction(
    (pid: string) => (window as any).tmcutQaStore?.currentProject?.value?.id === pid,
    PROJECT_ID,
    { timeout: 30000 }
  )
  await page.waitForSelector('[data-tmcut-clip]', { timeout: 30000 })
  await page.waitForTimeout(500)

  // Push the media fixtures through the dev hook (web runtime clears the
  // library on load — localStorage seeding is deliberately ignored).
  await page.evaluate((fixtures) => {
    const s = (window as any).tmcutQaStore
    if (!s?.assets) throw new Error('tmcutQaStore.assets missing — dev hook incomplete?')
    s.assets.value = fixtures
  }, ASSET_FIXTURES)

  console.log('\n— checks —')

  // 3.5 harness self-check: the dev hook is alive
  await check('QA hook exposed (dev-only store ref)', async () => {
    const ok = await page.evaluate(() => !!(window as any).tmcutQaStore)
    assert(ok, 'window.tmcutQaStore missing — is the app a dev build?')
  })

  // 1) audio engine -----------------------------------------------------
  await check('hidden <audio> exists for the clip under the playhead', async () => {
    const res = await page.evaluate(() => {
      const player = document.querySelector('.tmcut-monitor')
      if (!player) return { ok: false, why: 'no .tmcut-monitor' }
      const audios = Array.from(player.querySelectorAll('audio'))
      const src = audios.map(a => (a.getAttribute('src') || '').slice(0, 24))
      return { ok: audios.length === 1, why: 'count=' + audios.length, src }
    })
    assert(res.ok, `expected exactly 1 hidden <audio>, got: ${res.why} ${JSON.stringify(res.src)}`)
  })

  await check('audio element is unmuted with composed volume (clip 1 × preview 1)', async () => {
    const res = await page.evaluate(() => {
      const a = document.querySelector('.tmcut-monitor audio') as HTMLAudioElement | null
      if (!a) return { ok: false }
      return { ok: !a.muted && Math.abs(a.volume - 1) < 0.001, muted: a.muted, volume: a.volume }
    })
    assert(res.ok, `muted=${res.muted} volume=${res.volume}`)
  })

  await check('playback: real click on play puts the media clock forward', async () => {
    // Exact title match: a substring selector would hit "Set In point at
    // playhead (I)" first and silently set an in point instead of playing.
    await page.click('button[title^="Play"]', { timeout: 5000 })
    await page.waitForTimeout(900)
    const a = await page.evaluate(async () => {
      const el = document.querySelector('.tmcut-monitor audio') as HTMLAudioElement | null
      if (!el) return { ok: false, why: 'no audio element' }
      const first = el.currentTime
      await new Promise(r => setTimeout(r, 600))
      return { ok: !el.paused && el.currentTime > first, paused: el.paused, first, second: el.currentTime }
    })
    assert(a.ok, `audio not advancing (paused=${(a as any).paused}, t ${(a as any).first} -> ${(a as any).second})`)
    // Leave the timeline paused: the gesture checks below need a stable playhead.
    await page.click('button[title^="Pause"]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(200)
  })

  // 2) gestures ----------------------------------------------------------
  const clipBox = await page.locator('[data-tmcut-clip]').first().boundingBox()
  assert(clipBox, 'clip element not found on timeline')

  await check('right-handle trim: live geometry in gesturePreview, commit once on release', async () => {
    const box = await page.locator('[data-tmcut-clip]').first().boundingBox()!
    // Right trim handle is the ~12px band at the clip's right edge.
    const startX = box.x + box.width - 6
    const startY = box.y + box.height / 2
    const dragPx = 100

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dragPx / 2, startY, { steps: 10 })
    await page.waitForTimeout(80)

    // While the pointer is down: preview map holds the live patch, store
    // still shows the committed (unchanged) values.
    const mid = await page.evaluate(() => {
      const s = (window as any).tmcutQaStore
      const prev = s.gesturePreview.value
      const cur = s.currentProject.value
      const clip = cur.timeline.tracks.find((t: any) => t.id === 'qa-video').items.find((i: any) => i.id === 'qa-clip-v1')
      return { preview: { ...prev }, out: clip.out }
    })
    assert(mid.preview['qa-clip-v1'] && typeof mid.preview['qa-clip-v1'].out === 'number',
      'gesturePreview should carry the live out patch while dragging, got ' + JSON.stringify(mid.preview))
    assert(mid.out === 240000, 'store must stay untouched mid-gesture, out=' + mid.out)

    await page.mouse.move(startX + dragPx, startY, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(150)

    const after = await page.evaluate(() => {
      const s = (window as any).tmcutQaStore
      const clip = s.currentProject.value.timeline.tracks.find((t: any) => t.id === 'qa-video').items.find((i: any) => i.id === 'qa-clip-v1')
      return { out: clip.out, previewCount: Object.keys(s.gesturePreview.value).length }
    })
    assert(after.previewCount === 0, 'gesturePreview must be cleared after release')
    assert(after.out > 240000, 'out must extend past 240000 after a right drag, got ' + after.out)
  })

  await check('left-handle sliding trim: at in=0 the clip slides left (CapCut behavior)', async () => {
    const box = await page.locator('[data-tmcut-clip]').first().boundingBox()!
    const startX = box.x + 5
    const startY = box.y + box.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 60, startY, { steps: 10 })
    // Mid-drag: gesturePreview must already carry the slid offset while
    // the STORE stays untouched (commit-on-release design, R124).
    const mid = await page.evaluate(() => {
      const s = (window as any).tmcutQaStore
      const clip = s.currentProject.value.timeline.tracks.find((t: any) => t.id === 'qa-video').items.find((i: any) => i.id === 'qa-clip-v1')
      return { preview: { ...(s.gesturePreview.value || {}) }, offset: clip.offset }
    })
    const midPatch = mid.preview['qa-clip-v1'] || {}
    assert(midPatch.offset !== undefined && midPatch.offset < 600000,
      'gesturePreview must slide offset mid-drag, got ' + JSON.stringify(mid.preview))
    assert(mid.offset === 600000, 'store must stay untouched mid-drag, got ' + mid.offset)
    await page.mouse.up()
    await page.waitForTimeout(150)

    const after = await page.evaluate(() => {
      const clip = (window as any).tmcutQaStore.currentProject.value.timeline.tracks.find((t: any) => t.id === 'qa-video').items.find((i: any) => i.id === 'qa-clip-v1')
      return { in: clip.in, offset: clip.offset }
    })
    assert(after.in === 0, 'in must stay clamped at 0, got ' + after.in)
    assert(after.offset < 600000, `offset must slide left of 600000, got ${after.offset}`)
  })

  // 3) parallel drop -------------------------------------------------------
  // HTML5 DnD cannot be driven through Playwright's mouse API, and
  // dispatchEvent cannot serialize a JS dataTransfer. Build a REAL
  // DataTransfer + DragEvent inside the page instead — the app handlers
  // (dragover.prevent + drop hit-test) run exactly as in a user drag.
  const dropAt = async (selector: string, payload: { id: string, kind: string }, offsetX = 60, offsetY = 0.5) => {
    await page.evaluate(async ({ sel, payload, offX, offY }) => {
      const el = document.querySelector(sel)
      if (!el) throw new Error('drop target missing: ' + sel)
      const r = el.getBoundingClientRect()
      const x = r.left + offX
      const y = offY < 1 ? r.top + r.height * offY : r.top + offY
      const dt = new DataTransfer()
      dt.setData('application/x-tmcut-asset', JSON.stringify(payload))
      const target = document.elementFromPoint(x, y) || el
      target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    }, { sel: selector, payload, offX: offsetX, offY: offsetY })
    await page.waitForTimeout(150)
  }

  await check('DnD drop on the audio row creates a PARALLEL clip on that track', async () => {
    await dropAt('[data-track-row="qa-audio-1"]', { id: AUDIO_B_ID, kind: 'audio' })
    const res = await page.evaluate(() => {
      const p = (window as any).tmcutQaStore.currentProject.value
      const row = p.timeline.tracks.find((t: any) => t.id === 'qa-audio-1')
      const audioTracksCount = p.timeline.tracks.filter((t: any) => t.type === 'audio').length
      return { rowItems: row ? row.items.length : -1, audioTracksCount }
    })
    assert(res.rowItems === 2, `qa-audio-1 must hold 2 parallel clips after the drop, got ${res.rowItems} (audioTracks=${res.audioTracksCount})`)
  })

  await check('drop in the empty area below the last row creates a NEW audio track', async () => {
    // The container extends below the last row (flex canvas fills it), so
    // a point near the container BOTTOM is guaranteed to be under all rows.
    await dropAt('[data-tmcut-tracks-container]', { id: AUDIO_A_ID, kind: 'audio' }, 60, 0.97)
    const res = await page.evaluate(() => {
      const p = (window as any).tmcutQaStore.currentProject.value
      const audioTracks = p.timeline.tracks.filter((t: any) => t.type === 'audio')
      const last = p.timeline.tracks[p.timeline.tracks.length - 1]
      return { audioTrackCount: audioTracks.length, lastType: last?.type, lastItems: (last?.items || []).length }
    })
    assert(res.audioTrackCount === 2 && res.lastType === 'audio' && res.lastItems === 1,
      `expected a new audio track with 1 clip at the end, got ${JSON.stringify(res)}`)
  })

  // 4) vertical scroll ----------------------------------------------------
  await check('vertical track scroll: many tracks → scrollable, ruler sticky, headers follow', async () => {
    await page.evaluate(() => {
      const s = (window as any).tmcutQaStore
      const p = s.currentProject.value
      for (let i = 0; i < 4; i++) {
        p.timeline.tracks.push({ id: 'qa-x' + i, type: 'video', name: 'VX' + i, items: [] })
      }
    })
    await page.waitForTimeout(300)

    const res = await page.evaluate(async () => {
      const container = document.querySelector('[data-tmcut-tracks-container]') as HTMLElement | null
      if (!container) return { ok: false, why: 'no tracks container' }
      const headers = document.querySelector('[data-tmcut-track-headers]') as HTMLElement | null
      if (!headers) return { ok: false, why: 'no headers column' }
      const ruler = document.querySelector('[data-tmcut-ruler]') as HTMLElement | null
      if (!ruler) return { ok: false, why: 'no ruler' }
      const scrollable = container.scrollHeight > container.clientHeight + 4
      return {
        ok: scrollable, scrollable, why: 'ready for trusted wheel',
        scrollTop: container.scrollTop, clientH: container.clientHeight, contentH: container.scrollHeight
      }
    })
    assert(res.ok, JSON.stringify(res))

    // Trusted wheel through the real input pipeline (a synthetic_wheel
    // event has isTrusted=false and Chromium ignores it for scrolling).
    const box = await page.locator('[data-tmcut-tracks-container]').boundingBox()!
    await page.mouse.move(box.x + 200, box.y + 100)
    await page.mouse.wheel(0, 140)
    await page.waitForTimeout(300)

    const synced = await page.evaluate(() => {
      const container = document.querySelector('[data-tmcut-tracks-container]') as HTMLElement
      const headers = document.querySelector('[data-tmcut-track-headers]') as HTMLElement
      const ruler = document.querySelector('[data-tmcut-ruler]') as HTMLElement
      return {
        scrollTop: container.scrollTop,
        headersTop: headers.scrollTop,
        rulerSticky: ruler.getBoundingClientRect().top >= container.getBoundingClientRect().top - 2
      }
    })
    assert(synced.scrollTop >= 100, `container did not scroll on trusted wheel: ${JSON.stringify(synced)}`)
    assert(synced.headersTop >= 100, `headers did not follow container scroll (${synced.headersTop}): ${JSON.stringify(synced)}`)
    assert(synced.rulerSticky, 'ruler is no longer pinned while scrolling: ' + JSON.stringify(synced))
  })

  // 5) HUD two-row rework --------------------------------------------------
  await check('preview HUD is exactly two rows (labels above icon actions)', async () => {
    const res = await page.evaluate(() => {
      const monitor = document.querySelector('.tmcut-monitor')
      const player = monitor?.parentElement?.parentElement
      if (!player) return { ok: false, why: 'no player root' }
      const hud = player.firstElementChild
      if (!hud) return { ok: false, why: 'no hud' }
      const rows = Array.from(hud.children)
      if (rows.length !== 2) return { ok: false, why: 'rows=' + rows.length }
      const row1Buttons = rows[0].querySelectorAll('button').length
      const row2Buttons = rows[1].querySelectorAll('button').length
      const row1Text = rows[0].textContent || ''
      return {
        ok: row1Buttons === 0 && row2Buttons >= 4 && row1Text.length > 0,
        row1Buttons, row2Buttons, row1Snippet: row1Text.slice(0, 40)
      }
    })
    assert(res.ok, JSON.stringify(res))
  })

  // 6) global health --------------------------------------------------------
  await check('no pageerror during the run', async () => {
    assert(pageErrors.length === 0, 'page errors: ' + pageErrors.slice(0, 3).join(' | '))
  })

  await check('no DOM prop unit warnings (Vue "Failed setting prop")', async () => {
    assert(domPropWarnings.length === 0, 'dom prop warnings: ' + domPropWarnings.slice(0, 2).join(' | '))
  })

  console.log(`\nconsole error lines captured (informational): ${consoleErrors.length}`)
  for (const line of consoleErrors.slice(0, 8)) console.log('   · ' + line.slice(0, 160))

  await browser.close()
  hubProc?.kill()
  console.log(`\nR124 UI result: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err)
  process.exit(1)
})
