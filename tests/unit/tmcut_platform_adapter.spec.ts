/**
 * Platform adapter (V4 Phase 1 / ADR-014, gap G3).
 *
 * The contract had no consumer: feature code sniffed `window.electronAPI`
 * while `TmcutPlatformAdapter` sat as a type. This spec is the proof that the
 * factory is the single host answer, and it pins the parts a reader cannot
 * eyeball:
 *  - capabilities per host, including the ones that must stay FALSE because the
 *    feature does not exist yet (webCodecs before roadmap M5);
 *  - the capture bounds, one window read from core by the only host that holds
 *    a render session (ADR-019 made them one contract, ADR-023 left one engine),
 *    asserted against those source files so the numbers cannot drift;
 *  - both encoders: the desktop one maps the export queue onto `TmcutRenderJob`
 *    (status rename + the output path known up front), the web one starts a job
 *    with one POST and folds each poll into its snapshot, and `cancel` stops
 *    the polling without pretending to stop the server's render.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_platform_adapter.spec.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

/**
 * What would make the main process an HTML-video capture host: a seek hook, an
 * image-pipe encoder, or a page screenshot. ADR-021 measured two engines on one
 * job — the server's animated, this one a still frame repeated — and ADR-023
 * deleted the second, so a re-appearing one has to fail here rather than reopen
 * that split on a user's composition.
 */
const CAPTURE_ENGINE_MARKERS = ['__tmcutSeek', 'image2pipe', 'capturePage']
function desktopCaptureEngines(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.(cjs|js|mjs)$/.test(entry.name) && CAPTURE_ENGINE_MARKERS.some(marker => read(rel).includes(marker))) found.push(rel)
    }
  }
  walk('electron')
  return found
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Scripted transport: each call answers from `replies` in order. */
function fakeRequest(replies: Record<string, unknown[]>) {
  const calls: { url: string, init?: Record<string, unknown> }[] = []
  const request = async <T>(url: string, init?: Record<string, unknown>): Promise<T> => {
    calls.push({ url, init })
    const queue = replies[url]
    if (!queue || queue.length === 0) throw new Error(`unexpected request ${url}`)
    return queue.shift() as T
  }
  return { request, calls }
}

/** The message a host answers with when asked to drive a session it cannot. */
type CaptureHost = { capture: { open(request: { html: string, width: number, height: number, fps: number }): Promise<unknown> } }
async function openFailure(adapter: CaptureHost): Promise<string> {
  const reason = await adapter.capture.open({ html: '<div/>', width: 64, height: 36, fps: 30 })
    .then(() => null, (caught: unknown) => caught)
  assert.ok(reason instanceof Error, 'a renderer that cannot drive a session must reject')
  return reason.message
}

async function main() {
  console.log('=== [TMCut platform adapter] Starting ===\n')
  // The export queue reaches the tool-task manager, which reads the preload
  // bridge off `window`. An empty window means "no bridge", which is exactly
  // the state the queue tolerates: `enqueueJob` still records and persists the
  // job, it just cannot start ffmpeg.
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  if (!g.useToast) g.useToast = () => ({ add: () => {} })

  const { useTmcutPlatform } = await import('../../app/composables/useTmcutPlatform')
  const { HTML_VIDEO_LIMITS } = await import('tmcut-core')

  await check('the web host declares what a browser can and cannot do', async () => {
    await freshStore()
    const platform = useTmcutPlatform({
      isDesktop: { value: false },
      resolveSrc: src => src ? `/uploads/${src}` : '',
      request: fakeRequest({}).request
    })
    assert.equal(platform.info.name, 'web')
    assert.equal(platform.info.capabilities.nativeFFmpeg, false, 'the browser runs no ffmpeg')
    assert.equal(platform.info.capabilities.filesystem, false, 'no local paths')
    assert.equal(platform.info.capabilities.largeFileAccess, false)
    assert.equal(platform.info.capabilities.backgroundRender, false)
    assert.equal(platform.info.capabilities.cloudRender, true, 'the Nitro server renders for it')
    assert.equal(platform.info.capabilities.webCodecs, false, 'roadmap M5 has not shipped an encoder')
    assert.equal(platform.info.capabilities.webGPU, false)
    assert.equal(platform.info.capabilities.hardwareEncoding, false)
  })

  await check('the desktop host declares the local pipeline', async () => {
    await freshStore()
    const platform = useTmcutPlatform({
      isDesktop: { value: true },
      resolveSrc: () => '',
      request: fakeRequest({}).request
    })
    assert.equal(platform.info.name, 'electron')
    assert.equal(platform.info.capabilities.filesystem, true)
    assert.equal(platform.info.capabilities.nativeFFmpeg, true)
    assert.equal(platform.info.capabilities.hardwareEncoding, true)
    assert.equal(platform.info.capabilities.backgroundRender, true)
    assert.equal(platform.info.capabilities.largeFileAccess, true)
    assert.equal(platform.info.capabilities.cloudRender, false, 'a local file needs no server')
  })

  await check('media resolution is delegated, not re-implemented', async () => {
    await freshStore()
    const seen: (string | null | undefined)[] = []
    const platform = useTmcutPlatform({
      isDesktop: { value: false },
      resolveSrc: (src) => {
        seen.push(src)
        return src ? `resolved:${src}` : ''
      },
      request: fakeRequest({}).request
    })
    assert.equal(platform.media.resolveSrc('clip.mp4'), 'resolved:clip.mp4')
    assert.equal(platform.media.resolveSrc(null), '')
    assert.deepEqual(seen, ['clip.mp4', null], 'the host owns the mapping, adapter only forwards')
  })

  await check('probe is one question with two honest answers (ADR-020)', async () => {
    await freshStore()
    const g = globalThis as Record<string, unknown>
    const previous = g.window
    const ffprobePaths: string[] = []
    let importPipelineCalls = 0
    g.window = {
      electronAPI: {
        tmcut: {
          // Raw ffprobe JSON, exactly what main returns: the adapter must hand
          // it to core, because a `30000/1001` frame rate is worth nothing to a
          // component that reads `metadata.fps`.
          probeMedia: async ({ filePath }: { filePath: string }) => {
            ffprobePaths.push(filePath)
            return {
              ok: true,
              probe: {
                format: { duration: '12.5' },
                streams: [
                  { codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30000/1001' },
                  { codec_type: 'audio' }
                ]
              }
            }
          },
          // The import pipeline is the other half of the ownership decision:
          // probing a file must not start producing thumbnails for it.
          analyzeAsset: async () => {
            importPipelineCalls++
            return { ok: true }
          }
        }
      }
    }
    try {
      const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })
      const meta = await desktop.media.probe('D:/clips/a.mkv')
      assert.deepEqual(ffprobePaths, ['D:/clips/a.mkv'], 'the stored path reaches ffprobe untouched')
      assert.equal(importPipelineCalls, 0, 'probe is read-only: it never runs the asset pipeline')
      assert.deepEqual(
        meta,
        { durationSec: 12.5, width: 640, height: 360, fps: 30000 / 1001, hasAudio: true },
        'core normalizes the answer on both hosts'
      )

      g.window = { electronAPI: { tmcut: { probeMedia: async () => ({ ok: false, error: 'ffprobe failed' }) } } }
      const refused = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })
      assert.equal(await refused.media.probe('D:/clips/broken.avi'), null, 'a host that cannot read the file says so instead of returning zeros')
    } finally {
      g.window = previous
    }

    // The browser has no ffprobe, so it probes the playable URL — the mapping
    // resolveSrc owns — and reports what an element can report.
    const urls: string[] = []
    const web = useTmcutPlatform({
      isDesktop: { value: false },
      resolveSrc: src => src ? `/uploads/${src}` : '',
      request: fakeRequest({}).request,
      probeWeb: async (url) => {
        urls.push(url)
        return { durationSec: 8, width: 1280, height: 720, fps: 0, hasAudio: true }
      }
    })
    assert.deepEqual(await web.media.probe('a.mp4'), { durationSec: 8, width: 1280, height: 720, fps: 0, hasAudio: true })
    assert.deepEqual(urls, ['/uploads/a.mp4'], 'the web host probes the URL it can actually load')

    // The consumers this leg was written for have moved past it: the two "add a
    // file to the timeline" handlers first guessed with a media element, then
    // asked this host leg, and now read the container through the one probe
    // service on both hosts. `media.probe` stays in the contract only until the
    // binary is cut, so no renderer module may call it any more — that ban is
    // pinned in tmcut_media_probe.spec.ts.
    const timeline = read('app/components/tmcut/TmcutTimeline.vue')
    assert.match(timeline, /platform\.media\.probeInfo\(filePath\)/, 'the timeline asks the demuxer service')
    assert.doesNotMatch(timeline, /tempVideo|tempAudio/, 'no element-based duration guess left behind')
  })

  await check('the browser answer reports only what a media element can see (ADR-020)', async () => {
    // The default web branch, driven by a fake DOM rather than an injected
    // answer. This is the half of ADR-020 that the adapter spec cannot get from
    // a stub: a browser really does not report a frame rate, and an element
    // with no video track is the only audio signal it has. A fake element fires
    // `onloadedmetadata` when `src` is assigned, the same order a real one
    // uses, so the util's own `preload`/`onerror`/timeout handling is exercised.
    const { probeWebMetadata } = await import('../../app/utils/tmcut/webProbe')
    const g = globalThis as Record<string, unknown>
    const previousDocument = g.document
    const previousAudio = g.Audio

    function fakeElement(props: Record<string, unknown>, mode: 'metadata' | 'error' = 'metadata') {
      const el: Record<string, unknown> = { preload: '', ...props }
      let value = ''
      Object.defineProperty(el, 'src', {
        configurable: true,
        get: () => value,
        set: (v: string) => {
          value = v
          setTimeout(() => {
            if (mode === 'error') (el.onerror as (() => void) | undefined)?.()
            else (el.onloadedmetadata as (() => void) | undefined)?.()
          }, 0)
        }
      })
      return el
    }

    try {
      g.document = { createElement: () => fakeElement({ duration: 8, videoWidth: 1280, videoHeight: 720 }) }
      const video = await probeWebMetadata('/uploads/a.mp4')
      assert.deepEqual(video, { durationSec: 8, width: 1280, height: 720, fps: 0, hasAudio: false })

      // Audio-only: no video track means zero intrinsic size, which is the
      // signal the browser gives without an audioTracks list.
      g.Audio = function () {
        return fakeElement({ duration: 30, videoWidth: 0, videoHeight: 0 })
      } as unknown as typeof Audio
      const audio = await probeWebMetadata('/uploads/voice.mp3', 'audio')
      assert.deepEqual(audio, { durationSec: 30, width: 0, height: 0, fps: 0, hasAudio: true })

      // A container Chromium cannot decode errors out, and the caller keeps
      // its own fallback instead of receiving a 0-second clip.
      g.document = { createElement: () => fakeElement({ duration: 0, videoWidth: 0, videoHeight: 0 }, 'error') }
      assert.equal(await probeWebMetadata('/uploads/broken.avi'), null, 'an unloadable file is null, not zeros')

      // Same for a file the element loads but reports no length for — a webm
      // with a streamed duration often does exactly this.
      g.document = { createElement: () => fakeElement({ duration: Infinity, videoWidth: 640, videoHeight: 360 }) }
      assert.equal(await probeWebMetadata('/uploads/stream.webm'), null)

      g.document = undefined
      assert.equal(await probeWebMetadata('/uploads/a.mp4'), null, 'no DOM, no answer (SSR)')

      // And the wiring: an adapter with no injected probe uses this util, so a
      // metadata question never instantiates the media composable.
      g.document = { createElement: () => fakeElement({ duration: 4, videoWidth: 320, videoHeight: 240 }) }
      const web = useTmcutPlatform({
        isDesktop: { value: false },
        resolveSrc: src => src ? `/uploads/${src}` : '',
        request: fakeRequest({}).request
      })
      assert.deepEqual(
        await web.media.probe('clip.mp4'),
        { durationSec: 4, width: 320, height: 240, fps: 0, hasAudio: false },
        'the web host defaults to the element probe over the playable URL'
      )

      // One web probe implementation, not a composable export and a util.
      const duplicated = [
        'app/composables/useTmcutMedia.ts',
        'app/components/tmcut/TmcutMediaPanel.vue',
        'app/composables/useTmcutPlatform.ts'
      ].filter(file => read(file).includes('probeWebMedia'))
      assert.deepEqual(duplicated, [], 'the old in-composable probe name is gone')
    } finally {
      g.document = previousDocument
      if (previousAudio === undefined) delete g.Audio
      else g.Audio = previousAudio
    }
  })

  await check('both hosts report the one render contract window (ADR-019)', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: fakeRequest({}).request })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })

    for (const fps of [HTML_VIDEO_LIMITS.minFps, 10, 14, 15, 30, HTML_VIDEO_LIMITS.maxFps]) {
      assert.equal(web.capture.supportsFps({ numerator: fps, denominator: 1 }), true, `web accepts ${fps}`)
      assert.equal(desktop.capture.supportsFps({ numerator: fps, denominator: 1 }), true, `desktop accepts ${fps}`)
    }
    // 29.97 is a legal composition rate in the spec validator; the desktop host
    // used to require a whole number, which is the same asymmetry as the window.
    for (const rate of [{ numerator: 30000, denominator: 1001 }, { numerator: 59, denominator: 2 }]) {
      assert.equal(web.capture.supportsFps(rate), true, `web accepts ${rate.numerator}/${rate.denominator}`)
      assert.equal(desktop.capture.supportsFps(rate), true, `desktop accepts ${rate.numerator}/${rate.denominator}`)
    }
    for (const fps of [0, HTML_VIDEO_LIMITS.maxFps + 1]) {
      const rate = { numerator: fps, denominator: 1 }
      assert.equal(web.capture.supportsFps(rate), false, `web rejects ${fps}`)
      assert.equal(desktop.capture.supportsFps(rate), false, `desktop rejects ${fps}`)
    }
    assert.equal(web.capture.supportsFps(Number.NaN), false, 'a rate that is not a number is not a rate')
    assert.equal(web.capture.supportsFps(30), true, 'a plain number is a legal rate too')

    // The window is only shared if exactly one host reads it. Before ADR-019 the
    // desktop kept its own `const MIN_FPS = 15`, so a 10 fps composition
    // rendered on web and was refused on desktop; ADR-023 retired that second
    // engine, so the guard is now structural: no main-process file may hold a
    // capture pipeline, and the render host must take its bounds from core.
    assert.deepEqual(desktopCaptureEngines(), [], 'the desktop holds no HTML-video engine')
    const server = read('server/utils/htmlVideoRender.ts')
    assert.match(server, /import \{[^}]*HTML_VIDEO_LIMITS[^}]*\} from 'tmcut-core'/, 'the render host reads the core contract')
    assert.doesNotMatch(server, /const (MIN_FPS|MAX_FPS|MAX_FRAMES|MAX_HTML_BYTES) =/, 'and keeps no second copy of the bounds')
    // Same rule for ADR-021: the predicate that decides whether a composition
    // needs author JavaScript stays core's, so the editor's lint and any host's
    // refusal can never drift apart.
    assert.doesNotMatch(server, /\/__hf\/\.(test|exec)\(/, 'the render host does not re-derive the seek predicate')
    // Being the only engine makes this file the only writer of a rendered
    // composition, and its output dir is git-ignored: a fresh checkout had no
    // `.data/uploads`, so the encode died on ENOENT (G15). It creates the dir now.
    assert.match(server, /mkdir\(config\.uploads\.dir, \{ recursive: true \}\)/, 'the render host creates its output dir')
    const spec = read('packages/core/src/htmlVideo.mjs')
    assert.match(spec, /minFps: 1/, 'composition spec floor used by the render host')
    assert.match(spec, /maxFps: 60/, 'composition spec ceiling used by the render host')
    assert.match(spec, /test: html => htmlVideoSeekContract\(html\) === 'declarative'/, 'lint and classification are one predicate')
  })

  await check('capture.open names the host that actually holds the session', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: fakeRequest({}).request })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })
    const webError = await openFailure(web)
    const desktopError = await openFailure(desktop)
    assert.match(webError, /server\/utils\/htmlVideoRender\.ts/)
    // ADR-023: the desktop job runs on the same server that serves the app, so
    // the two hosts answer one message. A second string here means a second
    // engine came back.
    assert.equal(desktopError, webError, 'one host answer for both hosts')
  })

  await check('the desktop encoder is the export queue seen as a render job', async () => {
    const s = await freshStore()
    const platform = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })
    const job = await platform.encoder.render({
      projectName: s.currentProject.value!.name,
      outputPath: 'D:/renders/out.mp4',
      mode: 'video',
      specs: '1920x1080',
      duration: 2,
      task: { args: ['-y'], meta: { taskId: 't-1', output: 'D:/renders/out.mp4', duration: 2, threads: 1, startedAt: new Date().toISOString() } }
    })
    assert.ok(['queued', 'running'].includes(job.status), `a fresh job is not terminal (got ${job.status})`)
    assert.equal(job.output?.path, 'D:/renders/out.mp4', 'the desktop path is known before the render')
    assert.equal(job.progress, 0)
    assert.equal(platform.encoder.getProgress(job.id), 0)
    assert.equal(platform.encoder.getJob?.(job.id)?.id, job.id, 'the queue job is the same job')
    assert.equal(platform.encoder.getJob?.('never-enqueued'), null)
    const queued = JSON.parse(localStorage.getItem('tmcut:export-queue') || '[]')
    assert.equal(queued.length, 1, 'the job really entered the persisted queue the queue UI reads')
  })

  await check('the web encoder starts with one POST and folds each poll in', async () => {
    await freshStore()
    const { request, calls } = fakeRequest({
      '/api/v1/media/render': [{ ok: true, jobId: 'r-7' }],
      '/api/v1/media/render/r-7': [
        { status: 'running', progress: 40, url: null, error: null },
        { status: 'running', progress: 80, url: null, error: null },
        { status: 'done', progress: 100, url: '/uploads/out.mp4', error: null }
      ]
    })
    const platform = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request })
    const started = await platform.encoder.render({ args: ['-y'], outputName: 'out.mp4', duration: 3 })
    assert.equal(started.id, 'r-7')
    assert.equal(started.status, 'running', 'the POST answers before any frame is encoded')
    assert.equal(calls.length, 1, 'starting a job is exactly one request')

    assert.equal((await platform.refreshJob('r-7'))?.progress, 40)
    assert.equal(platform.encoder.getProgress('r-7'), 40, 'progress is readable without another poll')
    assert.equal((await platform.refreshJob('r-7'))?.progress, 80)
    const done = await platform.refreshJob('r-7')
    assert.equal(done?.status, 'done')
    assert.equal(done?.output?.url, '/uploads/out.mp4', 'the web job reports a URL, not a path')
    assert.equal(calls.length, 4, 'one POST + three polls')
  })

  await check('a failed web job carries the host message; cancelling stops polling', async () => {
    await freshStore()
    const failing = fakeRequest({
      '/api/v1/media/render': [{ ok: true, jobId: 'r-8' }],
      '/api/v1/media/render/r-8': [{ status: 'failed', progress: 12, url: null, error: 'ffmpeg-exited-1' }]
    })
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: failing.request })
    await web.encoder.render({ args: [], outputName: 'x.mp4', duration: 1 })
    const failed = await web.refreshJob('r-8')
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.error, 'ffmpeg-exited-1', 'the export UI shows the reason, not a generic one')

    const cancelled = fakeRequest({ '/api/v1/media/render': [{ ok: true, jobId: 'r-9' }] })
    const host = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: cancelled.request })
    await host.encoder.render({ args: [], outputName: 'y.mp4', duration: 1 })
    await host.encoder.cancel('r-9')
    const after = await host.refreshJob('r-9')
    assert.equal(after?.status, 'cancelled')
    assert.equal(cancelled.calls.length, 1, 'a cancelled job polls no more')
  })

  await check('the encoder is built only when a job is asked for', async () => {
    await freshStore()
    const queueSource = read('app/composables/useTmcutExportQueue.ts')
    assert.match(queueSource, /const queue = ref<TmcutExportJob\[\]>\(loadQueue\(\)\)/, 'queue state is module-level')
    // A media/capability consumer must not instantiate the queue (it registers
    // listeners and a deep watcher). The factory keeps that behind first use;
    // the cheapest proof is that asking for capabilities touches no transport.
    const { request, calls } = fakeRequest({})
    const platform = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => 'x', request })
    assert.equal(platform.info.capabilities.cloudRender, true)
    assert.equal(platform.media.resolveSrc('a'), 'x')
    assert.equal(platform.capture.supportsFps({ numerator: 30, denominator: 1 }), true)
    assert.equal(calls.length, 0, 'capabilities and media alone make no requests')
  })

  await check('the preview engine reads its capabilities from the adapter', async () => {
    const player = read('app/composables/useTmcutPreviewEngine.ts')
    assert.match(player, /useTmcutPlatform\(\)/, 'the preview engine is an adapter consumer')
    assert.match(player, /platform\.info\.name === 'electron'/, 'one host answer, not a second sniff')
    assert.match(player, /platform\.media\.resolveSrc\(src\)/, 'media resolution comes from the adapter')
    assert.doesNotMatch(player, /window\.electronAPI|useTmcutMedia\(\)/, 'no duplicate runtime detection')

    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.match(modal, /platform\.info\.capabilities\.nativeFFmpeg/, 'dispatch is a capability check')
    assert.match(modal, /platform\.encoder\.render\(/, 'both render paths go through the encoder')
    assert.match(modal, /platform\.info\.capabilities\.filesystem/, 'the path UI gates on the filesystem capability')
  })

  console.log(`\n=== All ${passed} platform adapter checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
