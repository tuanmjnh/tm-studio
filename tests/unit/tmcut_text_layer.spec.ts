/**
 * The text overlay paints from core's plan (Zero-FFmpeg slice F, requirement 2/3).
 *
 * Footage rows got this in F2b/F4b: every number the DOM applies to a row comes
 * from the layer core evaluated at this tick. The text path was left behind —
 * `activeTextClips` walked the plan's slots, took the authored clip and threw
 * `slot.layer` away, so the player re-ran `evalKeyframe` and `textAnimationAt`
 * on its own. That is a third answer to "where is this caption and how opaque is
 * it", and it is the one the export does not read.
 *
 * Two things had to change for the plan to be able to answer at all:
 * `textOf` carried no `shadowColor` / `strokeColor` / `bgColor` (check 1), and the
 * composable discarded the layer it already had (check 3).
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_text_layer.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateTimeline } from 'tmcut-core'
import { freshStore, TICKS } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function tk(sec: number): number {
  return Math.round(sec * TICKS)
}

/**
 * One caption with every optional text colour set. The colours go through
 * `updateClip`, the way the Inspector authors them: `addClipToTrack` builds a
 * fixed field list and does not carry the text effect colours (check 1 would
 * otherwise be testing the store's whitelist, not the layer).
 */
async function captionStore() {
  const s = await freshStore()
  s.addClipToTrack('text', { id: 'cap-1', text: 'ONE', offset: 0, in: 0, out: tk(2), color: '#ff0000', fontSize: 48 })
  s.updateClip('cap-1', {
    shadow: true,
    shadowColor: '#112233',
    stroke: true,
    strokeColor: '#223344',
    bgColor: '#334455'
  })
  return s
}

function source(file: string): string {
  return readFileSync(join(root, file), 'utf8')
}

/** The body of one top-level function, so a pin cannot be satisfied elsewhere. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is gone from the source`)
  // CRLF-safe: the closing brace of a top-level function sits in column 0.
  const tail = /\r?\n\}\r?\n/.exec(src.slice(start))
  assert.ok(tail, `${name} has no top-level end`)
  return src.slice(start, start + tail!.index)
}

async function main() {
  console.log('=== [TMCut text layer] Starting ===\n')

  await check('core answers the text colours the export already honors', async () => {
    const s = await captionStore()
    const frame = evaluateTimeline(s.currentProject.value, tk(1))
    const text = frame.layers.find(layer => layer.clipId === 'cap-1')?.text
    assert.ok(text, 'the caption is live at 1 s')
    assert.equal(text.color, '#ff0000', 'the fill colour was already on the layer')
    assert.equal(text.shadowColor, '#112233', 'shadow colour travels with the layer')
    assert.equal(text.strokeColor, '#223344', 'border colour travels with the layer')
    assert.equal(text.bgColor, '#334455', 'the box colour travels with the layer')
  })

  await check('an absent text colour stays null, never an invented default', async () => {
    const s = await freshStore()
    s.addClipToTrack('text', { id: 'cap-2', text: 'TWO', offset: 0, in: 0, out: tk(2) })
    const text = evaluateTimeline(s.currentProject.value, tk(1)).layers[0]?.text
    assert.equal(text?.shadowColor, null, 'no shadow colour authored')
    assert.equal(text?.strokeColor, null, 'no border colour authored')
    assert.equal(text?.bgColor, null, 'no box authored — the DOM must not paint one')
  })

  await check('the composable hands the DOM the plan layer, not a re-read clip', async () => {
    await captionStore()
    const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
    const p = useTmcutPlayback()
    p.seek(1)
    const surfaces = p.activeTextSurfaces.value
    assert.equal(surfaces.length, 1, 'one caption is live at 1 s')
    const surface = surfaces[0]
    assert.equal(surface?.clip.id, 'cap-1', 'the authored clip still comes along for editing')
    assert.equal(surface?.layer.clipId, 'cap-1', 'and so does the layer core evaluated')
    assert.equal(surface?.layer.text?.content, 'ONE', 'the painted text is the layer text')
    assert.equal(surface?.layer.text?.shadowColor, '#112233',
      'the colour the plate shows is core’s answer, not a clip read')
  })

  await check('a keyframed move reaches the surface through the layer', async () => {
    const s = await freshStore()
    s.addClipToTrack('text', {
      id: 'cap-k',
      text: 'K',
      offset: 0,
      in: 0,
      out: tk(2),
      x: 10,
      keyframes: [
        { t: tk(1), prop: 'x', value: 250 },
        { t: tk(1), prop: 'opacity', value: 50 }
      ]
    })
    const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
    const p = useTmcutPlayback()
    p.seek(1)
    const layer = p.activeTextSurfaces.value[0]?.layer
    assert.equal(layer?.transform.x, 250, 'core resolved the keyframe, the DOM only applies it')
    assert.equal(layer?.opacity, 0.5, 'opacity arrives 0..1 from core')
  })

  await check('the player styles a text surface from its layer', async () => {
    const player = source('app/components/tmcut/TmcutPreviewPlayer.vue')
    const body = functionBody(player, 'textOverlayStyle')
    assert.match(body, /const layer = surface\.layer/, 'the numbers come off the plan layer')
    assert.match(body, /const text = layer\.text/, 'the text flags come off the layer too')
    assert.doesNotMatch(body, /surface\.clip\./, 'the authored clip is not re-read for style')
    assert.match(body, /layer\.transform/, 'position and scale read the layer transform')
    assert.doesNotMatch(body, /evalKeyframe\(/, 'no second keyframe reading in the text path')
    assert.doesNotMatch(body, /textAnimationAt\(/, 'no second animation curve in the text path')
    assert.doesNotMatch(body, /clipDurationTicks\(/, 'no second span math in the text path')
  })

  await check('the overlay loop iterates surfaces, and the old clip list is retired', async () => {
    const player = source('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.match(player, /v-for="surface in activeTextSurfaces"/, 'the DOM binds the plan surfaces')
    assert.match(player, /surface\.layer\.text\?\.content/, 'the painted string is the layer content')
    assert.doesNotMatch(player, /activeTextClips/, 'the clip-only accessor is gone from the player')
    const playback = source('app/composables/useTmcutPlayback.ts')
    assert.doesNotMatch(playback, /activeTextClips/, 'and gone from the composable')
  })

  console.log(`\n=== All ${passed} text-layer checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
