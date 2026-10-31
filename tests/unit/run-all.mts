/**
 * TMCut spec runner — every tests/unit/tmcut_*.spec.ts in one command
 * (`pnpm test:tmcut`). Each spec is a standalone script (they install
 * global shims and import the store as a module-level singleton, so one
 * process per spec keeps them independent), and the runner fails on the
 * first non-zero exit. The FFmpeg smoke spec is opt-in via --smoke
 * because it renders real media.
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const unit = join(here)

const includeSmoke = process.argv.includes('--smoke')
const specs = readdirSync(unit)
  .filter(f => f.startsWith('tmcut_') && f.endsWith('.spec.ts'))
  .filter(f => includeSmoke || !f.includes('smoke'))
  .sort()

let failed = 0
for (const spec of specs) {
  const t0 = Date.now()
  const res = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(root, 'tsconfig.test.json'), join(unit, spec)],
    { cwd: root, encoding: 'utf8' }
  )
  const ok = res.status === 0
  if (!ok) failed++
  const tail = (res.stdout || '').trim().split('\n').filter(l => l.includes('passed') || l.includes('FAILED')).at(-1) || ''
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec}  (${Date.now() - t0}ms)  ${tail}`)
  if (!ok) console.log((res.stdout || '') + (res.stderr || ''))
}

console.log(`\n${specs.length - failed}/${specs.length} specs passed${includeSmoke ? '' : '  (smoke skipped; run with --smoke)'}`)
process.exit(failed === 0 ? 0 : 1)
