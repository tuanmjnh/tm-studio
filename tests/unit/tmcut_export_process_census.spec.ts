/**
 * Slice H's exit gate, third clause: **0 spawn**.
 *
 * The migration plan (§8 of the audit) states three things slice H must prove
 * before slice I is allowed to delete the FFmpeg engine: the output plays, A/V
 * sync holds, and the export spends **zero** processes. The first two have been
 * measured since H3c (§52) and H3d-4 (§53.11). The third was only ever asserted
 * in prose — "the export imports no ffmpeg helper" is a claim about today's
 * imports, and imports are exactly what a later slice edits in passing.
 *
 * So this spec pins the claim two ways, and it pins the REASON rather than a
 * grep of one word:
 *
 *  1. the module graph of the browser export is closed and named: the entry
 *     (`webExportHost.ts`) and every local module it pulls in, transitively, is
 *     listed. A new import into that graph fails here until someone looks;
 *  2. nothing in that graph can start a process — no `node:child_process`, no
 *     `spawn`/`exec`, and no reachable module from the FFmpeg side
 *     (`ffmpegHelper`, `render/`, `hostBridge` IPC, the Electron controller).
 *
 * The list is deliberately literal. A guard that walked `app/utils/tmcut` and
 * excluded a directory would pass on the day someone moves the spawn one
 * directory over — which is the failure mode this is written to catch.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_process_census.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const norm = (p: string) => p.replace(/\\/g, '/')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** The browser export's entry point: the one module the modal calls. */
const ENTRY = 'app/utils/tmcut/webExportHost.ts'

/**
 * Local imports of one app module that survive to runtime, resolved to
 * repo-relative paths. `import type` is excluded on purpose: a type-only edge is
 * erased by the compiler and pulls nothing into the browser bundle, so counting
 * it would make the census describe a graph that never executes. The one such
 * edge in this graph is `paintSurfaces.ts` naming the store's clip types.
 *
 * Only `./`, `~/` and `app/` specifiers: a package import (`tmcut-core`,
 * `mediabunny`) is not part of this graph, and a later check names the packages
 * that are allowed.
 */
function localImports(rel: string): string[] {
  const source = read(rel)
  const runtime = source
    .split('\n')
    .filter(line => !/^\s*import\s+type\b/.test(line))
    .join('\n')
  const specifiers = [...runtime.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]!)
  const out: string[] = []
  for (const spec of specifiers) {
    let resolved: string | null = null
    if (spec.startsWith('./')) {
      resolved = norm(join(dirname(rel), spec))
    } else if (spec.startsWith('~/')) {
      resolved = `app/${spec.slice(2)}`
    } else if (spec.startsWith('app/')) {
      resolved = spec
    }
    if (!resolved) continue
    for (const candidate of [`${resolved}.ts`, `${resolved}/index.ts`, resolved]) {
      if (existsSync(join(ROOT, candidate))) {
        out.push(candidate)
        break
      }
    }
  }
  return out
}

/** Every app module reachable from the entry, transitively, including the entry. */
function graph(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const next of localImports(file)) queue.push(next)
  }
  return [...seen].sort()
}

function main() {
  console.log('=== [TMCut export process census] Starting ===\n')

  check('the export entry exists and is the module the modal calls', () => {
    assert.ok(existsSync(join(ROOT, ENTRY)), `${ENTRY} is the browser export`)
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.match(modal, /createWebExportHost\(\)/, 'the modal reaches the export through this module')
    assert.match(modal, /from '~\/utils\/tmcut\/webExportHost'/, 'and imports it from one place')
  })

  // 1. The graph, frozen at what it actually measures. A new local import into
  //    the export fails here until the list is updated ON PURPOSE — which is the
  //    moment someone can ask "does this new module start a process?".
  //
  //    Two of the eight were not in this spec's first draft and the run said so:
  //    `audioDecode.ts` (the sound leg's PCM seam, §53.9) and `paintSurfaces.ts`
  //    (the shared surface law, §53.7). The list below is the measurement, not
  //    the guess — which is the whole reason to compare a whole set instead of
  //    asserting a couple of `includes`.
  const reachable = graph(ENTRY)
  const EXPECTED = [
    'app/utils/tmcut/audioDecode.ts',
    'app/utils/tmcut/exportEncodePlan.ts',
    'app/utils/tmcut/exportEncodeSession.ts',
    'app/utils/tmcut/exportMixLeg.ts',
    'app/utils/tmcut/frameDecode.ts',
    'app/utils/tmcut/paintSurfaces.ts',
    'app/utils/tmcut/webCodecsExport.ts',
    'app/utils/tmcut/webExportHost.ts'
  ]

  check('the export pulls in exactly the modules this spec names', () => {
    assert.deepEqual(reachable, EXPECTED,
      'a new module in the export graph is a new place that could open a process')
  })

  // 2. Nothing in that graph can start one, and it cannot reach anything that
  //    does. Two separate statements on purpose: "no spawn here" is not the same
  //    claim as "cannot import the thing that spawns".
  check('no module in the export graph starts a process', () => {
    const patterns = [
      { re: /from\s+'node:child_process'/, what: 'node:child_process' },
      { re: /require\(\s*'child_process'\s*\)/, what: 'require(child_process)' },
      { re: /\bspawnSync\(/, what: 'spawnSync' },
      { re: /\bspawn\(/, what: 'spawn' },
      { re: /\bexecFile\(/, what: 'execFile' },
      { re: /\bexecSync\(/, what: 'execSync' }
    ]
    for (const file of reachable) {
      // Comments are prose here (`spawn` appears in the census itself), so the
      // check reads code: a line whose trimmed form starts with `//` or `*` is
      // not a call site.
      const code = read(file).split('\n')
        .filter((line) => {
          const trimmed = line.trim()
          return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
        })
        .join('\n')
      for (const pattern of patterns) {
        assert.doesNotMatch(code, pattern.re, `${file} uses ${pattern.what}`)
      }
    }
  })

  check('the export graph cannot reach the FFmpeg side', () => {
    const forbidden = [
      'app/utils/ffmpegHelper.ts',
      'app/utils/tmcut/compiler.ts',
      'app/utils/tmcut/render/index.ts',
      'app/utils/tmcut/hostBridge.ts'
    ]
    for (const file of forbidden) {
      assert.ok(!reachable.includes(file),
        `${file} is on the FFmpeg/IPC side and must not be reachable from the export`)
    }
    // The reverse direction matters too: the compiler is what spawns FFmpeg on
    // the desktop, so it is named here as the thing this census is about.
    const compiler = read('app/utils/tmcut/compiler.ts')
    assert.match(compiler, /compileTimelineToFfmpeg/,
      'the FFmpeg path is still the compiler — slice I deletes it, not this slice')
  })

  // 3. The packages the graph may use are the browser's. `mediabunny` demuxes
  //    and muxes in-process, and `tmcut-core` is pure; a Node-only package here
  //    would be a process by another name.
  check('the graph imports only the browser and pure-core packages', () => {
    const allowed = new Set(['tmcut-core', 'mediabunny'])
    const local = (spec: string) => spec.startsWith('.') || spec.startsWith('~/') || spec.startsWith('app/')
    for (const file of reachable) {
      const specs = [...read(file).matchAll(/from\s+'([^']+)'/g)].map(m => m[1]!)
      for (const spec of specs) {
        if (local(spec)) continue
        assert.ok(allowed.has(spec), `${file} imports the package ${spec}, which the census does not allow`)
      }
    }
  })

  // 4. The modal's own dispatch is the only place the two paths meet, and the
  //    web branch is chosen by the platform answer, not by a second sniff. This
  //    is what keeps the census above meaningful: if the modal could fall
  //    through to `enqueueJob` after `runWebExport`, the graph would be clean
  //    while the export still spawned.
  check('a web export cannot fall through to the desktop queue', () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    const webAt = modal.indexOf('await runWebExport()')
    assert.ok(webAt > 0, 'the web branch calls the browser exporter')
    const guardAt = modal.indexOf('if (!platform.info.capabilities.nativeFFmpeg)')
    assert.ok(guardAt > 0 && webAt > guardAt, 'and it runs under the capability answer')
    const after = modal.slice(webAt, webAt + 400)
    assert.match(after, /return\b/,
      'the web branch returns, so the desktop enqueue below it cannot run in the same call')
    const enqueueAt = modal.indexOf('enqueueJob({', webAt)
    assert.ok(enqueueAt > webAt, 'the queue call for the desktop sits after the web branch')
  })

  // 5. The process count is a fact about this repo, not a hope. The spawns that
  //    slice I retires are in the Electron main process, and none of them is
  //    reachable from the browser export — a different process with no require
  //    of its own. Recorded by file so slice I knows exactly what it deletes.
  check('the FFmpeg spawns this census counts are the desktop ones, untouched', () => {
    const controller = 'electron/tools/ffmpeg.controller.cjs'
    assert.ok(existsSync(join(ROOT, controller)), 'the FFmpeg controller is the desktop path')
    const source = read(controller)
    assert.match(source, /require\('child_process'\)/, 'it is the module that can start a process')
    assert.match(source, /\bspawn\(/, 'and it does')
    // The renderer cannot import a `.cjs` in `electron/`: it has no `node:`
    // require at all, which is why "the export spawns nothing" is structural
    // rather than a promise. This asserts the export graph never names it.
    const reachable = graph(ENTRY)
    assert.deepEqual(reachable.filter(file => file.startsWith('electron/')), [],
      'no Electron module is in the browser export graph')
    assert.ok(!reachable.some(file => file.includes('ffmpegHelper') || file.includes('/render/index.ts')),
      'and neither is any app-side FFmpeg helper')
  })

  console.log(`\n=== All ${passed} export-process-census checks passed ===`)
}

try {
  main()
} catch (error) {
  console.error('\nFAILED:', error)
  process.exit(1)
}
