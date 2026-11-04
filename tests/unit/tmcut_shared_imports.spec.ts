/**
 * The `#shared/` subpath map in package.json.
 *
 * Nuxt resolves `#shared/*` through its own alias, so the app and the Nitro
 * server never needed package.json. Plain Node (tsx, the unit runner, any
 * script that imports a shared module directly) has no such alias: without an
 * `imports` field it fails with ERR_PACKAGE_IMPORT_NOT_DEFINED, which is how
 * tmcut_process.spec.ts went red when it moved off a relative path onto the
 * alias AGENTS.md prescribes.
 *
 * The map is one literal target, `./shared/*`, because that is the only shape
 * that serves both import styles the repo uses. A candidate array such as
 * ["./shared/*.ts", "./shared/*.cjs"] does not work: measured on Node v24.22,
 * the first pattern that misses throws ERR_MODULE_NOT_FOUND instead of falling
 * through to the next candidate, so `#shared/utils/detection-args.cjs` would
 * be looked up as `detection-args.cjs.ts` and the .cjs import would die. With
 * a single target, the exact-file case (.cjs) resolves as written and the
 * extensionless TypeScript case is settled by the loader's own extension
 * guessing.
 *
 * This spec keeps the map honest in both directions:
 *  - every `#shared/<sub>` module imported anywhere in the repo must resolve
 *    to a real file, so a shared module cannot be importable in Nuxt and
 *    unresolvable under the test runner;
 *  - resolution must work at runtime in the two shapes the repo uses: a
 *    TypeScript module named without an extension and a .cjs module named with
 *    one;
 *  - no import may traverse outside shared/.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHARED = resolve(ROOT, 'shared')
const SCAN_DIRS = ['app', 'server', 'shared', 'electron', 'tests']
const SCAN_EXT = /\.(ts|mts|cts|js|mjs|cjs|vue)$/
/** Only real import sites - a prose mention of the alias must not count. */
const IMPORT_RE = /(?:from|import\()\s*['"](#shared\/[A-Za-z0-9_./-]+)['"]/g

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const target = pkg.imports?.['#shared/*']

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.nuxt') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (SCAN_EXT.test(entry.name)) out.push(full)
  }
  return out
}

function importedSpecifiers() {
  const found = new Set()
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const file of walk(abs)) {
      for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) found.add(match[1])
    }
  }
  return [...found].sort()
}

/** Maps the specifier the way the declared target does, then checks the file. */
function resolvesViaMap(specifier) {
  const sub = specifier.slice('#shared/'.length)
  const base = resolve(ROOT, 'shared', sub)
  if (base !== SHARED && !base.startsWith(SHARED + sep)) return false
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')]
  return candidates.some(file => existsSync(file) && statSync(file).isFile())
}

describe('package.json imports map for #shared/*', () => {
  it('declares a single literal target under shared/', () => {
    assert.equal(typeof target, 'string', 'imports["#shared/*"] must be a string, not a candidate array')
    assert.equal(target, './shared/*')
  })

  it('resolves every #shared module imported in the repo', () => {
    const used = importedSpecifiers()
    assert.ok(used.length >= 9, `expected at least nine imported specifiers, saw ${used.length}`)
    const broken = used.filter(specifier => !resolvesViaMap(specifier))
    assert.deepEqual(broken, [], `unresolvable in plain Node: ${broken.join(', ')}`)
  })

  it('never lets a shared import escape shared/', () => {
    for (const specifier of importedSpecifiers()) {
      assert.ok(!specifier.includes('..'), `traversal in ${specifier}`)
    }
  })

  it('imports a TypeScript module named without an extension', async () => {
    const store = await import('#shared/utils/processStore')
    assert.equal(typeof store.isSafeRunId, 'function')
    assert.equal(store.isSafeRunId('S01'), true)
    assert.equal(store.isSafeRunId('../S01'), false)
  })

  it('imports a .cjs module named with its extension', async () => {
    const mod = await import('#shared/utils/detection-args.cjs')
    const build = mod.sceneDetectionArgs ?? mod.default.sceneDetectionArgs
    assert.equal(typeof build, 'function')
    const scene = build('in.mp4', 0.4)
    assert.equal(scene[2], 'in.mp4', 'the input follows -i')
    assert.ok(scene.includes(`select='gt(scene,0.4)',showinfo`), `got ${JSON.stringify(scene)}`)
    assert.ok(scene.includes('-fps_mode'), 'the bundled build dropped -vsync')
    assert.ok(
      build('in.mp4', 9).includes(`select='gt(scene,0.4)',showinfo`),
      'an out-of-range threshold falls back to the pipeline default'
    )
  })
})
