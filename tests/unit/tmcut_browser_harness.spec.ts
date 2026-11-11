/**
 * The browser harness must not report success when it measured nothing.
 *
 * `tests/e2e/browser_media_integration.mts` bails out with `SKIP` and exit 0
 * when the fixture, the dev server or a browser is missing. That is right for a
 * developer laptop — the run had nothing to say, and failing would train people
 * to ignore the gate. It is wrong for CI, where a machine that cannot launch a
 * browser would keep the job green while proving nothing about decode.
 *
 * `TMCUT_BROWSER_REQUIRED=1` closes that hole: on a machine that is supposed to
 * have a browser, a skip becomes a failure. The default stays permissive, so
 * the local behaviour this repository already documents does not change.
 *
 * The two runs below use a dev-server URL nothing listens on, so neither needs
 * a browser and both finish in well under a second. That is deliberate: the
 * property under test is how the harness *reports a miss*, which is exactly the
 * path a browser-ful machine never exercises.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HARNESS = join(ROOT, 'tests', 'e2e', 'browser_media_integration.mts')
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
/** A port no dev server is listening on, so the harness bails before a browser is needed. */
const DEAD_URL = 'http://127.0.0.1:4599'

function runHarness(env: Record<string, string>): { status: number | null, stdout: string } {
  const res = spawnSync(process.execPath, [TSX, HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TMCUT_DEV_URL: DEAD_URL, ...env },
    timeout: 60_000
  })
  return { status: res.status, stdout: `${res.stdout || ''}${res.stderr || ''}` }
}

describe('the browser harness distinguishes a skip from a pass', () => {
  it('exits 0 and says SKIP when nothing requires a browser', () => {
    const { status, stdout } = runHarness({ TMCUT_BROWSER_REQUIRED: '' })
    assert.equal(status, 0, `an unrequired skip must not fail the run\n${stdout}`)
    assert.match(stdout, /^SKIP {2}browser media integration: no dev server/m,
      `the skip must name the reason it measured nothing:\n${stdout}`)
  })

  it('exits non-zero when TMCUT_BROWSER_REQUIRED=1 and the run measured nothing', () => {
    const { status, stdout } = runHarness({ TMCUT_BROWSER_REQUIRED: '1' })
    assert.notEqual(status, 0,
      `a required run that measured nothing must fail, not stay green\n${stdout}`)
    assert.match(stdout, /^SKIP {2}browser media integration: no dev server/m,
      `it should still say what was missing, not just fail:\n${stdout}`)
    assert.match(stdout, /TMCUT_BROWSER_REQUIRED/,
      `and it should name the switch that made the skip fatal:\n${stdout}`)
  })

  it('treats only an empty or 0 value as unset', () => {
    // A CI job that sets the variable to "true" or "1" must be obeyed; the
    // value is compared to '1' exactly, so this pins that '0' means off.
    const { status } = runHarness({ TMCUT_BROWSER_REQUIRED: '0' })
    assert.equal(status, 0, 'TMCUT_BROWSER_REQUIRED=0 must behave like unset')
  })
})
