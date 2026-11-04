/**
 * AutoCut detection wiring (zero-FFmpeg slice E4).
 *
 * "Web-parity step 4" gave the web runtime an analyzer by posting the source to
 * the server's FFmpeg pass; the desktop runtime already had the same filters
 * behind IPC. Slice E4 retires both: AutoCut now asks the decoder this renderer
 * already runs for thumbnails, and `tmcut-core` decides what it saw.
 *
 * What these checks pin:
 *  - the composable builds its detector from the two real seams, and nothing in
 *    `app/` asks a server or the main process to analyze a clip any more;
 *  - a runtime that cannot decode says so. The old code answered "this needs the
 *    desktop app" for a file the browser could read perfectly well, and said
 *    nothing at all about a file neither host can read;
 *  - a source the engine cannot open is a failure, not an empty draft;
 *  - the scan hands the UI a cancel.
 *
 * The real decode of a real file is measured in Chromium (docs §26), because
 * plain Node has no WebCodecs — the same split `tmcut_frame_service.spec.ts` uses.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_autocut_analyze.spec.ts
 */
import './helpers/tmcut_store_env'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function walkApp(dir: string, prefix = 'app'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...walkApp(full, rel))
    else if (/\.(ts|vue)$/.test(entry)) out.push(rel)
  }
  return out
}

const g = globalThis as Record<string, unknown>
if (!g.window) g.window = {}

/** Enough of a TmcutAsset for the pipeline (it builds the EDL from id + path). */
function asset(path: string) {
  return {
    id: 'asset_test',
    name: 'clipA.mp4',
    path,
    kind: 'video',
    status: 'ready',
    fingerprint: 'f4ce01f4',
    meta: { durationSec: 5, width: 320, height: 240 }
  }
}

async function main() {
  console.log('=== [TMCut autocut analyze wiring] Starting ===\n')

  const calls: string[] = []
  g.$fetch = async (url: string) => {
    calls.push(String(url))
    // The AI relay probe: no key, so the transcript stays best-effort.
    return null
  }

  await check('the composable builds one detector from the two seams', () => {
    const composable = read('app/composables/useTmcutAutocut.ts')
    assert.match(composable, /readGrids: decodeLumaSeries/, 'pixels come from the frame seam')
    assert.match(composable, /readPcm: decodePcm/, 'sound comes from the audio seam')
    assert.match(composable, /canDecodeVideo: hasFrameDecoder/,
      'and the host answers for itself instead of the path being guessed at')
    const analyzers = walkApp(join(root, 'app')).filter(file => /media\/analyze/.test(read(file)))
    assert.deepEqual(analyzers, [], 'no page, composable or util asks a server to analyze a clip')
  })

  await check('a runtime with no video decoder says so instead of inventing a draft', async () => {
    delete g.VideoDecoder
    const { useTmcutAutocut } = await import('../../app/composables/useTmcutAutocut')
    const autocut = useTmcutAutocut()
    const analysis = await autocut.analyzeSource(asset('/uploads/mvsvua26-clipA.mp4') as never, 'viral-shorts')
    assert.equal(analysis, null)
    assert.equal(autocut.analysisError.value, 'no-decoder')
    assert.deepEqual(calls.filter(url => /analyze/.test(url)), [], 'nothing was posted anywhere')
  })

  await check('a source the engine cannot open is a failure, not an empty EDL', async () => {
    // The decoder is faked only to answer "this host can decode"; the source is
    // then the thing that fails. Plain Node must never let Mediabunny open a
    // real `UrlSource` — it retries an unparseable relative URL forever — so the
    // refusal happens on the detector's own input gate, before a seam is touched.
    g.VideoDecoder = class FakeVideoDecoder {
      queueSize = 0
    }
    try {
      const { useTmcutAutocut } = await import('../../app/composables/useTmcutAutocut')
      const autocut = useTmcutAutocut()
      const probe = asset('/uploads/gone.mp4') as Record<string, unknown>
      delete probe.meta
      const analysis = await autocut.analyzeSource(probe as never, 'viral-shorts')
      assert.equal(analysis, null, 'an unreadable file must not hand back a draft of nothing')
      const error = String(autocut.analysisError.value || '')
      assert.notEqual(error, 'desktop-only', 'that sentence retired with the FFmpeg passes')
      assert.notEqual(error, 'no-decoder', 'this host can decode, so the file is the problem')
      assert.equal(error, 'no-video')
      assert.deepEqual(calls.filter(url => /analyze/.test(url)), [], 'and no server pass was asked to cover for it')
    } finally {
      delete g.VideoDecoder
    }
  })

  await check('the scan hands the UI a cancel', async () => {
    const { useTmcutAutocut } = await import('../../app/composables/useTmcutAutocut')
    const autocut = useTmcutAutocut()
    assert.equal(typeof autocut.cancel, 'function', 'a long walk must be stoppable')
    autocut.cancel()
    assert.equal(autocut.analyzing.value, false, 'cancelling with nothing running is harmless')
    const analysis = await autocut.analyzeSource(asset('/uploads/clipA.mp4') as never, 'viral-shorts')
    assert.equal(analysis, null, 'the next scan starts clean, not pre-cancelled')
    assert.equal(autocut.analysisError.value, 'no-decoder')
  })

  console.log(`\n=== [TMCut autocut analyze wiring] ${passed} passed ===`)
}

main().catch((error) => {
  console.error('AUTOCUT ANALYZE WIRING SPEC FAILED:', error)
  process.exit(1)
})
