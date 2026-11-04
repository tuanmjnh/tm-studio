/**
 * The project schema lock (owner decision Q5, 2026-11-04).
 *
 * The repo ships TWO project shapes and both are real:
 *  - the app file, written by `useTmcutProject` to localStorage and to the
 *    Electron JSON file: `schemaVersion: 3` with a flat
 *    `timeline { version, tracks, durationMs, markers }`;
 *  - the core normalized project from `createProject()`: `version: 3` with a
 *    DSL `timeline { version: 3, tracks, markers }`.
 *
 * The browser-first plan drafted a third shape, `TMCutProject { schemaVersion,
 * tracks, sequences }`. That field exists in no shipped file, and the owner
 * ruled it out until a real functional requirement appears: turning
 * `timeline.tracks` into `tracks` plus `sequences` is a migration, not a
 * rename, and it would invalidate every project on disk. This spec is the
 * guard rail for that ruling — the shape constants, the absence of
 * `sequences`, and the one place that reads `timeline.version`.
 *
 * Migration behaviour itself (seconds file scaled once, re-stamped, never
 * scaled twice) is already pinned by tmcut_store_behaviour spec around its
 * "legacy seconds file" case; this file does not repeat it. What it pins is
 * the SHAPE, so a docs change or a new field cannot silently redefine v3.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import './helpers/tmcut_store_env'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** Shipped code only. Specs must be allowed to name the field they forbid. */
const CODE_DIRS = ['app', 'server', 'shared', 'electron', 'packages/core/src', 'packages/core/types']
const CODE_EXT = /\.(ts|mts|cts|js|mjs|cjs|vue)$/

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.nuxt' || entry.name === 'dist') continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (CODE_EXT.test(entry.name) && statSync(join(ROOT, rel)).isFile()) out.push(rel)
  }
  return out
}

/** Every key name appearing anywhere in a nested plain object. */
function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, out)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.add(key)
      deepKeys(child, out)
    }
  }
  return out
}

describe('project schema v3 (app file)', () => {
  it('stamps schema 3 and keeps the stamp as the only version oracle', async () => {
    const mod = await import('../../app/composables/useTmcutProject')
    assert.equal(mod.TMCUT_PROJECT_SCHEMA_VERSION, 3, 'v3 is the shipped schema; changing it is a migration')
    const src = read('app/composables/useTmcutProject.ts')
    assert.match(
      src,
      /const isLegacy = \(project\.schemaVersion \?\? 1\) < TMCUT_PROJECT_SCHEMA_VERSION/,
      'the stamp is the only scale oracle: an absent stamp means legacy'
    )
    assert.match(src, /project\.schemaVersion = TMCUT_PROJECT_SCHEMA_VERSION/, 'the restamp writes the same constant it read')
  })

  it('persists exactly the shipped top-level shape', async () => {
    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const store = useTmcutProject()
    const project = store.createProject(`schema-lock-${Math.random().toString(36).slice(2, 8)}`)
    store.saveProject()
    const stored = JSON.parse(localStorage.getItem(`tmcut_project_${project.id}`)!)
    assert.equal(stored.schemaVersion, 3, 'a new file is stamped v3')
    assert.deepEqual(
      Object.keys(stored).sort(),
      ['canvas', 'cover', 'created_at', 'durationMs', 'id', 'name', 'revision', 'schemaVersion', 'settings', 'source', 'timeline', 'updated_at'],
      'top-level keys changed: a new field must be optional and defaults-preserving'
    )
    assert.ok(!('sequences' in stored), 'the plan-only sequences field must not reach disk')
  })

  it('keeps tracks flat inside timeline and labels the container version 1', async () => {
    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const store = useTmcutProject()
    const project = store.createProject(`schema-lock-tl-${Math.random().toString(36).slice(2, 8)}`)
    store.saveProject()
    const stored = JSON.parse(localStorage.getItem(`tmcut_project_${project.id}`)!)
    assert.deepEqual(Object.keys(stored.timeline).sort(), ['durationMs', 'markers', 'tracks', 'version'])
    assert.equal(stored.timeline.version, 1, 'the container label is legacy; the DSL version is core-side')
    assert.ok(Array.isArray(stored.timeline.tracks), 'tracks stay flat on the timeline')
    assert.deepEqual(
      stored.timeline.tracks.map((t: { id: string }) => t.id),
      ['t-text-1', 't-video-1', 't-audio-1'],
      'the three default tracks are part of the contract'
    )
    assert.ok(Array.isArray(stored.timeline.markers), 'markers is always an array (pre-B5 files backfill it)')
  })
})

describe('project schema v3 (core DSL)', () => {
  it('creates a v3 project whose timeline validates', async () => {
    const core = await import('tmcut-core')
    const project = core.createProject('schema lock')
    assert.equal(project.version, 3)
    assert.deepEqual(Object.keys(project).sort(), ['canvas', 'project', 'timeline', 'version'])
    assert.equal(project.timeline.version, 3, 'the DSL is version 3, not the app container label')
    assert.deepEqual(Object.keys(project.timeline).sort(), ['markers', 'tracks', 'version'])
    assert.deepEqual(core.validateTimeline(project.timeline), [], 'the default timeline is legal')
    assert.ok(!deepKeys(project).has('sequences'), 'core has no sequences key either')
  })

  it('rejects a timeline whose DSL version is not 3', async () => {
    const core = await import('tmcut-core')
    const errors = core.validateTimeline({ version: 1, tracks: [], markers: [] })
    assert.deepEqual(errors, ['unsupported timeline version: 1'])
  })
})

describe('the plan-only sequences shape', () => {
  it('exists in no shipped file', () => {
    const hits: string[] = []
    for (const dir of CODE_DIRS) {
      for (const rel of walk(dir)) {
        const src = read(rel)
        src.split('\n').forEach((line, index) => {
          if (/\bsequences\b/.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`)
        })
      }
    }
    assert.deepEqual(hits, [], `sequences appeared in shipped code: ${hits.join(' | ')}`)
  })

  it('is read as a version only by the core DSL validator', () => {
    const readers: string[] = []
    for (const dir of CODE_DIRS) {
      for (const rel of walk(dir)) {
        read(rel).split('\n').forEach((line, index) => {
          if (/timeline\??\.version/.test(line)) readers.push(`${rel}:${index + 1}`)
        })
      }
    }
    assert.deepEqual(readers, ['packages/core/src/timeline.mjs:344'], 'the app file container label must stay unread')
  })
})
