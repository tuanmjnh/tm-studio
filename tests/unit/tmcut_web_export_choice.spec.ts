/**
 * The dialog's choices, and which of them a browser export can honour.
 *
 * The modal offers a size, a frame rate, a format, a mode tab, an in/out range,
 * denoise and a LUT. A WebCodecs run can honour exactly two of those — size and
 * rate, because `planEncodeContent` reads the canvas and `createFrameScheduler`
 * builds its grid from the same numbers. Everything else has to be REFUSED BY
 * NAME before a decoder opens, because the alternative is a control that is
 * silently ignored: the user picks 9:16 and gets 16:9, or asks for HEVC and
 * receives H.264 from the fallback ladder, and the app never says so.
 *
 * The codes are not core's `ENCODE_REFUSAL_REASONS`. Those name things a project
 * has (a mask, a blend, a transition) and core answers them alone. These name
 * things a DIALOG has, which only the app knows exist.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_web_export_choice.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFrameScheduler, planEncodeContent, fpsToRational, ENCODE_REFUSAL_REASONS } from 'tmcut-core'
import { planWebExport } from '../../app/utils/tmcut/webExportChoice'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const TICKS = 120_000

function projectOf(width = 1920, height = 1080) {
  return {
    id: 'p1',
    name: 'a project',
    version: 3,
    canvas: { width, height, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#101820' } },
    tracks: [{
      id: 'row-v',
      type: 'video',
      items: [{
        id: 'v1',
        type: 'video',
        src: 'C:/media/v.mp4',
        source: { in: 0, out: 2 * TICKS },
        timeline: { start: 0, duration: 2 * TICKS },
        speed: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        effects: [],
        keyframes: []
      }]
    }]
  }
}

/** Every dialog default, so one field can be varied per check. */
function choice(overrides: Record<string, unknown> = {}) {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    mode: 'video',
    format: 'mp4-h264',
    range: null,
    denoise: false,
    lut: null,
    ...overrides
  }
}

function main() {
  console.log('=== [TMCut web export choice] Starting ===\n')

  check('the defaults are honourable, so a plain export refuses nothing', () => {
    const plan = planWebExport(projectOf(), choice() as never)
    assert.deepEqual(plan.refusals, [])
  })

  check('the chosen size and rate reach the project core will encode', () => {
    const plan = planWebExport(projectOf(), choice({ width: 1080, height: 1920, fps: 24 }) as never)
    assert.equal(plan.project.canvas?.width, 1080)
    assert.equal(plan.project.canvas?.height, 1920)
    assert.deepEqual(plan.project.canvas?.fps, fpsToRational(24))
  })

  check('the preview project is untouched — an export resizes nothing on disk', () => {
    const project = projectOf()
    planWebExport(project, choice({ width: 640, height: 360 }) as never)
    assert.equal(project.canvas.width, 1920, 'the authored canvas still says 1920')
    assert.equal(project.canvas.height, 1080)
  })

  check('a mode or format this writer cannot produce is refused by name', () => {
    assert.deepEqual(planWebExport(projectOf(), choice({ mode: 'audio' }) as never).refusals, ['mode'])
    assert.deepEqual(planWebExport(projectOf(), choice({ mode: 'gif' }) as never).refusals, ['mode'])
    for (const format of ['mp4-h265', 'mov-prores', 'webm-vp9']) {
      assert.deepEqual(planWebExport(projectOf(), choice({ format }) as never).refusals, ['format'],
        `${format} cannot be promised by the ladder`)
    }
  })

  check('an in/out range and the grade controls are refused, not silently dropped', () => {
    const ranged = planWebExport(projectOf(), choice({ range: { in: 0, out: TICKS } }) as never)
    assert.deepEqual(ranged.refusals, ['range'])
    const graded = planWebExport(projectOf(), choice({ denoise: true }) as never)
    assert.deepEqual(graded.refusals, ['effects'])
    const lut = planWebExport(projectOf(), choice({ lut: 'D:/a.cube' }) as never)
    assert.deepEqual(lut.refusals, ['effects'])
  })

  check('two refusals are both named, in a stable order', () => {
    const plan = planWebExport(projectOf(), choice({ mode: 'gif', format: 'webm-vp9', range: { in: 0, out: 1 } }) as never)
    assert.deepEqual(plan.refusals, ['mode', 'format', 'range'])
  })

  check('the plan the modal builds is the one core encodes and schedules', () => {
    const plan = planWebExport(projectOf(), choice({ width: 1080, height: 1920, fps: 25 }) as never)
    const content = planEncodeContent(plan.project as never)
    assert.equal(content.kind, 'eligible', 'a resized project is still eligible')
    const scheduler = createFrameScheduler(plan.project, { rate: fpsToRational(25) })
    assert.equal(content.totalFrames, scheduler.frameCount,
      'the frame count the modal shows is core\'s own')
    assert.equal(content.request?.width, 1080)
  })

  check('this module owns no decoder and no encoder', () => {
    const source = read('app/utils/tmcut/webExportChoice.ts')
    assert.doesNotMatch(source, /mediabunny|CanvasSink|VideoDecoder|VideoEncoder/, 'a plan names no platform type')
    assert.match(source, /planEncodeContent|createFrameScheduler|fpsToRational/, 'the numbers come from core')
  })

  check('the modal hands the plan\'s project to the host, and names every refusal', () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.match(modal, /planWebExport\(/, 'the dialog\'s choices are planned, not passed through')
    assert.match(modal, /project: plan\.project/, 'and the planned project is what gets encoded')
    assert.match(modal, /plan\.refusals\.length > 0/, 'a refused choice stops before the host opens anything')
    for (const code of ['mode', 'format', 'range', 'effects']) {
      assert.match(modal, new RegExp(`${code}: 'tmcut\\.export\\.webRefuse`), `${code} has a sentence of its own`)
    }
    // The host is created after the refusal check: a refused export must not
    // build a reader, a mixer or a canvas.
    const planAt = modal.indexOf('planWebExport(')
    const hostAt = modal.indexOf('createWebExportHost()', planAt)
    assert.ok(planAt > 0 && hostAt > planAt, 'the host is built after the plan was accepted')
  })

  // The live sweep caught this by hand: an exported project with a vignette
  // showed the toast "effects", which is core's vocabulary, not a sentence.
  check('every reason core can refuse is explained, and none is left as a bare code', () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    const explain = modal.match(/const WEB_CONTENT_REFUSAL_KEYS[\s\S]*?\n}/)?.[0] ?? ''
    assert.ok(explain.length > 0, 'the modal maps core\'s reasons to sentences')
    for (const reason of ENCODE_REFUSAL_REASONS) {
      assert.match(explain, new RegExp(`'?${reason}'?:`), `${reason} is explained`)
    }
    assert.match(modal, /WEB_CONTENT_REFUSAL_KEYS\[/, 'and the mapping is what the refusal path reads')
  })

  console.log(`\n=== All ${passed} web-export-choice checks passed ===`)
}

try {
  main()
} catch (error) {
  console.error('\nFAILED:', error)
  process.exit(1)
}
