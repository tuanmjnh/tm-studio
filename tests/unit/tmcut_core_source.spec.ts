/**
 * One core, and it lives in this repo (G10).
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

describe('core source boundary', () => {
  it('no source file imports a path outside this repo', () => {
    assert.deepEqual(escaping(), [], 'a specifier resolving above the repo root tests some other checkout')
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
