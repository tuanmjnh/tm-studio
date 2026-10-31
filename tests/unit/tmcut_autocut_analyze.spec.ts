/**
 * AutoCut analysis transport (web-parity step 4).
 *
 * The two ffmpeg detection passes used to exist only behind Electron IPC, so
 * the whole AutoCut pipeline — with a source already uploaded to the local
 * server — stopped with "requires the desktop app". `resolveAnalyzer` now
 * falls back to POST /api/v1/media/analyze for `/uploads/` assets, and the
 * returned log goes through the SAME @tmcut/core parsers as the desktop path.
 *
 * These checks drive the real composable with a scripted transport, so they
 * prove the routing AND that a detection log actually becomes an EDL.
 */
import './helpers/tmcut_store_env'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const g = globalThis as Record<string, unknown>

// One real silencedetect/showinfo shape, trimmed to what the parsers read.
const SCENE_LOG = [
  'frame=    1 fps=0.0 q=-0.0 size=N/A time=00:00:00.04 bitrate=N/A speed=N/A',
  '[Parsed_showinfo_1 @ 0x1] n:   0 pts:    24 pts_time:0.8     pos:      0 fmt:yuv420p w:320 h:240',
  '[Parsed_showinfo_1 @ 0x2] n:   1 pts:    96 pts_time:3.2     pos:      0 fmt:yuv420p w:320 h:240'
].join('\n')
const SILENCE_LOG = [
  '[silencedetect @ 0x1] silence_start: 0.5',
  '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1',
  '[silencedetect @ 0x2] silence_start: 2.5',
  '[silencedetect @ 0x2] silence_end: 3.1 | silence_duration: 0.6'
].join('\n')

interface Call { url: string, body: Record<string, unknown> }

function harness(options: { electronIpc?: boolean } = {}) {
  const calls: Call[] = []
  const api = {
    tmcut: {
      analyzeScenes: async () => ({ ok: true, log: SCENE_LOG, durationSec: 5 }),
      analyzeSilence: async () => ({ ok: true, log: SILENCE_LOG, durationSec: 5 })
    }
  }
  g.window = options.electronIpc ? { electronAPI: api } : {}
  g.$fetch = async (url: string, opts: { body?: Record<string, unknown> } = {}) => {
    calls.push({ url, body: opts.body || {} })
    if (url === '/api/v1/media/analyze') {
      return opts.body?.kind === 'scenes'
        ? { ok: true, log: SCENE_LOG, durationSec: 5 }
        : { ok: true, log: SILENCE_LOG, durationSec: 5 }
    }
    // The AI relay probes: report "no key" so the transcript stays best-effort.
    return null
  }
  return {
    calls,
    // Only the analyzer calls — the pipeline also probes the AI relay.
    analyzed: () => calls.filter(call => call.url === '/api/v1/media/analyze').map(call => call.body)
  }
}

/** Enough of a TmcutAsset for the pipeline (it builds the EDL from id + path). */
function asset(path: string) {
  return {
    id: 'asset_test',
    name: 'clipA.mp4',
    path,
    kind: 'video',
    status: 'ready',
    meta: { durationSec: 5, width: 320, height: 240 }
  }
}

/** One composable instance: its error ref is per-call, so keep the handle. */
async function run(path: string) {
  const { useTmcutAutocut } = await import('../../app/composables/useTmcutAutocut')
  const autocut = useTmcutAutocut()
  return { analysis: await autocut.analyzeSource(asset(path) as never, 'viral-shorts'), autocut }
}

describe('AutoCut analysis transport', () => {
  it('the desktop runtime keeps using the main-process IPC passes', async () => {
    const h = harness({ electronIpc: true })
    const { analysis } = await run('C:/clips/clipA.mp4')
    assert.ok(analysis, 'the desktop pipeline must produce an EDL')
    assert.deepEqual(h.analyzed(), [], 'desktop must not post to the server analyzer')
  })

  it('the web runtime analyses an uploaded source on the local server', async () => {
    const h = harness()
    const { analysis } = await run('/uploads/mvsvua26-194abadb-clipA.mp4')
    assert.ok(analysis, 'the web pipeline must produce an EDL')
    assert.deepEqual(h.analyzed(), [
      { kind: 'scenes', src: '/uploads/mvsvua26-194abadb-clipA.mp4' },
      { kind: 'silence', src: '/uploads/mvsvua26-194abadb-clipA.mp4' }
    ])
    // Same parsers as desktop: the log becomes real shot boundaries.
    assert.equal(analysis!.sceneCount, 3, `two detected cuts must give three shots, got ${analysis!.sceneCount}`)
    assert.equal(analysis!.silenceCount, 2)
    assert.equal(analysis!.sourceDurationSec, 5)
    assert.ok(analysis!.edl.segments.length > 0, 'the EDL must hold segments')
  })

  it('a source the server cannot read still reports desktop-only', async () => {
    const h = harness()
    const { analysis, autocut } = await run('C:/clips/clipA.mp4')
    assert.equal(analysis, null)
    assert.deepEqual(h.analyzed(), [])
    assert.equal(autocut.analysisError.value, 'desktop-only')
  })

  it('a failed server pass surfaces the server error instead of an EDL', async () => {
    harness()
    g.$fetch = async () => ({ ok: false, error: 'Scene detection failed' })
    const { analysis, autocut } = await run('/uploads/gone.mp4')
    assert.equal(analysis, null)
    assert.equal(autocut.analysisError.value, 'Scene detection failed')
  })
})
