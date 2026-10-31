// Roadmap v3 Phase 8 — audio orchestration: rights-aware ranking, music
// beds, SFX cues, provenance merge. Every produced op flows through the
// SAME validateEditPlan/applyEditPlan path as the AI Editor.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rankAudioCandidates,
  planMusicBed,
  planSfxCues,
  mergeAudioProvenance,
  validateEditPlan,
  applyEditPlan
} from '../src/index.mjs'

const TICK = 120_000

const pool = [
  { mediaRef: 'm-approved', name: 'Approved beat', origin: 'library', licenseStatus: 'approved', licenseName: 'CC-BY', attribution: 'B', durationTicks: 4 * TICK, addedAt: 1 },
  { mediaRef: 'm-review', name: 'Review track', origin: 'library', licenseStatus: 'review', durationTicks: 4 * TICK, addedAt: 2 },
  { mediaRef: 'm-blocked', name: 'Blocked track', origin: 'library', licenseStatus: 'blocked', durationTicks: 4 * TICK, addedAt: 3 },
  { mediaRef: 'm-gen', name: 'Generated', origin: 'generated', licenseStatus: 'approved', durationTicks: 4 * TICK, addedAt: 4 }
]

test('rights-aware ranking: approved before review, blocked dropped, generated opt-in', () => {
  const ranked = rankAudioCandidates(pool)
  assert.deepEqual(ranked.map(c => c.mediaRef), ['m-approved', 'm-review'])
  const withGen = rankAudioCandidates(pool, { allowGenerated: true })
  // approved tier beats review tier, so the generated track (approved) sorts
  // before the review library track.
  assert.deepEqual(withGen.map(c => c.mediaRef), ['m-approved', 'm-gen', 'm-review'])
})

test('music bed repeats until duration and fades the first/last part', () => {
  const { operations, provenance } = planMusicBed(pool, { durationTicks: 3 * TICK, dialoguePresent: true }, {})
  assert.equal(operations.length, 1)
  assert.equal(operations[0].trackType, 'audio')
  assert.equal(operations[0].mediaRef, 'm-approved')
  assert.equal(operations[0].volume, 35) // ducked bed default
  assert.equal(operations[0].fade.in, Math.round(0.75 * TICK))
  assert.equal(provenance[0].role, 'music-bed')
  assert.deepEqual(provenance[0].license, { status: 'approved', name: 'CC-BY', attribution: 'B' })
})

test('no dialogue -> bed at full volume', () => {
  const { operations } = planMusicBed(pool, { durationTicks: 2 * TICK, dialoguePresent: false }, {})
  assert.equal(operations[0].volume, 90)
})

test('bed with no usable candidates yields nothing', () => {
  const { operations } = planMusicBed([{ mediaRef: 'm-blocked', licenseStatus: 'blocked' }], { durationTicks: 2 * TICK }, {})
  assert.deepEqual(operations, [])
})

test('SFX cues are placed at transition boundaries with fade in/out', () => {
  const { operations, provenance, skipped } = planSfxCues(
    pool,
    [{ atTicks: 2 * TICK, name: 'Cut' }, { atTicks: 2.1 * TICK, name: 'Too close' }],
    { durationTicks: 5 * TICK }
  )
  assert.equal(operations.length, 1)
  assert.equal(operations[0].name, 'SFX: Cut')
  assert.equal(operations[0].offset, 2 * TICK)
  assert.equal(operations[0].fade.in, TICK / 4)
  assert.equal(provenance[0].role, 'sfx-cue')
  assert.deepEqual(skipped.map(s => s.name), ['Too close'])
})

test('SFX cue past the timeline end is reported, never placed', () => {
  const { operations, skipped } = planSfxCues(pool, [{ atTicks: 4.5 * TICK, name: 'Late' }], { durationTicks: 5 * TICK })
  assert.deepEqual(operations, [])
  assert.deepEqual(skipped.map(s => s.name), ['Late'])
})

test('orchestrated audio ops pass validateEditPlan and apply', () => {
  const { operations } = planMusicBed(pool, { durationTicks: 2 * TICK, dialoguePresent: true }, {})
  const plan = { schemaVersion: 1, intentSummary: 'music bed', assumptions: [], operations }
  const check = validateEditPlan(plan, { mediaRefs: ['m-approved'] })
  assert.deepEqual(check.errors, [])
  const timeline = { version: 3, tracks: [], markers: [] }
  const trace = applyEditPlan(timeline, plan, { mediaResolution: { 'm-approved': { src: 'C:\\b\\beat.mp3' } } })
  assert.equal(trace.applied.length, 1)
  assert.equal(trace.applied[0].ok, true)
  assert.equal(timeline.tracks[0].items[0].volume, 35)
})

test('provenance merge appends with a stamp', () => {
  const merged = mergeAudioProvenance([{ mediaRef: 'm-approved', role: 'music-bed' }], [{ mediaRef: 'm-approved', role: 'sfx-cue' }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].role, 'music-bed')
  assert.equal(merged[1].role, 'sfx-cue')
  assert.equal(merged[1].via, 'audio-orchestration')
  assert.ok(Number.isFinite(merged[1].addedAt))
})