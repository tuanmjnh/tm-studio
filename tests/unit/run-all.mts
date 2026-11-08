/**
 * Unit spec runner — every tests/unit/{tmcut,docs}_*.spec.ts in one command
 * (`pnpm test`). Each spec is a standalone script (they install
 * global shims and import the store as a module-level singleton, so one
 * process per spec keeps them independent). Every spec runs; the exit code is
 * non-zero if any of them FAILED.
 *
 * There is no opt-in smoke mode any more: slice I deleted the FFmpeg binary, the
 * render graph compiler and the server's HTML-video renderer, so the three specs
 * that mode ran could only crash at import. Real-media measurement now lives in
 * the browser gates (WebCodecs encode, decoder frames), not in a spawned binary.
 *
 * Status comes from `specStatus`, not from the exit code alone: a spec can print
 * `SKIP …` and exit 0, and reporting that as PASS is how a host without the
 * thing being measured claims it measured it. `passed` in the summary counts
 * PASS only; skips and partials are named.
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PARTIAL, SKIP, specStatus, summarize } from './helpers/spec_status'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const unit = join(here)

const specs = readdirSync(unit)
  .filter(f => (f.startsWith('tmcut_') || f.startsWith('docs_')) && f.endsWith('.spec.ts'))
  .sort()

let failed = 0
let passed = 0
let skipped = 0
let partial = 0
for (const spec of specs) {
  const t0 = Date.now()
  const res = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(root, 'tsconfig.test.json'), join(unit, spec)],
    { cwd: root, encoding: 'utf8' }
  )
  const status = specStatus(res.status, res.stdout || '')
  if (status === 'FAIL') failed++
  else if (status === SKIP) skipped++
  else if (status === PARTIAL) partial++
  else passed++
  // A skip names its own reason, so the row says why nothing was measured.
  const out = (res.stdout || '').trim()
  const tail = status === 'PASS'
    ? out.split('\n').filter(l => l.includes('passed') || l.includes('FAILED')).at(-1) || ''
    : out.split('\n').filter(l => l.startsWith(SKIP)).at(-1) || out.split('\n').at(-1) || ''
  console.log(`${status}  ${spec}  (${Date.now() - t0}ms)  ${tail}`)
  if (status === 'FAIL') console.log((res.stdout || '') + (res.stderr || ''))
}

console.log(`\n${summarize({ passed, skipped, partial, failed, total: specs.length })}`)
process.exit(failed === 0 ? 0 : 1)
