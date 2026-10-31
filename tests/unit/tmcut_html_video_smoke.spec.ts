/**
 * Opt-in smoke test for the HTML/CSS video feature (run with `--smoke`).
 *
 * Two things the fast suite cannot prove, because both need the real machine:
 *
 *  1. Determinism — the renderer seeks one frame at a time and never plays the
 *     animation, so the same composition must encode to the same bytes. Three
 *     real renders are compared by md5 and size; a `Math.random`, a timer, or
 *     a font that resolves differently per run would break this.
 *  2. Routes — `/tmcut/html-video` and `/tmcut/voice` serve the SPA shell, and
 *     the render endpoint refuses an unauthenticated POST. The second half
 *     needs a running dev/prod server; when none answers the check reports
 *     SKIP instead of pretending to pass.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_html_video_smoke.spec.ts
 * Env: TMCUT_SMOKE_BASE_URL (default http://localhost:4002)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { HTML_VIDEO_STARTERS } from '../../app/utils/tmcut/htmlVideoStarters'
import { runHtmlVideoRender, newHtmlVideoOutputName, resolveChromeExecutable } from '../../server/utils/htmlVideoRender'
import { createJob, getJob } from '../../server/utils/renderJobs'
import { config } from '../../server/config/index'

let passed = 0

function check(label: string, fn: () => void): void {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function md5(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex')
}

const browser = resolveChromeExecutable()

async function renderOnce(starterId: string): Promise<{ id: string, file: string, size: number, duration: number }> {
  const starter = HTML_VIDEO_STARTERS.find(item => item.id === starterId)
  assert.ok(starter, `starter ${starterId} missing`)
  const id = `smoke-${Date.now().toString(36)}-${Math.round(process.hrtime()[1] / 1000)}`
  const outName = newHtmlVideoOutputName(`smoke-${starterId}`)
  createJob(id, starter.durationSec)
  await runHtmlVideoRender({
    jobId: id,
    html: starter.html,
    width: starter.width,
    height: starter.height,
    fps: starter.fps,
    durationSec: starter.durationSec,
    allowRemote: false,
    quality: 92,
    outName
  })
  const job = getJob(id)
  assert.ok(job, 'job vanished')
  assert.equal(job.status, 'done', `render failed: ${job.error}`)
  return { id, file: join(config.uploads.dir, outName), size: job.size, duration: job.durationSec }
}

async function routesHalf(): Promise<void> {
  const base = (process.env.TMCUT_SMOKE_BASE_URL || 'http://localhost:4002').replace(/\/$/, '')
  for (const route of ['/tmcut/html-video', '/tmcut/voice']) {
    let response: Response
    try {
      response = await fetch(base + route, { redirect: 'manual' })
    } catch {
      console.log(`   route ${route} SKIPPED (no server at ${base})`)
      return
    }
    check(`GET ${route} serves the app shell`, () => {
      assert.equal(response.status, 200, `status ${response.status}`)
      assert.match(response.headers.get('content-type') || '', /text\/html/)
    })
  }

  const unauthorized = await fetch(base + '/api/v1/media/html-video', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<div data-composition-id="x"></div>', width: 320, height: 320, fps: 30, durationSec: 1 })
  })
  check('POST /api/v1/media/html-video refuses anonymous callers', () => {
    assert.equal(unauthorized.status, 401)
  })
}

async function main(): Promise<void> {
  console.log(`HTML video smoke — chrome: ${browser ? 'found' : 'MISSING'}`)
  assert.ok(browser, 'no Chrome/Edge found; set TMCUT_CHROME_PATH')

  // 4 s × 30 fps is the shortest real starter, so the smoke stays affordable.
  const outputs: Awaited<ReturnType<typeof renderOnce>>[] = []
  try {
    for (let i = 0; i < 3; i += 1) outputs.push(await renderOnce('countdown'))
    const hashes = outputs.map(output => md5(readFileSync(output.file)))

    check('three renders of one composition exist on disk', () => {
      for (const output of outputs) assert.ok(existsSync(output.file), `${output.file} missing`)
    })
    check('three renders are byte-identical (md5)', () => {
      assert.equal(hashes[1], hashes[0])
      assert.equal(hashes[2], hashes[0])
    })
    check('three renders report the same size and duration', () => {
      assert.equal(outputs[1].size, outputs[0].size)
      assert.equal(outputs[2].size, outputs[0].size)
      for (const output of outputs) assert.equal(output.duration, 4)
    })
    console.log(`   md5 ${hashes[0]} · ${outputs[0].size} B · 4 s`)
  } finally {
    for (const output of outputs) await unlink(output.file).catch(() => {})
  }

  await routesHalf()
  console.log(`\nHTML video smoke: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
