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
    // The reverse direction mattered while both paths existed. Slice I deleted
    // the compiler with the queue, so the names above are now proof of absence:
    // a file that came back would fail the reachability check, not pass it.
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

  // 4. There is exactly one writer. The desktop queue and the server render
  //    route were deleted with the engine (slice I), so the modal cannot fall
  //    through to a second path even if someone re-adds a button.
  check('the modal has one writer and no fall-through path', () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.match(modal, /await runWebExport()/, 'the browser exporter is the export')
    assert.doesNotMatch(modal, /enqueueJob|useToolTaskManager|useTmcutExportQueue/,
      'no queue call survives in the modal')
    assert.doesNotMatch(modal, /platform.encoder/, 'and no host encoder is asked')
    assert.equal(existsSync(join(ROOT, 'app/composables/useTmcutExportQueue.ts')), false,
      'the queue module is deleted, not merely unused')
  })

  // 5. Slice I deleted every spawn site this census was written to keep out of
  //    the export. The list below is the assertion now: if one of them comes
  //    back, the zero-spawn claim has to be re-measured rather than re-worded.
  check('the FFmpeg spawn sites are gone from the repo', () => {
    const deleted = [
      'electron/tools/ffmpeg.controller.cjs',
      'electron/tools/task-manager.cjs',
      'app/utils/ffmpegHelper.ts',
      'app/utils/tmcut/compiler.ts',
      'app/utils/tmcut/render/index.ts',
      'server/api/v1/media/render.post.ts',
      'server/api/v1/media/render/[jobId].get.ts',
      'server/utils/htmlVideoRender.ts',
      'server/utils/renderJobs.ts'
    ]
    for (const file of deleted) {
      assert.equal(existsSync(join(ROOT, file)), false, `${file} must be deleted with the engine`)
    }
    // The renderer cannot import a `.cjs` in `electron/`: it has no `node:`
    // require at all, which is why "the export spawns nothing" is structural
    // rather than a promise. This asserts the export graph never names one.
    assert.deepEqual(reachable.filter(file => file.startsWith('electron/')), [],
      'no Electron module is in the browser export graph')
    assert.ok(!reachable.some(file => file.includes('ffmpegHelper') || file.includes('/render/index.ts')),
      'and neither is any app-side FFmpeg helper')
  })

  // 6. `electron-builder.yml` ships `shared/**/*` verbatim, so a dead argv
  //    builder left in that tree is FFmpeg in the release even with no caller.
  //    Slice I deleted both callers (the Electron controller's AutoCut pass and
  //    server/api/v1/media/analyze.post.ts); the file goes with them.
  check('the shipped shared tree carries no FFmpeg argv', () => {
    assert.equal(existsSync(join(ROOT, 'shared/utils/detection-args.cjs')), false,
      'the AutoCut argv builder must be deleted, not merely uncalled')
    const builder = read('electron-builder.yml')
    assert.match(builder, /- shared\/\*\*\/\*/, 'this check only means something while shared/ ships')
  })

  console.log(`\n=== All ${passed} export-process-census checks passed ===`)
}

try {
  main()
} catch (error) {
  console.error('\nFAILED:', error)
  process.exit(1)
}
