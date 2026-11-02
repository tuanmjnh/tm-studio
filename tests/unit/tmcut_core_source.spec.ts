/**
 * One core, one name, and it lives in this repo (G10, ADR-017).
 *
 * Found while wiring ADR-021: two specs imported the engine as
 * `'../../../tmcut-core/src/index.mjs'`, which from `tests/unit/` resolves to
 * `D:\Applications\tmcut-core` — the standalone package the engine was lifted
 * out of, still sitting next to the repo. They passed, and they were asserting
 * a render contract `packages/core` had already replaced: that copy accepts an
 * odd-width canvas (1001x1000) which ADR-019's follow-up rejects on both hosts
 * because libx264/yuv420p cannot encode it, and it has no `htmlVideoSeekContract`
 * at all. A spec can only pin the behavior of the module it actually loads.
 *
 * These checks are structural, not about one file: any relative specifier that
 * resolves outside the repo is the same bug, whatever it points at.
 *
 * ADR-017 then unified the three names the same module went by (package
 * `tmcut-core`, app alias `@tmcut-core`, installed specifier `@tmcut/core`) so
 * that a name in an import is a fact about which file gets loaded.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_DIRS = ['app', 'server', 'shared', 'tests', 'packages', 'electron', 'scripts']
const SOURCE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs', '.vue'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', 'coverage'])

function sources(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sources(rel, out)
    } else if (SOURCE_EXT.has(extname(entry.name))) {
      out.push(rel)
    }
  }
  return out
}

// `from './x'`, `import('./x')`, `require('./x')` — only relative specifiers,
// which are the ones a refactor can point outside the repo without anyone
// changing a package name.
const RELATIVE = /(?:from\s*|import\(|require\()\s*['"](\.[^'"]+)['"]/g

function relativeSpecifiers(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8')
  return [...source.matchAll(RELATIVE)].map(match => match[1])
}

function escaping(): string[] {
  const found: string[] = []
  for (const dir of SOURCE_DIRS) {
    for (const file of sources(dir)) {
      for (const specifier of relativeSpecifiers(file)) {
        const target = resolve(ROOT, dirname(file), specifier)
        if (target !== ROOT && !target.startsWith(ROOT + sep)) found.push(`${file} -> ${specifier}`)
      }
    }
  }
  return found
}

const CORE_ENTRY = './packages/core/src/index.mjs'

// Built at runtime: the old alias must not appear as a literal in the file that
// proves nothing imports it.
const OLD_ALIAS = ['@tmcut', 'core'].join('-')
// The installed-package specifier (packages/core via `file:` -> dist).
const PKG_ALIAS = ['@tmcut', 'core'].join('/')

// Any non-relative import, so a name can be judged as a specifier rather than
// as prose — a comment is allowed to name the old alias to warn about it.
const ANY_IMPORT = /(?:from\s*|import\(|require\()\s*['"]([^'"]+)['"]/g

type CoreImport = { file: string, specifier: string }

function coreNamedSpecifiers(): CoreImport[] {
  const found: CoreImport[] = []
  for (const dir of SOURCE_DIRS) {
    for (const file of sources(dir)) {
      for (const match of readFileSync(join(ROOT, file), 'utf8').matchAll(ANY_IMPORT)) {
        const specifier = match[1]
        const namesTheCore = [OLD_ALIAS, PKG_ALIAS, 'tmcut-core'].some(
          name => specifier === name || specifier.startsWith(name + '/'))
        if (namesTheCore) found.push({ file, specifier })
      }
    }
  }
  return found
}

// Where the app graph maps the core, and what each config calls it.
function aliasKeys(): string[] {
  const nuxt = readFileSync(join(ROOT, 'nuxt.config.ts'), 'utf8')
  const nuxtKeys = [...nuxt.matchAll(/['"]([^'"]+)['"]\s*:\s*fileURLToPath\(new URL\(['"]\.\/packages\/core\/src\/index\.mjs['"]/g)]
    .map(match => match[1])
  const paths = JSON.parse(readFileSync(join(ROOT, 'tsconfig.test.json'), 'utf8')).compilerOptions
    .paths as Record<string, string[]>
  return [...new Set([...nuxtKeys, ...Object.keys(paths).filter(key => paths[key].includes(CORE_ENTRY))])]
}

describe('core source boundary', () => {
  it('no source file imports a path outside this repo', () => {
    assert.deepEqual(escaping(), [], 'a specifier resolving above the repo root tests some other checkout')
  })

  it('the core has one name: the import alias equals the package name', () => {
    // ADR-017. Three spellings of one module meant an import name said nothing
    // about which file was loaded; the alias now matches the package.json name
    // exactly, so the two configs cannot drift from the package or each other.
    const name = JSON.parse(readFileSync(join(ROOT, 'packages', 'core', 'package.json'), 'utf8')).name
    assert.equal(typeof name, 'string')
    assert.deepEqual(aliasKeys(), [name], 'nuxt.config and tsconfig.test both name the package')
    assert.equal(existsSync(join(ROOT, 'packages', 'core', 'src', 'index.mjs')), true, 'the alias target exists')
  })

  it('nothing imports the core through the pre-ADR-017 alias', () => {
    // Specifiers, not prose: this file's own header names the old alias to
    // explain the change, and that must not fail the guard.
    const stale = coreNamedSpecifiers()
      .filter(entry => entry.specifier === OLD_ALIAS || entry.specifier.startsWith(OLD_ALIAS + '/'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
    assert.deepEqual(stale, [], 'the alias this slice removed cannot be spelled in an import')
  })

  it('only the main process reaches the core as an installed package', () => {
    // `@tmcut/core/*` resolves through node_modules to packages/core/dist, a
    // build artifact; the alias `tmcut-core` resolves to packages/core/src.
    // Loading both means two copies of one engine in one process, so the split
    // is pinned where it is visible rather than left to grow.
    const packaged = coreNamedSpecifiers()
      .filter(entry => entry.specifier === PKG_ALIAS || entry.specifier.startsWith(PKG_ALIAS + '/'))
    for (const entry of packaged) {
      assert.ok(entry.file.startsWith('electron'), `${entry.file} uses ${entry.specifier}; only electron/ may load the built package`)
    }
    assert.ok(packaged.length > 0, 'the guard has something to guard')
  })

  it('the alias is imported bare, never as a subpath', () => {
    // A Vite object alias is a *prefix*: `tmcut-core/generationAdapter` would be
    // rewritten against the alias target and resolve to
    // packages/core/src/index.mjs/generationAdapter, a path that cannot exist.
    const aliased = coreNamedSpecifiers()
      .filter(entry => entry.specifier === 'tmcut-core' || entry.specifier.startsWith('tmcut-core/'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
      .filter(entry => !entry.endsWith('-> tmcut-core'))
    assert.deepEqual(aliased, [], 'no subpath import through the source alias')
  })

  it('every spec that reads the engine loads the engine from packages/core', async () => {
    // Resolved and imported, not matched as text: the question is which module
    // the spec actually gets. `htmlVideoSeekContract` is the newest core export
    // (ADR-021), so a loaded module without it is an older copy whatever the
    // specifier looks like.
    const liveCore = join(ROOT, 'packages', 'core', 'src', 'index.mjs')
    for (const spec of ['tests/unit/tmcut_caption_cues.spec.ts', 'tests/unit/tmcut_html_video_starters.spec.ts']) {
      const specifiers = relativeSpecifiers(spec).filter(specifier => specifier.endsWith('core/src/index.mjs'))
      assert.ok(specifiers.length > 0, `${spec} imports the core engine`)
      for (const specifier of specifiers) {
        const target = resolve(ROOT, dirname(spec), specifier)
        assert.equal(target, liveCore, `${spec} resolves its core import to packages/core`)
        const loaded = await import(pathToFileURL(target).href)
        assert.equal(typeof loaded.htmlVideoSeekContract, 'function', `${spec} loads the current core`)
      }
    }
  })

  it('the live contract differs from the stale copy, so the guard has teeth', async () => {
    // The bug this spec prevents was a *behavior* difference: the sibling copy
    // accepts an odd canvas that ADR-019's follow-up made illegal on both hosts
    // (libx264 + yuv420p cannot encode it). If the two copies had agreed, a
    // spec pinned to the old one would have been harmless — this is the
    // evidence that it was not.
    const core = await import('../../packages/core/src/index.mjs')
    const composition = '<div data-composition-id="t"><script>window.__hf={duration:1,seek(){}}</script></div>'
    const odd = core.validateHtmlVideoSpec({ html: composition, width: 1001, height: 1000, fps: 30, durationSec: 1 })
    assert.equal(odd.valid, false, 'an odd canvas is refused')
    assert.match(odd.errors.join(' '), /even/)
    assert.equal(core.validateHtmlVideoSpec({ html: composition, width: 1000, height: 1000, fps: 30, durationSec: 1 }).valid, true)
  })
})
