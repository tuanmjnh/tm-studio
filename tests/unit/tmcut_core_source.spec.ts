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
 * ADR-017 then unified the three names the same module went by (the package
 * name, an app alias carrying a hyphen, and an installed specifier carrying a
 * slash) so that a name in an import is a fact about which file gets loaded.
 * The third name was the last split (G13, ADR-022): it resolved through
 * `node_modules` to a build artifact, so one process could hold two copies of
 * one engine. Its literal survives nowhere outside `docs/`, this file included:
 * the retired names are rebuilt from fragments below, because a banner naming a
 * retired scope is how the split comes back — the module copied from it puts
 * that name in an import.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_DIRS = ['app', 'server', 'shared', 'tests', 'packages', 'electron', 'scripts']
const SOURCE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs', '.vue'])
const PROSE_EXT = new Set([...SOURCE_EXT, '.md'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', 'coverage'])

function sources(dir: string, out: string[] = [], extensions: Set<string> = SOURCE_EXT): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sources(rel, out, extensions)
    } else if (extensions.has(extname(entry.name))) {
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

// A package's own `dist` is what `npm publish` ships and nothing else: it is
// ADR-034: the package is consumed from its published `dist`, so there is no
// src tree under node_modules to compare against. The rule ADR-022 protected is
// unchanged — one engine, one copy — it is now enforced by the package
// resolution rather than by a build-artifact comparison.
const CORE_PKG_DIR = join(ROOT, 'node_modules', 'tm-cut-core')

function readsBuildArtifact(): string[] {
  // ADR-022 forbade reading a locally-built dist because it could lag src. With
  // a registry install there is no separate build: the installed tree IS the
  // published artifact. What remains enforced is where that path may appear:
  // tests may read a module's text to assert on it, and the Electron main
  // process must use a path (Vite's resolution is not available to it). App and
  // server code must go through the package name.
  const ALLOWED = ['tests', 'electron']
  const found: string[] = []
  for (const dir of SOURCE_DIRS) {
    if (ALLOWED.includes(dir)) continue
    for (const file of sources(dir)) {
      for (const specifier of relativeSpecifiers(file)) {
        const target = resolve(ROOT, dirname(file), specifier)
        if (target.startsWith(CORE_PKG_DIR + sep)) found.push(`${file} -> ${specifier}`)
      }
    }
  }
  return found
}

// Every core file the main process loads, plus whatever those files import.
// The packaged app only contains what electron-builder.yml lists, and a missing
// leaf throws MODULE_NOT_FOUND in the build but never in dev.
function coreClosure(): string[] {
  const seen = new Set<string>()
  const queue: string[] = []
  for (const file of sources('electron')) {
    for (const specifier of relativeSpecifiers(file)) {
      const target = resolve(ROOT, dirname(file), specifier)
      if (target.startsWith(CORE_PKG_DIR + sep)) {
        queue.push(relative(ROOT, target).split(sep).join('/'))
      }
    }
  }
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file) || !existsSync(join(ROOT, file))) continue
    seen.add(file)
    for (const specifier of relativeSpecifiers(file)) {
      queue.push(relative(ROOT, resolve(ROOT, dirname(file), specifier)).split(sep).join('/'))
    }
  }
  return [...seen].sort()
}

function shippedPatterns(): string[] {
  const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  const block = yml.match(/\nfiles:\n([\s\S]*?)\n\S/)?.[1] ?? ''
  return [...block.matchAll(/^\s*-\s*(\S+)\s*$/gm)].map(match => match[1])
}

function notShipped(files: string[]): string[] {
  const patterns = shippedPatterns()
  return files.filter(file => !patterns.some(pattern => pattern.endsWith('/**/*')
    ? file.startsWith(pattern.slice(0, -'/**/*'.length) + '/')
    : file === pattern))
}

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
        const namesTheCore = [OLD_ALIAS, PKG_ALIAS, 'tm-cut-core'].some(
          name => specifier === name || specifier.startsWith(name + '/'))
        if (namesTheCore) found.push({ file, specifier })
      }
    }
  }
  return found
}

// The names no host resolves any more. Rebuilt from fragments so this file can
// forbid them without spelling them.
const RETIRED_NAMES = [OLD_ALIAS, PKG_ALIAS, ['@tmcut', 'types'].join('/')]

// Comments and READMEs, not only specifiers: the retired specifier sat in 75 core
// banners and 24 app/server/electron comments after ADR-022 removed the
// dependency, and a module copied from one of those banners re-imports a name
// that resolves through node_modules into a build artifact. `docs/` is excluded
// by the walk — SOURCE_DIRS never held it — because the ADR records have to name
// the retired specifier to explain the change.
function retiredNameProse(): string[] {
  const found: string[] = []
  for (const dir of SOURCE_DIRS) {
    for (const file of sources(dir, [], PROSE_EXT)) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const name of RETIRED_NAMES) {
        if (text.includes(name)) found.push(`${file} -> ${name}`)
      }
    }
  }
  return found
}

// Where the app graph maps the core, and what each config calls it.
function aliasKeys(): string[] {
  const nuxt = readFileSync(join(ROOT, 'nuxt.config.ts'), 'utf8')
  // A path entry that points at the package at all is the thing ADR-034 removed:
  // resolution belongs to the package exports, not to a hand-written alias.
  const nuxtKeys = [...nuxt.matchAll(/['"]([^'"]+)['"]\s*:\s*fileURLToPath\(new URL\(['"][^'"]*tm-cut-core[^'"]*['"]/g)]
    .map(match => match[1])
  const paths = JSON.parse(readFileSync(join(ROOT, 'tsconfig.test.json'), 'utf8')).compilerOptions
    .paths as Record<string, string[]>
  const tsKeys = Object.keys(paths).filter(key => paths[key]!.some(value => value.includes('tm-cut-core')))
  return [...new Set([...nuxtKeys, ...tsKeys])]
}

describe('core source boundary', () => {
  it('no source file imports a path outside this repo', () => {
    assert.deepEqual(escaping(), [], 'a specifier resolving above the repo root tests some other checkout')
  })

  it('the core has one name: the package name, resolved by the package itself', () => {
    // ADR-017 kept three spellings of one module from meaning three different
    // files. ADR-034 removes the alias that did the naming: the package's own
    // `exports` map is now the only thing that decides which file loads, so the
    // guard asserts the stronger fact — nothing configures a path for it.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'tm-cut-core', 'package.json'), 'utf8'))
    assert.equal(typeof pkg.name, 'string')
    assert.deepEqual(aliasKeys(), [], 'no nuxt alias and no tsconfig path names the package')
    assert.ok(pkg.exports?.['.'], 'the package declares its own entry point')
    assert.equal(existsSync(join(ROOT, 'node_modules', 'tm-cut-core', 'index.js')), true, 'and the entry file is installed')
  })

  it('nothing imports the core through the pre-ADR-017 alias', () => {
    // Specifiers only; prose is pinned by the retired-name guard below. This file
    // spells both names from fragments, so neither guard trips on it.
    const stale = coreNamedSpecifiers()
      .filter(entry => entry.specifier === OLD_ALIAS || entry.specifier.startsWith(OLD_ALIAS + '/'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
    assert.deepEqual(stale, [], 'the alias this slice removed cannot be spelled in an import')
  })

  it('nothing reads the core from the build artifact', () => {
    // G13, measured: packages/core/dist/index.js (built 2026-10-31T10:57)
    // contains no htmlVideoSeekContract, while src/htmlVideo.mjs has had it
    // since ADR-021 — a rebuild was never run, and no gate could see it because
    // dist is gitignored.
    assert.deepEqual(readsBuildArtifact(), [], 'the built copy is not a source dependency')
  })

  it('the core is not installed as a package', () => {
    // The third name resolved through node_modules into dist, so the main
    // process ran a different engine than the alias gave the app and the tests.
    // The `file:` dependency is gone, which makes the specifier unresolvable —
    // so the declarations are pinned too, not only the imports.
    const packaged = coreNamedSpecifiers()
      .filter(entry => entry.specifier === PKG_ALIAS || entry.specifier.startsWith(PKG_ALIAS + '/'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
    assert.deepEqual(packaged, [], 'no import names the core as an installed package')

    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    assert.equal(root.dependencies?.[PKG_ALIAS], undefined, 'the core is not a runtime dependency')
    assert.equal(root.devDependencies?.[PKG_ALIAS], undefined, 'and not a dev dependency')
    assert.equal(
      readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8').includes(PKG_ALIAS),
      false,
      'the lockfile resolves no scoped core name')
  })

  it('no source or README outside docs names a retired core name', () => {
    // ADR-022 removed the dependency; this closes the prose half. The count is
    // measured, not assumed: 75 files under packages/core (file banners and the
    // READMEs) plus 24 comments in app/, server/, shared/, electron/ and
    // tests/unit/ carried the installed specifier before the sweep.
    assert.deepEqual(retiredNameProse(), [], 'one name, in code and in prose')
  })

  it('the packaged app contains every core module the main process loads', () => {
    // electron-builder ships exactly what `files:` lists, so a require() whose
    // target is not listed fails in the build and never in dev. Before this
    // slice the list held one hand-picked src leaf plus all of dist.
    const closure = coreClosure()
    assert.ok(closure.length > 0, 'the main process loads at least one core module')
    assert.deepEqual(notShipped(closure), [], 'the whole transitive closure is shipped')
  })

  it('the alias is imported bare, never as a subpath', () => {
    // A Vite object alias is a *prefix*: `tm-cut-core/generationAdapter` would be
    // rewritten against the alias target and resolve to
    // node_modules/tm-cut-core/src/index.mjs/generationAdapter, a path that
    // cannot exist.
    const aliased = coreNamedSpecifiers()
      .filter(entry => entry.specifier === 'tm-cut-core' || entry.specifier.startsWith('tm-cut-core/'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
      .filter(entry => !entry.endsWith('-> tm-cut-core'))
    assert.deepEqual(aliased, [], 'no subpath import through the source alias')
  })

  it('the main process names the core only by a path, never by a package name', () => {
    // Neither name can work in this host: the `tm-cut-core` mapping belongs to
    // Vite, so main would get ERR_MODULE_NOT_FOUND at startup, and the scoped
    // name only "works" if the dependency comes back — which is exactly the
    // silent load of dist that G13 measured.
    const named = coreNamedSpecifiers()
      .filter(entry => entry.file.startsWith('electron'))
      .map(entry => `${entry.file} -> ${entry.specifier}`)
    assert.deepEqual(named, [], 'main process reaches the core by relative path')
  })

  it('every spec that reads the engine loads the engine from the installed package', async () => {
    // Resolved and imported, not matched as text: the question is which module
    // the spec actually gets. `htmlVideoSeekContract` is the newest core export
    // (ADR-021), so a loaded module without it is an older copy whatever the
    // specifier looks like. ADR-034: the specifier is the package name now.
    const liveCore = join(ROOT, 'node_modules', 'tm-cut-core', 'index.js')
    const loaded = await import(pathToFileURL(liveCore).href)
    assert.equal(typeof loaded.htmlVideoSeekContract, 'function', 'the installed package is the current core')

    for (const spec of ['tests/unit/tmcut_caption_cues.spec.ts', 'tests/unit/tmcut_html_video_starters.spec.ts']) {
      assert.match(
        readFileSync(join(ROOT, spec), 'utf8'),
        /from 'tm-cut-core'/,
        `${spec} imports the engine by package name`
      )
    }
  })

  it('the live contract still refuses an odd canvas, so the guard has teeth', async () => {
    // The bug this spec prevents was a *behavior* difference: an older copy
    // accepts an odd canvas that ADR-019's follow-up made illegal on both hosts
    // (libx264 + yuv420p cannot encode it). The installed package must refuse it.
    const core = await import('tm-cut-core')
    const composition = '<div data-composition-id="t"><script>window.__hf={duration:1,seek(){}}</script></div>'
    const odd = core.validateHtmlVideoSpec({ html: composition, width: 1001, height: 1000, fps: 30, durationSec: 1 })
    assert.equal(odd.valid, false, 'an odd canvas is refused')
    assert.match(odd.errors.join(' '), /even/)
    assert.equal(core.validateHtmlVideoSpec({ html: composition, width: 1000, height: 1000, fps: 30, durationSec: 1 }).valid, true)
  })
})
