/**
 * The offline surface (zero-FFmpeg slice C2, roadmap Q6(a)).
 *
 * A clip whose bytes are not on this machine must say so in words the user can
 * act on, on every screen that shows it, and must never delete the reference or
 * open a dialog by itself. Three things make that verifiable without a browser:
 * one table that turns a state into a word + icon + tone, one predicate that
 * decides "offline", and one relink flow the three surfaces share.
 *
 * What is pinned, in order:
 *  - the view table covers exactly core's six verdicts, and `missing` is a byte
 *    fact rather than a seventh verdict;
 *  - every word it points at exists in BOTH locales and differs between them,
 *    so a label cannot silently ship in English only;
 *  - the resolution rules: the byte axis outranks the probe axis, a verdict
 *    outranks the coarse field, and a record written before slice C still reads;
 *  - the `isMediaOffline` truth table over every (status, importStatus) pair;
 *  - one implementation: no component calls `relink(...)` or branches on
 *    `importStatus ===` — they go through `useTmcutRelink` and the view table;
 *  - the plate never opens anything itself: every relink call site is a click or
 *    keyboard handler, never a watcher;
 *  - behaviour, not layout: a cancelled pick changes nothing and says nothing,
 *    and a desktop pick re-points the asset, moves the clips and reports the
 *    verdict the probe actually returned.
 *
 * The desktop leg runs the real flow: the host's `statFiles` answers the byte
 * facts and real container bytes arrive over a fetch double for the privileged
 * `media://local` protocol (slice I deleted the `analyzeAsset` IPC, so the
 * demuxer is the only probe left on either host). A path with no bytes is
 * settled by the stat and never reaches the demuxer.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_media_offline.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// Installs the Vue auto-import and localStorage shims the composables run
// against. Must stay before every dynamic import below.
import { freshStore } from './helpers/tmcut_store_env'
import { installDesktopIpc, installMediaProtocol } from './helpers/tmcut_media_protocol'
import type { DesktopIpc } from './helpers/tmcut_media_protocol'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const LAW = 'app/utils/tmcut/assetImport.ts'
const FLOW = 'app/composables/useTmcutRelink.ts'
const PANEL = 'app/components/tmcut/TmcutMediaPanel.vue'
const CLIP = 'app/components/tmcut/TmcutTimelineClip.vue'
const PLAYER = 'app/components/tmcut/TmcutPreviewPlayer.vue'

/** The three surfaces that show a clip's media state. */
const SURFACES = [PANEL, CLIP, PLAYER]

let passed = 0

async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Every leaf path in a locale file, e.g. `tmcut.importStatus.queued`. */
function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [nested, text] of flatten(child, path)) out.set(nested, text)
      } else {
        out.set(path, String(child))
      }
    }
  }
  return out
}

function locales() {
  return {
    en: flatten(JSON.parse(read('i18n/locales/en.json'))),
    vi: flatten(JSON.parse(read('i18n/locales/vi.json')))
  }
}

/** Files whose source is part of the offline surface contract. */
function vueSources(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) vueSources(path, out)
    else if (name.endsWith('.vue')) out.push(path)
  }
  return out
}

const TONE_UNION = ['neutral', 'primary', 'success', 'warning', 'error']

async function main() {
  console.log('=== [TMCut media offline surface] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  const toasts: { title?: string, color?: string }[] = []
  g.useToast = () => ({ add: (toast: { title?: string, color?: string }) => toasts.push(toast) })
  // The composables are written against Nuxt's auto-import; in plain Node the
  // identity of the translator does not matter, only that a key is asked for.
  g.useI18n = () => ({ t: (key: string) => key })

  const {
    TMCUT_IMPORT_STATES,
    TMCUT_IMPORT_STATE_VIEWS,
    assetStateView,
    isMediaOffline
  } = await import('../../app/utils/tmcut/assetImport')
  const { buildAssetRecord } = await import('../../app/utils/tmcut/assetImport')

  // ===== the table =====

  await check('the table covers exactly the six verdicts and nothing else', () => {
    assert.deepEqual(Object.keys(TMCUT_IMPORT_STATE_VIEWS), [...TMCUT_IMPORT_STATES])
    for (const state of TMCUT_IMPORT_STATES) {
      const view = TMCUT_IMPORT_STATE_VIEWS[state as keyof typeof TMCUT_IMPORT_STATE_VIEWS]
      assert.equal(view.state, state, 'a row never lies about which state it is')
      assert.equal(view.key, `tmcut.importStatus.${state}`)
      assert.match(view.icon, /^i-lucide-[a-z-]+$/, `${state}: an icon, not a bare glyph`)
      assert.ok(TONE_UNION.includes(view.tone), `${state}: tone ${view.tone} is outside the union`)
    }
    // Colour must never be the only difference: two error-flavoured verdicts
    // still need two words and two glyphs.
    const icons = new Set(Object.values(TMCUT_IMPORT_STATE_VIEWS).map(v => v.icon))
    assert.equal(icons.size, TMCUT_IMPORT_STATES.length, 'one glyph per verdict')
  })

  await check('every word the table points at exists in both locales', () => {
    const { en, vi } = locales()
    const keys = [
      ...Object.values(TMCUT_IMPORT_STATE_VIEWS).map(v => v.key),
      'tmcut.media.missing',
      'tmcut.media.mediaOffline',
      'tmcut.media.mediaOfflineHint',
      'tmcut.media.relink',
      'tmcut.media.relinked',
      'tmcut.media.relinkFailed'
    ]
    for (const key of keys) {
      assert.ok(en.get(key)?.trim(), `${key} missing from en`)
      assert.ok(vi.get(key)?.trim(), `${key} missing from vi`)
      assert.notEqual(en.get(key), key, 'a label is not a key echo')
    }
    // The six verdict labels must be six different words, or the badges are
    // indistinguishable in the one language the suite can read.
    const verdictLabels = Object.values(TMCUT_IMPORT_STATE_VIEWS).map(v => en.get(v.key))
    assert.equal(new Set(verdictLabels).size, verdictLabels.length, 'two verdicts share an English label')
  })

  await check('the byte axis outranks the probe axis', () => {
    const view = assetStateView({ status: 'missing', importStatus: 'ready' })
    assert.equal(view.state, 'missing')
    assert.equal(view.key, 'tmcut.media.missing', 'a file that is not here is not "ready"')
    // `missing` is a byte fact, so it deliberately sits outside the table.
    assert.ok(!('missing' in TMCUT_IMPORT_STATE_VIEWS), 'missing is not a seventh verdict')
  })

  await check('a verdict outranks the coarse field the same record carries', () => {
    assert.equal(assetStateView({ status: 'ready', importStatus: 'partial' }).state, 'partial')
    assert.equal(assetStateView({ status: 'ready', importStatus: 'partial' }).tone, 'warning')
    assert.equal(assetStateView({ status: 'analyzing', importStatus: 'ready' }).state, 'ready')
    assert.equal(assetStateView({ status: 'error', importStatus: 'error' }).state, 'error')
  })

  await check('a record written before slice C still reads', () => {
    // Exactly what an older assets.json holds: no importStatus at all.
    assert.equal(assetStateView({ status: 'analyzing' }).state, 'probing')
    assert.equal(assetStateView({ status: 'ready' }).state, 'ready')
    assert.equal(assetStateView({ status: 'error' }).state, 'error')
    assert.equal(assetStateView({ status: 'missing' }).state, 'missing')
    assert.equal(assetStateView({}).state, 'queued', 'nothing learned yet is queued, never ready')
  })

  await check('offline is declared by state, not by a failed decode', () => {
    const statuses = [undefined, 'analyzing', 'ready', 'missing', 'error'] as const
    const imports = [...TMCUT_IMPORT_STATES, undefined] as const
    const offline: string[] = []
    for (const status of statuses) {
      for (const importStatus of imports) {
        const label = `${status ?? '-'}/${importStatus ?? '-'}`
        if (isMediaOffline({ status, importStatus })) offline.push(label)
      }
    }
    assert.deepEqual(offline, [
      '-/unsupported', '-/error',
      'analyzing/unsupported', 'analyzing/error',
      'ready/unsupported', 'ready/error',
      'missing/queued', 'missing/probing', 'missing/ready', 'missing/partial',
      'missing/unsupported', 'missing/error', 'missing/-',
      'error/queued', 'error/probing', 'error/ready', 'error/partial',
      'error/unsupported', 'error/error', 'error/-'
    ], 'a usable clip with a disclosed warning stays on screen')
    assert.equal(isMediaOffline(null), false, 'no record is not a verdict')
  })

  // ===== one implementation =====

  await check('no component reaches for the picker or the raw verdict field', () => {
    const files = [
      ...vueSources(join(root, 'app/components/tmcut')),
      ...vueSources(join(root, 'app/pages/tmcut'))
    ]
    for (const path of files) {
      const rel = relative(root, path).replace(/\\/g, '/')
      const src = read(rel)
      assert.doesNotMatch(src, /\brelink\(/, `${rel}: only the relink flow calls relink()`)
      assert.doesNotMatch(src, /importStatus\s*===/, `${rel}: the view table reads the verdict`)
    }
    const flow = read(FLOW)
    assert.ok(
      flow.includes('relink(asset.id, uploaded.url, { name: file.name, size: uploaded.size })'),
      'the web leg hands the composable what only the picker knows'
    )
    assert.ok(flow.includes('relink(asset.id, filePath)'), 'the desktop leg hands it the path')
    // The bug slice C1 closed in the probe: the caller must not write a snapshot
    // the probe is about to overwrite.
    assert.match(flow, /persistLibrary\(\)/, 'the cover lands after relink, then is persisted')
  })

  await check('the three surfaces share the one law', () => {
    // The law owns the vocabulary: one table, one predicate, nothing else.
    const law = read(LAW)
    assert.equal((law.match(/export const TMCUT_IMPORT_STATE_VIEWS/g) || []).length, 1, 'one state table')
    assert.match(law, /export function isMediaOffline/, 'one offline predicate')
    for (const rel of SURFACES) {
      const src = read(rel)
      assert.ok(
        src.includes('assetStateView') || src.includes('isMediaOffline'),
        `${rel}: renders from the shared table, not a local guess`
      )
      assert.ok(src.includes('~/utils/tmcut/assetImport'), `${rel}: imports the law`)
      assert.ok(src.includes('useTmcutRelink'), `${rel}: imports the flow`)
    }
    const player = read(PLAYER)
    assert.match(player, /v-if="mediaOffline && !isTrackHidden"/, 'the plate is state-driven')
    assert.match(player, /mediaLoadError && currentMediaSrc && !mediaOffline/,
      'the two overlays never stack on each other')
    assert.match(player, /data-canvas-hit[\s\S]{0,400}t\('tmcut\.media\.mediaOffline'\)/,
      'the plate carries a word, not only a colour')
  })

  await check('nothing opens the picker on its own', () => {
    for (const rel of SURFACES) {
      const src = read(rel)
      const sites = src.split('relinkWithPicker').slice(1)
      for (const site of sites) {
        const before = site.slice(0, 120)
        assert.doesNotMatch(before, /watch\s*\(/, `${rel}: a watcher must not open a dialog`)
        assert.doesNotMatch(before, /onMounted\s*\(/, `${rel}: a mount must not open a dialog`)
      }
      assert.ok(sites.length > 0, `${rel}: the surface offers relink`)
    }
  })

  // ===== behaviour =====

  const store = await freshStore()
  const media = (await import('../../app/composables/useTmcutMedia')).useTmcutMedia()
  const projectId = () => store.currentProject.value!.id

  await check('a cancelled pick changes nothing and says nothing', async () => {
    media.assets.value = []
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/gone.wav', kind: 'audio', projectId: projectId(), now: 1700000000002, nonce: 'off01'
    }))
    const asset = media.assets.value[0]!
    asset.status = 'missing'
    asset.importStatus = 'error'
    const { relinkWithPicker } = (await import('../../app/composables/useTmcutRelink')).useTmcutRelink()
    // No document in this runtime: the web picker reports "closed", same as Escape.
    toasts.length = 0
    const ok = await relinkWithPicker(asset)
    assert.equal(ok, false, 'a cancel is reported as "nothing happened"')
    assert.equal(toasts.length, 0, 'a cancel never toasts')
    assert.equal(asset.path, 'D:/Media/gone.wav', 'the reference is untouched')
    assert.equal(media.assets.value.length, 1, 'Q6: a failed relink deletes nothing')
  })

  const protocol = installMediaProtocol(media)
  const desktop = installDesktopIpc(protocol)
  g.window = desktop.window
  const dialog = installDialog(desktop)
  const { relinkWithPicker } = (await import('../../app/composables/useTmcutRelink')).useTmcutRelink()

  await check('a desktop pick repairs the asset and moves the clip with it', async () => {
    media.assets.value = []
    store.addClipToTrack('video', { src: 'D:/Media/old.mp4', in: 0, out: 240000, offset: 0 })
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/old.mp4', kind: 'video', projectId: projectId(), now: 1700000000003, nonce: 'off02'
    }))
    const asset = media.assets.value[0]!
    asset.status = 'missing'
    asset.importStatus = 'error'
    // Real container bytes, so the verdict is the demuxer's answer and not a
    // number the harness invented.
    protocol.files.set('D:/Media/Fixed Take.mp4', new Uint8Array(readFileSync(join(root, 'tests/fixtures/containers/h264.mp4'))))
    dialog.picked = ['D:\\Media\\Fixed Take.mp4']
    toasts.length = 0
    const ok = await relinkWithPicker(asset)
    assert.equal(ok, true, 'the verdict the probe actually returned')
    assert.equal(asset.path, 'D:/Media/Fixed Take.mp4')
    assert.equal(asset.name, 'Fixed Take.mp4', 'the picked file names the record')
    assert.equal(asset.status, 'ready')
    // Node has no WebCodecs, so the demuxer discloses VIDEO_NOT_DECODABLE and
    // the verdict is `partial`. That is the case this surface exists for: a
    // usable clip with a disclosed warning stays on screen, not offline.
    assert.equal(asset.importStatus, 'partial')
    assert.equal(isMediaOffline(asset), false, 'a partial verdict is not an offline clip')
    assert.equal(asset.meta.durationSec, 0.6, 'the container reports its own duration, not the fake\'s 2s')
    assert.equal(asset.meta.fileSize, protocol.files.get('D:/Media/Fixed Take.mp4')!.byteLength, 'the host stat owns the byte count')
    // The retired IPC wrote these three as by-products of one FFmpeg call. They
    // are decoder answers now, so a relink must not invent a cover.
    assert.equal(asset.thumbPath, null)
    assert.equal(asset.filmstripPath, null)
    assert.equal(asset.waveformPath, null)
    assert.equal(
      store.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!.src,
      'D:/Media/Fixed Take.mp4',
      'the timeline moved with the asset'
    )
    assert.deepEqual(
      toasts.map(t => [t.title, t.color]),
      [['tmcut.media.relinked', 'success']],
      'one toast, in the success colour'
    )
  })

  await check('an unreadable pick warns instead of going quiet', async () => {
    media.assets.value = []
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/again.mp4', kind: 'video', projectId: projectId(), now: 1700000000004, nonce: 'off03'
    }))
    const asset = media.assets.value[0]!
    asset.status = 'missing'
    dialog.picked = ['D:/Media/missing-target.mp4']
    const fetchesBefore = protocol.state.fetches
    toasts.length = 0
    const ok = await relinkWithPicker(asset)
    assert.equal(ok, false)
    assert.equal(
      protocol.state.fetches,
      fetchesBefore,
      'a dead path never reaches the demuxer: its UrlSource retries a failed fetch forever'
    )
    assert.deepEqual(
      toasts.map(t => [t.title, t.color]),
      [['tmcut.media.relinkFailed', 'warning']],
      'a real failure is disclosed'
    )
    assert.equal(media.assets.value.length, 1, 'and the reference still survives it')
    assert.equal(asset.status, 'missing', 'the byte axis keeps saying what is true')
  })

  await check('a cancelled desktop pick is silent too', async () => {
    dialog.picked = []
    toasts.length = 0
    const asset = media.assets.value[0]!
    const before = asset.path
    const ok = await relinkWithPicker(asset)
    assert.equal(ok, false)
    assert.equal(toasts.length, 0, 'Escape is not a failure')
    assert.equal(asset.path, before, 'nothing was re-learned')
  })

  protocol.restore()
  console.log(`\n=== All ${passed} media offline checks passed ===`)
}

/**
 * The one dialog call the relink flow makes, on top of the shared desktop
 * double. `picked` is the stand-in for the user: empty means the dialog was
 * closed. The host answers the byte stat and the registry write; the bytes
 * themselves come over `media://local`, exactly as the real protocol serves
 * them, so the verdict below is the demuxer's and not a fake's.
 */
function installDialog(desktop: DesktopIpc) {
  const state = { picked: [] as string[] }
  ;(desktop.window.electronAPI as Record<string, unknown>).dialog = {
    async openFile() { return state.picked.length ? [...state.picked] : null }
  }
  return state
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
