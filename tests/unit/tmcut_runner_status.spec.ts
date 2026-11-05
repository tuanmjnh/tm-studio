/**
 * The runner must not call a skipped gate a pass (slice F8, roadmap "Có visual
 * regression fixtures" / exit criterion "Preview và export dùng cùng
 * evaluator").
 *
 * Measured before this slice: `run-all.mts` decided PASS from `res.status === 0`
 * alone. Four pixel specs (`tmcut_render_parity`, `tmcut_text_pixel`,
 * `tmcut_golden_frame`, `tmcut_export_paint_stack`) already print a `SKIP` line
 * when no FFmpeg binary is on the box, exit 0, and the runner printed
 * `PASS tmcut_render_parity.spec.ts` with an empty tail. On a host without
 * FFmpeg the suite would say "119/119 specs passed" having compared zero
 * pixels — the exact report this queue is built on.
 *
 * The distinction that matters is not skip/no-skip, it is *how much* ran:
 *  - SKIP     — the spec bailed; nothing of it was measured.
 *  - PARTIAL  — the spec ran and finished its checks, but one gate inside it
 *              was skipped (the paint-stack spec's graph checks still run).
 *  - PASS     — everything the spec can measure on this host was measured.
 * Only PASS counts as passed. FAIL outranks everything, including a SKIP line:
 * a spec that skips and then fails is a failure, not a skip.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_runner_status.spec.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARTIAL, SKIP, specStatus, summarize } from './helpers/spec_status'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = (rel: string) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8')

let failures = 0
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`   ${name} PASSED`)
  } catch (error) {
    failures++
    console.error(`\nFAILED: ${name}\n`, error)
  }
}

async function main(): Promise<void> {
  console.log('=== [TMCut runner status] Starting ===\n')

  await check('a spec that finishes without skipping is a PASS', () => {
    assert.equal(specStatus(0, '=== All 6 checks passed ==='), 'PASS')
  })

  await check('a spec that bails on a missing binary is a SKIP, not a PASS', () => {
    const out = 'SKIP  render parity: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)\n'
    assert.equal(specStatus(0, out), SKIP, 'a whole-spec skip must never read as a pass')
  })

  await check('a spec that skips one gate but finishes is PARTIAL', () => {
    const out = [
      'PASS  graph checks',
      '\nSKIP  the pixel gate: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)',
      '=== All 10 checks passed ==='
    ].join('\n')
    assert.equal(specStatus(0, out), PARTIAL, 'nine checks ran, the pixel one did not')
  })

  await check('a non-zero exit outranks a SKIP line', () => {
    const out = 'SKIP  the pixel gate: no FFmpeg binary\nFAILED: AssertionError\n'
    assert.equal(specStatus(1, out), 'FAIL')
    assert.equal(specStatus(null, out), 'FAIL', 'a killed process is a failure')
  })

  await check('the summary counts skips instead of hiding them', () => {
    const line = summarize({ passed: 117, skipped: 1, partial: 1, failed: 0, total: 119 })
    assert.equal(line.indexOf('117/119'), 0, `only real passes may lead: ${line}`)
    assert.match(line, /1 spec skipped/, `the skip must be named: ${line}`)
    assert.match(line, /1 spec partial/, `the partial must be named: ${line}`)
    assert.equal(
      summarize({ passed: 119, skipped: 0, partial: 0, failed: 0, total: 119 }),
      '119/119 specs passed')
  })

  await check('the runner reads status from the helper, not from exit code alone', () => {
    const runner = source('tests/unit/run-all.mts')
    assert.match(runner, /from '\.\/helpers\/spec_status'/, 'the runner still decides status inline')
    assert.match(runner, /specStatus\(/, 'the runner still maps exit code straight to PASS')
    assert.doesNotMatch(runner, /const ok = res\.status === 0/, 'the old one-line decision is back')
  })

  await check('every FFmpeg gate announces its skip out loud', () => {
    // The complete set of specs that can bail on a missing binary or a missing
    // system font. A gate that skips in silence is a PASS the suite did not earn.
    for (const spec of [
      'tmcut_render_parity',
      'tmcut_text_pixel',
      'tmcut_golden_frame',
      'tmcut_export_paint_stack',
      'tmcut_preview_export_pixel_parity',
      'tmcut_export_gap_placement',
      'tmcut_svg_still',
      'tmcut_transition_preview',
      'tmcut_fx_catalog'
    ]) {
      // The line must START with the word (after any leading newline), which is
      // exactly what `specStatus` keys on.
      assert.match(
        source(`tests/unit/${spec}.spec.ts`),
        /console\.log\(['"`](?:\\n)?SKIP/,
        `${spec} no longer prints the line the runner classifies`)
    }
  })

  if (failures > 0) {
    console.error(`\n${failures} runner-status check(s) failed`)
    process.exit(1)
  }
  console.log('\n=== All 6 runner-status checks passed ===')
}

void main()
