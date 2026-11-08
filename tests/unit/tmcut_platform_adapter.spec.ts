/**
 * Platform adapter (V4 Phase 1 / ADR-014, gap G3).
 *
 * The contract had no consumer: feature code sniffed `window.electronAPI`
 * while `TmcutPlatformAdapter` sat as a type. This spec is the proof that the
 * factory is the single host answer, and it pins the parts a reader cannot
 * eyeball:
 *  - capabilities per host, including the ones that must stay FALSE because the
 *    feature does not exist yet (`backgroundRender`: nothing queues a render);
 *  - the capture bounds, one window read from core by the only host that holds
 *    a render session (ADR-019 made them one contract, ADR-023 left one engine),
 *    asserted against those source files so the numbers cannot drift;
 *  - the absence of a host encoder. Zero-FFmpeg slice I deleted the desktop
 *    queue and the server render route, so the adapter has no `encoder` and no
 *    `refreshJob`: both hosts encode in-process through the WebCodecs export.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_platform_adapter.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  if (!g.useToast) g.useToast = () => ({ add: () => {} })

  const { useTmcutPlatform } = await import('../../app/composables/useTmcutPlatform')
  const { HTML_VIDEO_LIMITS } = await import('tmcut-core')

  await check('the web host declares what a browser can and cannot do', async () => {
    await freshStore()
    const platform = useTmcutPlatform({
      isDesktop: { value: false },
      resolveSrc: src => src ? `/uploads/${src}` : ''
    })
    assert.equal(platform.info.name, 'web')
    assert.equal(platform.info.capabilities.filesystem, false, 'no local paths')
    assert.equal(platform.info.capabilities.largeFileAccess, false)
    assert.equal(platform.info.capabilities.backgroundRender, false, 'nothing queues a render any more')
    assert.equal(platform.info.capabilities.cloudRender, false, 'the timeline export never leaves this tab')
    assert.equal(platform.info.capabilities.webCodecs, true, 'the in-process encoder is what writes the file')
    assert.equal(platform.info.capabilities.webGPU, false)
    assert.equal(platform.info.capabilities.hardwareEncoding, false, 'the runtime picks the encoder backend')
    assert.equal('nativeFFmpeg' in platform.info.capabilities, false, 'the capability key is retired')
  })

  await check('the desktop host declares local file access, not a render pipeline', async () => {
    await freshStore()
    const platform = useTmcutPlatform({
      isDesktop: { value: true },
      resolveSrc: () => ''
    })
    assert.equal(platform.info.name, 'electron')
    assert.equal(platform.info.capabilities.filesystem, true)
    assert.equal(platform.info.capabilities.webCodecs, true)
    assert.equal(platform.info.capabilities.hardwareEncoding, false, 'no ffmpeg profile chooser is left')
    assert.equal(platform.info.capabilities.backgroundRender, false, 'no render queue is left')
    assert.equal(platform.info.capabilities.largeFileAccess, true)
    assert.equal(platform.info.capabilities.cloudRender, false, 'a local file needs no server')
  })

  await check('both hosts answer the full capability matrix, key by key', async () => {
    // Brief item 6 asks for parity *per capability*, not a spot check of a few
    // booleans. Two failures are therefore pinned here: a key that stops being
    // declared (silently false everywhere) and a host and core disagreeing on
    // the key set. The matrix is the contract; the values are each host's answer.
    const { PLATFORM_CAPABILITIES } = await import('tmcut-core')
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '' })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '' })

    const MATRIX: Record<string, { web: boolean, electron: boolean }> = {
      filesystem: { web: false, electron: true },
      webCodecs: { web: true, electron: true },
      webGPU: { web: false, electron: false },
      hardwareEncoding: { web: false, electron: false },
      backgroundRender: { web: false, electron: false },
      cloudRender: { web: false, electron: false },
      largeFileAccess: { web: false, electron: true }
    }
    assert.deepEqual(Object.keys(MATRIX).sort(), [...PLATFORM_CAPABILITIES].sort(),
      'a capability key exists in one place and not the other')
    for (const [key, expected] of Object.entries(MATRIX)) {
      assert.equal(web.info.capabilities[key], expected.web, `web.${key}`)
      assert.equal(desktop.info.capabilities[key], expected.electron, `electron.${key}`)
    }
    // The one host difference that matters for media: desktop reads the file
    // from disk, web cannot. Everything the timeline needs is true on both.
    const shared = PLATFORM_CAPABILITIES.filter(key => key !== 'filesystem' && key !== 'largeFileAccess')
    for (const key of shared) {
      assert.equal(web.info.capabilities[key], desktop.info.capabilities[key],
        `${key} must be the same answer on both hosts — nothing renders in one and not the other`)
    }
  })

  await check('the adapter carries no host render engine', async () => {
    await freshStore()
    const platform = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '' })
    assert.equal('encoder' in platform, false, 'encoding is the in-process WebCodecs session')
    assert.equal('refreshJob' in platform, false, 'there is no host job to poll')
    const source = read('app/composables/useTmcutPlatform.ts')
    assert.doesNotMatch(source, /TmcutRenderEngine|TmcutRenderJob/, 'the contract types are not imported')
    assert.doesNotMatch(source, /useTmcutExportQueue/, 'the queue is gone with the engine')
    assert.equal(existsSync(join(root, 'app/composables/useTmcutExportQueue.ts')), false)
    assert.equal(existsSync(join(root, 'server/api/v1/media/render.post.ts')), false, 'the render route is deleted')
    assert.equal(existsSync(join(root, 'server/api/v1/media/render/[jobId].get.ts')), false)
  })

  await check('no renderer asks a host for a media transform the host no longer has', () => {
    // Slice I deleted the FFmpeg engine on BOTH sides: the desktop channels
    // (tmcut.controller.cjs) and the Nitro routes (server/api/v1/media). The
    // type-checker catches a call on the typed bridge, but it does not catch a
    // `$fetch` to a route that returns 404, and it cannot see a call that goes
    // through a local wrapper. So the two shapes are pinned by name:
    //  - a renderer that still calls a deleted IPC method (generateProxy was
    //    the survivor: it compiled against a stale shared type and the panel
    //    offered a button that rejected at runtime);
    //  - a renderer that still POSTs to a deleted media route.
    //
    // Comments are excluded from every scan below: a comment may still name a
    // retired channel or route to explain why it is gone, and that prose is not
    // a call. Only executable lines are evidence.
    const codeOnly = (source: string) => source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trimStart()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    }).join('\n')
    const media = codeOnly(read('app/composables/useTmcutMedia.ts'))
    assert.doesNotMatch(media, /generateProxy|ipc\.(stabilizeVideo|extractFrame|probeMedia)/,
      'the media composable may not call a channel the preload stopped offering')
    const panel = codeOnly(read('app/components/tmcut/TmcutMediaPanel.vue'))
    assert.doesNotMatch(panel, /generateProxy/, 'the panel may not offer a proxy button nothing can answer')

    // The storage surface is the whole list: upload bytes, stream them back.
    // Voice is the one exception because TTS is a provider call, not a
    // transform of the user's file.
    const allowed = new Set(['/api/v1/media/upload', '/api/v1/media/tts', '/api/v1/media/tts/status'])
    const declared = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.(ts|vue)$/.test(entry.name)) {
          for (const hit of codeOnly(read(rel)).matchAll(/['"`](\/api\/v1\/media\/[A-Za-z0-9/_-]+)/g)) declared.add(hit[1]!)
        }
      }
    }
    walk('app')
    const unknown = [...declared].filter(route => !allowed.has(route)).sort()
    assert.deepEqual(unknown, [], `app calls media routes the server no longer serves: ${unknown.join(', ')}`)
  })

  await check('media resolution is delegated, not re-implemented', async () => {
    await freshStore()
    const seen: (string | null | undefined)[] = []
    const platform = useTmcutPlatform({
      isDesktop: { value: false },
      resolveSrc: (src) => {
        seen.push(src)
        return src ? `resolved:${src}` : ''
      }
    })
    assert.equal(platform.media.resolveSrc('clip.mp4'), 'resolved:clip.mp4')
    assert.equal(platform.media.resolveSrc(null), '')
    assert.deepEqual(seen, ['clip.mp4', null], 'every call reaches the host resolver')
  })

  await check('the adapter carries one probe, and it writes nothing', async () => {
    await freshStore()
    const source = read('app/composables/useTmcutPlatform.ts')
    const contract = read('packages/core/types/platform.ts')
    // Slice I deleted the ffprobe leg, so the raw-JSON `probe` that only a host
    // binary could answer went with it. One demuxing service answers both hosts
    // now, and a second shape would be a second truth.
    assert.doesNotMatch(source, /normalizeProbe|probeWebMetadata/, 'the two-answer probe is gone')
    assert.doesNotMatch(contract, /probe\(src: string\): Promise<TmcutMediaMetadata/, 'the contract carries one probe')
    assert.match(contract, /probeInfo\(src: string/, 'and the one it carries is the demuxer answer')
    assert.equal(existsSync(join(root, 'app/utils/tmcut/webProbe.ts')), false, 'the browser half left with it')

    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '' })
    assert.equal('probe' in desktop.media, false, 'no probe beside probeInfo')
    assert.equal(typeof desktop.media.probeInfo, 'function', 'probeInfo is still the adapter answer')
  })

  await check('both hosts report the one render contract window (ADR-019)', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '' })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '' })

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
    // engine, so the guard is structural: no main-process file may hold a
    // capture pipeline, and the bounds must come from core.
    assert.deepEqual(desktopCaptureEngines(), [], 'the desktop holds no HTML-video engine')
    const spec = read('packages/core/src/htmlVideo.mjs')
    assert.match(spec, /minFps: 1/, 'composition spec floor')
    assert.match(spec, /maxFps: 60/, 'composition spec ceiling')
  })

  await check('capture.open names the host that actually holds the session', async () => {
    await freshStore()
    const web = useTmcutPlatform({ isDesktop: { value: false }, resolveSrc: () => '' })
    const desktop = useTmcutPlatform({ isDesktop: { value: true }, resolveSrc: () => '' })
    const webError = await openFailure(web)
    const desktopError = await openFailure(desktop)
    // Zero-FFmpeg slice I deleted server/utils/htmlVideoRender.ts with the
    // capture route; the message still refuses, and it must name the retirement
    // rather than a file that no longer exists.
    assert.match(webError, /capture session/i)
    assert.equal(desktopError, webError, 'one host answer for both hosts')
    assert.equal(existsSync(join(root, 'server/utils/htmlVideoRender.ts')), false, 'the capture engine is deleted')
  })

  await check('the preview engine is a thin adapter consumer with no capability flags', async () => {
    const player = read('app/composables/useTmcutPreviewEngine.ts')
    assert.match(player, /useTmcutPlatform\(\)/, 'the preview engine is an adapter consumer')
    assert.match(player, /platform\.info\.name === 'electron'/, 'one host answer, not a second sniff')
    assert.match(player, /platform\.media\.resolveSrc\(src\)/, 'media resolution comes from the adapter')
    assert.doesNotMatch(player, /window\.electronAPI|useTmcutMedia\(\)/, 'no duplicate runtime detection')
    // Slice I deleted the proxy re-encode and the vidstab render on both hosts,
    // so advertising `proxyPreview`/`stabilize` capabilities would promise a
    // pipeline nothing can run. The engine is now kind + resolveSrc only.
    assert.doesNotMatch(player, /capabilities|proxyPreview|stabilize/,
      'the retired pipelines must not come back as capability flags')
  })

  await check('the export modal paints in-process and names the destination honestly', async () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.match(modal, /platform.info.name === 'electron'/, 'the host split is the negotiated answer')
    assert.match(modal, /createWebExportHost()/, 'the only writer is the in-process export host')
    assert.doesNotMatch(modal, /platform.encoder|platform.info.capabilities.nativeFFmpeg/,
      'neither a host encoder nor the retired capability is consulted')
    assert.doesNotMatch(modal, /enqueueJob|taskManager|useToolTaskManager|TmcutExportQueueModal/,
      'the desktop queue is gone')
  })

  console.log(`\n=== All ${passed} platform adapter checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
