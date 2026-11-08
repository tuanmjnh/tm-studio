/**
 * Slice K's gate, brief item 9: the release artefact and the tree that builds it
 * name no retired binary, and nothing that spawns a process for media survives.
 *
 * Slice I deleted the binaries and slice J retired the last FFmpeg syntax in the
 * core, but "we removed it" is a claim about one commit. Nothing in the suite
 * read `package.json`, the lockfile, `electron-builder.yml`, the preload bridge or
 * the CI directory — the four places a dependency, a shipped file, an IPC channel
 * or a build step can quietly bring the engine back without touching `app/`.
 * That is why this guard exists, and why it reads the artefacts instead of the
 * source: a re-added dependency leaves no trace in the code that uses it.
 *
 * Every assertion below is a count or an absence on the working tree as it is
 * checked out. Measured when this file was written:
 *   - `package.json` and `pnpm-lock.yaml`: 0 matches for the retired names;
 *   - tracked `.exe`: 0 (the downloader is resolved from `resources/` at runtime
 *     and is not in git);
 *   - `electron/main.cjs`: 24 `ipcMain.handle` registrations, none of them media;
 *   - `electron/tools/paths.cjs`: the only `execFile` is the yt-dlp version probe,
 *     i.e. the one non-media tool the app still ships;
 *   - `electron-builder.yml`: `extraResources` ships `yt-dlp.exe`, JSON, `.node`
 *     and the starter catalog — no media binary;
 *   - `server/api/**`: no route spawns and none names the retired tool;
 *   - CI: no workflow exists, and if one appears it must not contain the names.
 *
 * Run: npx tsx tests/unit/run-all.mts (or this file alone).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * The retired names, built from fragments. Writing them whole in this file would
 * make the guard fail on itself, and a comment explaining why is not the same as
 * a pattern that cannot match its own source.
 */
const RETIRED = new RegExp(['ff', 'mpeg'].join('') + '|' + ['ff', 'probe'].join(''), 'i')

/** Every file under `dir`, recursively, as repo-relative paths. */
function walk(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(rel, out)
    } else {
      out.push(rel)
    }
  }
  return out
}

describe('slice K: the release surface carries no retired media engine', () => {
  it('no manifest or lockfile pulls the engine back in', () => {
    for (const file of ['package.json', 'pnpm-lock.yaml']) {
      assert.doesNotMatch(read(file), RETIRED, `${file} names a retired binary — a dependency came back`)
    }
  })

  it('no build or release script names it either', () => {
    const scripts = JSON.stringify(JSON.parse(read('package.json')).scripts ?? {})
    assert.doesNotMatch(scripts, RETIRED, 'a package.json script names a retired binary')
  })

  it('the repository tracks no Windows executable at all', () => {
    // The downloader is resolved from resources/ at runtime and is not committed;
    // the source of truth for "what is tracked" is the index, not the disk.
    const out = execFileSync('git', ['ls-files', '*.exe'], { cwd: ROOT, encoding: 'utf8' }).trim()
    assert.equal(out, '', `tracked executables found: ${out.split('\n').slice(0, 5).join(', ')}`)
  })

  it('packaging ships no media binary and no retired name', () => {
    // What ships is the parsed config, not its prose: a comment recording why a
    // builder was deleted is history, and this repo keeps that history. Strip
    // comments first, then judge what the config actually declares.
    const builder = read('electron-builder.yml').replace(/(^|\n)\s*#[^\n]*/g, '$1')
    assert.doesNotMatch(builder, RETIRED, 'electron-builder.yml declares a retired binary')
    // The downloader is the one executable extraResources is allowed to carry;
    // pinning it keeps the list from growing silently.
    const resources = builder.slice(builder.indexOf('extraResources:'), builder.indexOf('\nwin:'))
    const executables = resources.match(/"[^"]*\.exe"/g) ?? []
    assert.deepEqual(executables, ['"yt-dlp.exe"'],
      `extraResources ships an executable nobody declared: ${executables.join(', ')}`)
  })

  it('the IPC bridge registers no media engine channel', () => {
    const main = read('electron/main.cjs')
    const handlers = [...main.matchAll(/ipcMain\.handle\(\s*[`'"]([^`'"]+)[`'"]/g)].map(m => m[1]!)
    assert.ok(handlers.length > 15, `expected the real bridge, found ${handlers.length} handlers`)
    const retired = handlers.filter(channel => RETIRED.test(channel))
    assert.deepEqual(retired, [], `IPC still exposes ${retired.join(', ')}`)
  })

  it('the one execFile left is the downloader, not a media tool', () => {
    const paths = read('electron/tools/paths.cjs')
    assert.match(paths, /const \{ execFile \} = require\('child_process'\)/, 'this check reads a file that no longer spawns')
    const probes = [...paths.matchAll(/execFile\(([^,]+),/g)].map(m => m[1]!.trim())
    assert.deepEqual(probes, ['filePath'], `a second execFile appeared: ${probes.join(', ')}`)
    assert.doesNotMatch(paths, RETIRED, 'the tool resolver names a retired binary')
    // `verifyExecutable` is type-gated before it spawns: only the downloader type
    // may reach the probe, so a caller cannot hand it anything else.
    assert.match(paths, /if \(type !== 'ytDlp'\) return resolve\(false\)/,
      'the execFile probe must stay gated to the downloader type')
  })

  it('no server route spawns, and none names the retired tool', () => {
    const routes = walk('server/api')
    assert.ok(routes.length >= 10, `expected the server route tree, found ${routes.length} files`)
    for (const rel of routes) {
      const src = read(rel)
      assert.doesNotMatch(src, /node:child_process|\bchild_process\b/, `${rel} imports a process API`)
      assert.doesNotMatch(src, /\bspawn\s*\(|\bexecFile\s*\(/, `${rel} starts a process`)
      assert.doesNotMatch(src, RETIRED, `${rel} names a retired binary`)
    }
  })

  it('CI, where it exists, is held to the same rule', () => {
    const workflows = walk('.github')
    for (const rel of workflows) {
      assert.doesNotMatch(read(rel), RETIRED, `${rel} names a retired binary`)
    }
    // Not a skip: an absent workflow directory is a true statement about this
    // repo, and the loop above is what becomes active the day one is added.
    assert.ok(true)
  })
})
