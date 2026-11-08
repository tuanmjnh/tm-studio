/**
 * R128 branch B — render-side transition catalog + shared xfade resolution.
 *
 * Pins the frozen 45-transition contract:
 *  (a) TRANSITION_CATALOG holds exactly 45 unique keys, well formed;
 *  (b) its key order is the frozen R128 list AND core KNOWN_TRANSITIONS
 *      (the anti-drift guard — do not weaken, do not reorder);
 *  (c) every `xfade` value is a name in the documented xfade set that core's
 *      preview registry draws (ADR-028);
 *  (d) xfadeNameFor maps the 6 legacy TMCut keys and never emits garbage;
 *  (e) transitionsByCategory() covers every entry exactly once.
 *
 * Plus the one-home guard: slice I deleted `electron/tools/ffmpeg.controller.cjs`,
 * which carried a CommonJS twin of xfadeNameFor() for the retired exporter. This
 * spec asserts the twin stays gone and that every input still resolves to a
 * listed name — with one exporter left, a second copy would be a second answer.
 *
 * The leg that compared the list against `ffmpeg -h filter=xfade` went with the
 * binary: no resolver reads `TOOLS_FFMPEG_PATH` any more, so it could only ever
 * print SKIP. `tmcut_runner_status` pins that no spec waits for it.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNOWN_TRANSITIONS } from 'tmcut-core'
import {
  FFMPEG_XFADE_NAMES,
  TRANSITION_CATEGORIES,
  TRANSITION_CATALOG,
  transitionLabel,
  transitionsByCategory,
  xfadeNameFor
} from '../../app/utils/tmcut/fxCatalog'

/**
 * The frozen R128 contract, duplicated here on purpose: the spec must be an
 * independent pin, not an echo of the table it checks.
 */
const FROZEN_TRANSITIONS = [
  'fade',
  'dissolve',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'zoom-in',
  'circleclose',
  'circlecrop',
  'circleopen',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'distance',
  'fadeblack',
  'fadegrays',
  'fadewhite',
  'hblur',
  'hlslice',
  'hrslice',
  'horzclose',
  'horzopen',
  'pixelize',
  'radial',
  'rectcrop',
  'slidedown',
  'slideright',
  'slideup',
  'smoothdown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'squeezeh',
  'squeezev',
  'vertclose',
  'vertopen',
  'vdslice',
  'vuslice',
  'wipebl',
  'wipebr',
  'wipedown',
  'wipetl',
  'wipetr',
  'wipeup',
  'zoomin'
]

/** Legacy TMCut key -> FFmpeg xfade name (fade/dissolve are identity). */
const LEGACY_ALIASES: Record<string, string> = {
  'fade': 'fade',
  'dissolve': 'dissolve',
  'wipe-left': 'wipeleft',
  'wipe-right': 'wiperight',
  'slide-left': 'slideleft',
  'zoom-in': 'zoomin'
}

const here = dirname(fileURLToPath(import.meta.url))

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function main() {
  console.log('=== [TMCut FX Catalog (R128 branch B) Test Suite] Starting tests ===\n')

  check('TRANSITION_CATALOG has exactly 45 well-formed entries with unique keys', () => {
    assert.equal(TRANSITION_CATALOG.length, 45)
    const keys = TRANSITION_CATALOG.map(entry => entry.key)
    assert.equal(new Set(keys).size, keys.length, 'duplicate catalog keys')
    for (const entry of TRANSITION_CATALOG) {
      assert.equal(typeof entry.key, 'string')
      assert.equal(typeof entry.xfade, 'string')
      assert.ok(entry.label.length > 0, `${entry.key} has no label`)
      assert.ok(
        TRANSITION_CATEGORIES.includes(entry.category),
        `${entry.key} has unknown category ${entry.category}`
      )
    }
  })

  check('catalog key order follows the frozen R128 transition list', () => {
    assert.deepEqual(TRANSITION_CATALOG.map(entry => entry.key), FROZEN_TRANSITIONS)
  })

  check('every catalog xfade value is a documented FFmpeg xfade name', () => {
    for (const entry of TRANSITION_CATALOG) {
      assert.ok(
        FFMPEG_XFADE_NAMES.includes(entry.xfade),
        `${entry.key} -> ${entry.xfade} is not a documented xfade name`
      )
    }
    // `custom` is documented but needs an expr, so it must never be emitted.
    assert.ok(FFMPEG_XFADE_NAMES.includes('custom'))
    assert.equal(TRANSITION_CATALOG.some(entry => entry.xfade === 'custom'), false)
  })

  check('xfadeNameFor maps the 6 legacy keys and falls back safely', () => {
    for (const [key, xfade] of Object.entries(LEGACY_ALIASES)) {
      assert.equal(xfadeNameFor(key), xfade)
    }
    for (const entry of TRANSITION_CATALOG) {
      assert.equal(xfadeNameFor(entry.key), entry.xfade)
    }
    // Garbage / missing / unusable input can never reach the preview registry.
    assert.equal(xfadeNameFor(undefined), 'fade')
    assert.equal(xfadeNameFor(''), 'fade')
    assert.equal(xfadeNameFor('not-a-transition'), 'fade')
    assert.equal(xfadeNameFor('../etc/passwd'), 'fade')
    assert.equal(xfadeNameFor('WIPE-LEFT'), 'fade')
    assert.equal(xfadeNameFor('custom'), 'fade')
    // A documented xfade name outside the catalog still passes through.
    assert.equal(xfadeNameFor('hlwind'), 'hlwind')
  })

  check('transitionLabel returns readable English labels', () => {
    assert.equal(transitionLabel('wipe-left'), 'Wipe Left')
    assert.equal(transitionLabel('fadeblack'), 'Fade to Black')
    assert.equal(transitionLabel('some-new-key'), 'Some New Key')
    assert.equal(transitionLabel(undefined), 'Fade')
    for (const entry of TRANSITION_CATALOG) {
      assert.equal(transitionLabel(entry.key), entry.label)
    }
  })

  check('transitionsByCategory covers every catalog entry exactly once', () => {
    const grouped = transitionsByCategory()
    assert.deepEqual(Object.keys(grouped).sort(), [...TRANSITION_CATEGORIES].sort())
    const flattened = TRANSITION_CATEGORIES.flatMap(category => grouped[category])
    assert.equal(flattened.length, TRANSITION_CATALOG.length)
    assert.deepEqual(
      flattened.map(entry => entry.key).sort(),
      TRANSITION_CATALOG.map(entry => entry.key).sort()
    )
    for (const category of TRANSITION_CATEGORIES) {
      for (const entry of grouped[category]) {
        assert.equal(entry.category, category)
      }
    }
  })

  check('the xfade name list has one home, and the deleted host copy stays gone', () => {
    // Slice I deleted `ffmpeg.controller.cjs`, which carried a mirrored copy of
    // this table so the retired exporter could resolve a legacy key. With one
    // exporter left, a second copy would be a second answer.
    assert.ok(!existsSync(join(here, '..', '..', 'electron', 'tools', 'ffmpeg.controller.cjs')),
      'the controller mirror must not come back')
    assert.deepEqual(
      Object.values(LEGACY_ALIASES).filter(name => !FFMPEG_XFADE_NAMES.includes(name)),
      [],
      'every legacy alias still names a listed transition'
    )
    for (const input of [...FROZEN_TRANSITIONS, ...FFMPEG_XFADE_NAMES, 'not-a-transition', 'WIPE-LEFT', '', undefined, null]) {
      const resolved = xfadeNameFor(input as string | undefined)
      assert.ok(FFMPEG_XFADE_NAMES.includes(resolved), `${JSON.stringify(input)} resolved to ${resolved}, which is not a listed name`)
    }
  })

  // Runs last on purpose: the anti-drift pin is only green once branch A has
  // expanded core KNOWN_TRANSITIONS to the frozen 45. Keep it strict.
  check('catalog key set matches core KNOWN_TRANSITIONS (anti-drift guard)', () => {
    assert.deepEqual(TRANSITION_CATALOG.map(entry => entry.key), [...KNOWN_TRANSITIONS])
  })

  console.log(`\n=== All ${passed} tests passed successfully! ===`)
}

main()
