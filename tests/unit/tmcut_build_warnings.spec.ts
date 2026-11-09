/**
 * Build warnings that are not the build's fault, pinned so they cannot come back.
 *
 * Two classes of noise appeared on every `nuxt build`:
 *
 *  1. `Gradient has outdated direction syntax` ×2, pointing at our own CSS.
 *     The source is correct, but lightningcss (Nuxt's minifier) drops the
 *     default `at 50% 50%` and the `ellipse` keyword, leaving
 *     `radial-gradient(58% 50%, …)`. autoprefixer's pre-2012 matcher then reads
 *     that as `0 0, closest-side` and warns about a rule nobody wrote.
 *     Naming the shape does not help: the minifier drops it again. The radii
 *     have to reach the minifier as something it cannot constant-fold.
 *
 *  2. `fs/promises externalized for browser compatibility` from the core.
 *     Real, and it was hiding a bug: the health check called `fs.stat` on an
 *     empty module, threw, and reported `disk-access: fail` in every healthy
 *     browser. Reading the builtin through `process.getBuiltinModule` keeps the
 *     probe working in Node without putting a bundler-visible import in the
 *     renderer graph.
 *
 * Run: npx tsx tests/unit/run-all.mts (or this file alone).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** The regex autoprefixer uses to spot pre-standard radial-gradient syntax. */
const OLD_RADIAL = /(^|[^-])radial-gradient\(\s*\d+(\w*|%)\s+\d+(\w*|%)\s*,/i

/** Every radial-gradient argument list in the given CSS, at any nesting. */
function radialGradients(css: string): string[] {
  const out: string[] = []
  const marker = 'radial-gradient('
  let index = css.indexOf(marker)
  while (index !== -1) {
    let depth = 0
    let cursor = index + marker.length - 1
    for (; cursor < css.length; cursor++) {
      if (css[cursor] === '(') depth += 1
      else if (css[cursor] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    out.push(css.slice(index + marker.length, cursor))
    index = css.indexOf(marker, cursor)
  }
  return out
}

describe('minifier output does not trip autoprefixer', () => {
  const cssFiles = readdirSync(join(ROOT, 'app/assets/css'))
    .filter(name => name.endsWith('.css'))
    .map(name => `app/assets/css/${name}`)

  it('no radial-gradient folds down into the pre-2012 form', () => {
    const offending: string[] = []
    for (const file of cssFiles) {
      for (const args of radialGradients(read(file))) {
        // lightningcss drops `ellipse` and a default `at 50% 50%`. What is left
        // is `W H,` — the exact shape autoprefixer 10.6 calls outdated.
        const folded = args.replace(/^\s*(?:ellipse|circle)\s+/i, '').replace(/\s+at\s+50%\s+50%\s*,/i, ',')
        const match = `radial-gradient(${folded}`.match(OLD_RADIAL)
        if (match) offending.push(`${file}: ${match[0].trim()}`)
      }
    }
    assert.deepEqual(offending, [],
      'this gradient loses its shape and centre in the minifier, and autoprefixer then warns about it — pass the radii through a custom property')
  })

  it('the lens mask keeps its radii out of the minifier’s reach', () => {
    const css = read('app/assets/css/decor.css')
    const masks = [...css.matchAll(/(?:-webkit-)?mask-image:\s*(radial-gradient\([^;]*\))/g)].map(m => m[1]!)
    assert.ok(masks.length >= 2, `expected the lens mask declarations, found ${masks.length}`)
    for (const value of masks) {
      assert.doesNotMatch(value, /\d+(?:%|px)\s+\d+(?:%|px)\s+at\s+50%\s+50%/,
        `mask gradient "${value}" spells its radii literally, so the minifier will strip the shape and autoprefixer will warn`)
      assert.match(value, /var\(--tm-[\w-]+\)/,
        `mask gradient "${value}" must read its radii from a custom property`)
    }
  })
})

/** Strip comments so prose about a specifier is not mistaken for one. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the core keeps Node-only imports out of the client graph', () => {
  it('no core module imports a Node builtin', () => {
    // A `await import('node:…')` in core/src silently joins the renderer bundle
    // as an empty module (or throws at load), and the resulting warning reads
    // like a build-config problem rather than a missing capability.
    const found: string[] = []
    const patterns = [
      /(?:from|import)\s*\(?\s*['"](node:[^'"]+)['"]/g,
      /(?:from|import)\s*\(?\s*['"](fs|fs\/promises|path|os|child_process|url|crypto|worker_threads)['"]/g,
      /require\(\s*['"](node:[^'"]+|fs|fs\/promises|path|os)['"]\s*\)/g
    ]
    for (const name of readdirSync(join(ROOT, 'packages/core/src'))) {
      if (!name.endsWith('.mjs')) continue
      const rel = `packages/core/src/${name}`
      const src = stripComments(read(rel))
      for (const pattern of patterns) {
        for (const match of src.matchAll(pattern)) {
          found.push(`${relative(ROOT, join(ROOT, rel)).replace(/\\/g, '/')} -> ${match[1]}`)
        }
      }
    }
    assert.deepEqual(found, [],
      'the core must reach a Node builtin through process.getBuiltinModule, not an import the client bundler has to externalise')
  })

  it('the probe still finds the real filesystem when one exists', async () => {
    const { runHealthChecks } = await import('../../packages/core/src/crashRecovery.mjs') as {
      runHealthChecks: () => Promise<{ checks: Array<{ name: string, status: string, detail: string }> }>
    }
    const { checks } = await runHealthChecks()
    const disk = checks.find(check => check.name === 'disk-access')
    assert.ok(disk, 'the health checks no longer report disk access')
    assert.equal(disk.status, 'ok', `under Node the disk probe must succeed, got ${disk.status}: ${disk.detail}`)
  })

  it('that probe tolerates the browser build providing no filesystem', async () => {
    const { describeDiskAccess } = await import('../../packages/core/src/crashRecovery.mjs') as {
      describeDiskAccess: (fsModule: unknown) => Promise<{ status: string, detail: string }>
    }
    // This is what the bundler hands the renderer: an object with no `stat`.
    const browser = await describeDiskAccess({})
    assert.notEqual(browser.status, 'fail', 'an absent filesystem is not a filesystem failure')
  })
})
