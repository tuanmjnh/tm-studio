/**
 * Asset Center path-confine guard (roadmap v3 PART A, Phase 2).
 *
 * The renderer names packages by entryId/version/filename — NEVER by a raw
 * path. The controller rebuilds a path pinned inside the asset-center base:
 * every segment is sanitized, separators are split, '..' runs are defused,
 * and the RESOLVED result is re-checked against the base (prefix check).
 * If that guard ever leaks, a compromised renderer could read/write
 * arbitrary user files through the download/verify channels.
 *
 * The security property asserted here is the invariant that matters:
 * resolvePinnedPath either refuses (null) or returns a path INSIDE the
 * base — for every hostile input tried, it never returns an outside path.
 *
 * Requiring the controller under plain node is side-effect-free: the
 * top-level `require('electron')` destructures to undefined values and
 * registerAssetCenterController() is never called from a test.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { resolvePinnedPath } = require('../../electron/tools/asset-center.controller.cjs') as {
  resolvePinnedPath: (baseDir: string, segments: unknown) => string | null
}

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const BASE = path.resolve('D:\\AppData\\userData\\tmcut\\asset-center\\packages')

/** Invariant helper: null (refused) or strictly inside BASE. */
function assertPinned(segments: unknown, label: string): void {
  const got = resolvePinnedPath(BASE, segments)
  if (got === null) return
  const baseWithSep = BASE + path.sep
  if (got !== BASE && !got.startsWith(baseWithSep)) {
    throw new Error(`${label}: escaped the base -> ${got}`)
  }
}

async function main() {
  await check('happy path: entry/version/filename pins inside the base', () => {
    const got = resolvePinnedPath(BASE, ['starter-sfx-sweep', '1.0.0', 'sample-sfx-sweep.wav'])
    if (got !== path.join(BASE, 'starter-sfx-sweep', '1.0.0', 'sample-sfx-sweep.wav')) {
      throw new Error(`unexpected resolved path: ${got}`)
    }
  })

  await check('dot-segment traversal never escapes', () => {
    // Pure ".." runs resolve outside the base and MUST be refused outright.
    if (resolvePinnedPath(BASE, ['..', '..', '..', 'evil.mp4']) !== null) {
      throw new Error('bare traversal must resolve to null')
    }
    assertPinned(['starter', '..', '..', 'evil.mp4'], 'mixed traversal')
    assertPinned(['starter', '..', 'x', '..', 'y.wav'], 'alternating traversal')
  })

  await check('embedded separator traversal never escapes', () => {
    assertPinned(['starter', '..\\..\\..\\Windows\\evil.dll'], 'win embedded traversal')
    assertPinned(['starter', '../../../etc/passwd'], 'unix embedded traversal')
  })

  await check('absolute-path inputs never escape', () => {
    assertPinned(['C:\\Windows\\system32\\evil.dll'], 'absolute windows')
    assertPinned(['/etc/passwd'], 'absolute unix')
    assertPinned(['\\\\server\\share\\evil.dll'], 'unc path')
  })

  await check('separator smuggling stays one level deep', () => {
    // A segment with separators is split, so the pieces land INSIDE the
    // base — never outside. Assert confinement + sane depth.
    const got = resolvePinnedPath(BASE, ['a\\b'])
    if (got === null) throw new Error('sanitizable segment should resolve, not refuse')
    const rel = path.relative(BASE, got)
    if (rel.split(path.sep).length > 2) throw new Error(`unexpected depth: ${rel}`)
    assertPinned(['a/b'], 'forward slash segment')
  })

  await check('junk inputs never escape', () => {
    assertPinned(['evil\u0000.wav'], 'null byte')
    assertPinned(['evil\u0007.wav'], 'control char')
    assertPinned([''], 'empty segment')
    assertPinned(['   '], 'whitespace segment')
    assertPinned(['x'.repeat(300)], 'oversized segment')
    assertPinned('starter/file.wav', 'string input')
    assertPinned(null, 'null input')
    assertPinned(undefined, 'undefined input')
    assertPinned([42], 'number segment')
    assertPinned(Array.from({ length: 64 }, (_, i) => `seg${i}`), 'long segment list')
  })

  await check('sanitized names round-trip through the prefix check', () => {
    // Odd but legal characters are preserved; the path stays pinned.
    const got = resolvePinnedPath(BASE, ['sfx.sweep_v2', '1.0-rc1', 'a-b_c.wav'])
    if (got === null) throw new Error('legal segments must resolve')
    assertPinned(['sfx.sweep_v2', '1.0-rc1', 'a-b_c.wav'], 'legal chars')
  })

  console.log(`\n${passed} asset-center path guard checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
