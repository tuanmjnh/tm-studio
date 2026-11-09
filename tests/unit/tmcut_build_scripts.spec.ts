/**
 * The packaging scripts: the only path from this tree to an installer.
 *
 * `electron-builder.yml` has described the release since slice I, but nothing in
 * `package.json` ever invoked it — the audit ran `npx electron-builder --win nsis`
 * by hand (§59.2), so "the app can be packaged" was a fact about a shell history,
 * not about the repo. A script is the part that makes it repeatable, and the
 * order inside it is the part that is easy to get wrong in a way nothing notices:
 * `electron-builder` on a stale or absent `.output` still produces an installer,
 * a much smaller one, and it only fails at runtime on the user's machine
 * (history: a 602 876-byte setup next to the healthy 219 173 763-byte one).
 *
 * Two rules are asserted here, not described:
 *   1. the Nuxt build runs before electron-builder in the same command;
 *   2. the build never publishes — `publish` in the config names a GitHub repo,
 *      so a local packaging run must not be able to create a release by accident.
 *
 * Run: npx tsx tests/unit/run-all.mts (or this file alone).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const scripts = pkg.scripts ?? {}

/** The installer and the unpacked build are separate outcomes, both scripted. */
const PACKAGE_SCRIPTS = ['build:electron', 'build:electron:win', 'build:electron:dir'] as const

describe('packaging scripts', () => {
  for (const name of PACKAGE_SCRIPTS) {
    it(`${name} exists and runs electron-builder with this repo's config`, () => {
      const script = scripts[name]
      assert.equal(typeof script, 'string', `package.json has no ${name} script`)
      assert.match(script!, /\belectron-builder\b/, `${name} must invoke electron-builder`)
      assert.match(script!, /--config electron-builder\.yml/, `${name} must pin the repo config, not a default`)
    })

    it(`${name} builds the Nuxt output first`, () => {
      const script = scripts[name]!
      const nuxt = script.search(/\bpnpm build\b|\bnuxt build\b/)
      const builder = script.search(/\belectron-builder\b/)
      assert.ok(nuxt !== -1, `${name} must run the Nuxt build — electron-builder alone packages a stale .output`)
      assert.ok(nuxt < builder, `${name} runs electron-builder before the Nuxt build`)
    })

    it(`${name} cannot publish by accident`, () => {
      // `publish` in electron-builder.yml points at a real GitHub repo. Without an
      // explicit policy a tagged local run is enough to push a release, so the
      // build-only scripts pin the answer instead of inheriting it.
      assert.match(scripts[name]!, /--publish never/, `${name} must pass --publish never`)
    })
  }

  it('the Windows script names the Windows target', () => {
    assert.match(scripts['build:electron:win']!, /--win\b/, 'a script named :win must pass --win')
    assert.doesNotMatch(scripts['build:electron']!, /--win\b/, 'the platform-agnostic script must not hard-code --win')
  })

  it('the unpacked script asks for a directory build, not an installer', () => {
    assert.match(scripts['build:electron:dir']!, /--dir\b/, 'an unpacked build must pass --dir')
  })

  it('the build output directory is gitignored', () => {
    // A build that writes into a tracked directory leaves hundreds of files in
    // `git status`; the ignore rule and the config must name the same directory.
    const builder = read('electron-builder.yml')
    const output = /directories:\s*\n(?:\s+.*\n)*?\s+output:\s*(\S+)/.exec(builder)?.[1]
    assert.ok(output, 'electron-builder.yml must declare directories.output')
    const ignored = read('.gitignore')
      .split(/\r?\n/)
      .map(line => line.trim().replace(/\/+$/, ''))
      .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
    assert.ok(ignored.includes(output!), `.gitignore does not ignore the build output "${output}"`)
  })
})

describe('source hygiene script', () => {
  it('is wired to a tool that exists', () => {
    const script = scripts['check:hygiene']
    assert.equal(typeof script, 'string', 'package.json has no check:hygiene script')
    const tool = /(?:^|\s)((?:tools|scripts)\/\S+\.mts)/.exec(script!)
    assert.ok(tool, 'check:hygiene must run a tool file under tools/ or scripts/')
    assert.ok(existsSync(join(ROOT, tool![1])), `${tool![1]} does not exist`)
  })
})
