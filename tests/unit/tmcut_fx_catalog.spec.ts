/**
 * R128 branch B — render-side transition catalog + shared xfade resolution.
 *
 * Pins the frozen 45-transition contract:
 *  (a) TRANSITION_CATALOG holds exactly 45 unique keys, well formed;
 *  (b) its key order is the frozen R128 list AND core KNOWN_TRANSITIONS
 *      (the anti-drift guard — do not weaken, do not reorder);
 *  (c) every `xfade` value is a documented FFmpeg xfade name, and — when a
 *      binary is present — exactly the set the bundled FFmpeg advertises;
 *  (d) xfadeNameFor maps the 6 legacy TMCut keys and never emits garbage;
 *  (e) transitionsByCategory() covers every entry exactly once.
 *
 * Plus the export-path guard: the legacy Electron controller
 * (electron/tools/ffmpeg.controller.cjs) keeps a CommonJS twin of
 * xfadeNameFor() because the packaged main process cannot require the
 * Nuxt/TS module. The twin is extracted from that file and asserted to
 * resolve identically, input for input, to the app catalog.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'
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

interface ControllerMirror {
  FXCATALOG_LEGACY_ALIASES: string[][]
  FFMPEG_XFADE_NAMES: string[]
  xfadeNameFor: (key?: unknown) => string
}

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `FFMPEG_XFADE_NAMES` is a hand-copy of what FFmpeg advertises, so nothing
 * stops it from drifting away from the binary that actually runs the graph —
 * and a name the binary does not know is not a warning: filter-init fails and
 * the whole export dies. `resources/ffmpeg.exe` is git-ignored, so a fresh
 * clone cannot answer this question; it says so instead of passing quietly.
 */
const ffmpeg = [
  process.env.TOOLS_FFMPEG_PATH,
  join(here, '..', '..', 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
].find(candidate => candidate && existsSync(candidate))

function advertisedXfadeNames(bin: string): string[] {
  const res = spawnSync(bin, ['-hide_banner', '-h', 'filter=xfade'], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg -h filter=xfade failed: ${res.stderr}`)
  // Help shape: five-space name, index, then the `..FV.......` capability column.
  return [...res.stdout.matchAll(/^ {5,}([a-z]+) {2,}-?\d+ {2,}\.\.FV/gm)].map(match => match[1])
}

/**
 * Evaluates the mirrored block from the Electron controller in this realm so
 * the CJS resolver can be driven like the TS one. The block is pure data +
 * one function and contains no requires, so it is safe to evaluate.
 */
function loadControllerMirror(): ControllerMirror {
  const source = readFileSync(join(here, '..', '..', 'electron', 'tools', 'ffmpeg.controller.cjs'), 'utf8')
  const begin = source.indexOf('// FXCATALOG-MIRROR-BEGIN')
  const end = source.indexOf('// FXCATALOG-MIRROR-END')
  assert.notEqual(begin, -1, 'controller mirror start marker is missing')
  assert.notEqual(end, -1, 'controller mirror end marker is missing')
  const block = source.slice(begin, end)
  return runInThisContext(
    `${block}\n;({ FXCATALOG_LEGACY_ALIASES, FFMPEG_XFADE_NAMES, xfadeNameFor })`
  ) as ControllerMirror
}

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

  if (ffmpeg) {
    check('the name list equals what the bundled binary advertises', () => {
      const advertised = [...new Set(advertisedXfadeNames(ffmpeg))].sort()
      assert.deepEqual(
        [...FFMPEG_XFADE_NAMES].sort(),
        advertised,
        `the catalog list and ${ffmpeg} disagree — a name the binary does not advertise fails the whole export`
      )
      assert.ok(advertised.length >= 50, `only ${advertised.length} names parsed: the help shape changed, the guard is reading nothing`)
      for (const entry of TRANSITION_CATALOG) {
        assert.ok(advertised.includes(entry.xfade), `${entry.key} -> ${entry.xfade} is not advertised by this binary`)
        assert.equal(entry.xfade === 'custom', false, 'custom needs an expr and cannot render as a bare name')
        assert.ok(advertised.includes(xfadeNameFor(entry.key)), `${entry.key} resolves to an unadvertised name`)
      }
    })
  } else {
    // Column 0, starting with the word: that is what `run-all.mts` classifies,
    // so the gate reports PARTIAL here instead of hiding inside a PASS.
    console.log('SKIP  the xfade-name gate: no FFmpeg binary (set TOOLS_FFMPEG_PATH) — names checked against the documented set only')
  }

  check('xfadeNameFor maps the 6 legacy keys and falls back safely', () => {
    for (const [key, xfade] of Object.entries(LEGACY_ALIASES)) {
      assert.equal(xfadeNameFor(key), xfade)
    }
    for (const entry of TRANSITION_CATALOG) {
      assert.equal(xfadeNameFor(entry.key), entry.xfade)
    }
    // Garbage / missing / unusable input can never reach FFmpeg.
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

  check('electron controller mirror resolves every input like the app catalog', () => {
    const mirror = loadControllerMirror()
    assert.deepEqual(mirror.FFMPEG_XFADE_NAMES, [...FFMPEG_XFADE_NAMES])
    assert.deepEqual(
      mirror.FXCATALOG_LEGACY_ALIASES,
      Object.entries(LEGACY_ALIASES)
    )
    const inputs: unknown[] = [
      ...FROZEN_TRANSITIONS,
      ...FFMPEG_XFADE_NAMES,
      'not-a-transition',
      'WIPE-LEFT',
      'fade ',
      '',
      undefined,
      null,
      42
    ]
    for (const input of inputs) {
      assert.equal(
        mirror.xfadeNameFor(input),
        xfadeNameFor(input as string | undefined),
        `export paths diverge for ${JSON.stringify(input)}`
      )
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
