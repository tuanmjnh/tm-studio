/**
 * Platform adapter (V4 Phase 1 / ADR-014, gap G3).
 *
 * The contract had no consumer: feature code sniffed `window.electronAPI`
 * while `TmcutPlatformAdapter` sat as a type. This spec is the proof that the
 * factory is the single host answer, and it pins the parts a reader cannot
 * eyeball:
 *  - capabilities per host, including the ones that must stay FALSE because the
 *    feature does not exist yet (webCodecs before roadmap M5);
 *  - the capture bounds, which are the two hosts' own validators — 15..60 for
 *    the Electron render path, the composition spec window for the server —
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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

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
  const { HTML_VIDEO_LIMITS } = await import('@tmcut-core')

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

  await check('capture bounds equal each host validator', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: fakeRequest({}).request })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })

    for (const fps of [1, 30, HTML_VIDEO_LIMITS.maxFps]) {
      assert.equal(web.capture.supportsFps({ numerator: fps, denominator: 1 }), true, `web accepts ${fps}`)
    }
    for (const fps of [0, HTML_VIDEO_LIMITS.maxFps + 1, 29.5]) {
      assert.equal(web.capture.supportsFps({ numerator: Math.round(fps * 2), denominator: 2 }), false, `web rejects ${fps}`)
    }
    assert.equal(desktop.capture.supportsFps({ numerator: 15, denominator: 1 }), true)
    assert.equal(desktop.capture.supportsFps({ numerator: 60, denominator: 1 }), true)
    assert.equal(desktop.capture.supportsFps({ numerator: 14, denominator: 1 }), false, 'below the render validator')
    assert.equal(desktop.capture.supportsFps({ numerator: 61, denominator: 1 }), false, 'above the render validator')
    assert.equal(web.capture.supportsFps(30), true, 'a plain number is a legal rate too')

    // The numbers above are copies of two validators living elsewhere. Read the
    // originals so a change there fails this spec instead of shipping a
    // capability report the host then refuses.
    const electron = read('electron/tools/html-video-renderer.cjs')
    assert.match(electron, /const MIN_FPS = 15/, 'Electron render window floor')
    assert.match(electron, /const MAX_FPS = 60/, 'Electron render window ceiling')
    const spec = read('packages/core/src/htmlVideo.mjs')
    assert.match(spec, /minFps: 1/, 'composition spec floor used by the web host')
    assert.match(spec, /maxFps: 60/, 'composition spec ceiling used by the web host')
  })

  await check('capture.open names the process that actually holds the session', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '', request: fakeRequest({}).request })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '', request: fakeRequest({}).request })
    const request = { html: '<div/>', width: 64, height: 36, fps: 30 }
    await assert.rejects(() => web.capture.open(request), /server\/utils\/htmlVideoRender\.ts/)
    await assert.rejects(() => desktop.capture.open(request), /electron\/tools\/html-video-renderer\.cjs/)
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
