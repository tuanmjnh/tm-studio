// Roadmap v3 §26 (local scope) — takedown notices: parse, merge, gate,
// audit. The registry is hostile input (a catalog payload), so malformed
// data must degrade to "no notices", never throw.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTakedownNotice,
  parseTakedownRegistry,
  mergeTakedownRegistry,
  findActiveTakedown,
  canServeAfterTakedown,
  takedownAudit
} from '../src/index.mjs'

const notice = { notices: [{ entryId: 'beat-1', reason: 'license-revoked', ref: 'R-1', issuedAt: '2026-01-01T00:00:00Z' }] }
const NOW = Date.parse('2026-06-01T00:00:00Z')

test('normalizeTakedownNotice keeps usable notices, drops junk', () => {
  const ok = normalizeTakedownNotice({ entryId: ' beat-1 ', reason: 'license-revoked', ref: 'R-1', issuedAt: '2026-01-01T00:00:00Z' })
  assert.equal(ok.entryId, 'beat-1')
  assert.equal(ok.effectiveFrom, Date.parse('2026-01-01T00:00:00Z'))
  assert.equal(normalizeTakedownNotice(null), null)
  assert.equal(normalizeTakedownNotice({}), null)
  // unknown reason still blocks, kept verbatim-safe as policy-violation
  assert.equal(normalizeTakedownNotice({ entryId: 'x', reason: 'weird' }).reason, 'policy-violation')
})

test('parseTakedownRegistry survives malformed payloads', () => {
  assert.deepEqual(parseTakedownRegistry('not json').notices, [])
  assert.deepEqual(parseTakedownRegistry(null).notices, [])
  assert.deepEqual(parseTakedownRegistry({ notices: 'nope' }).notices, [])
  const reg = parseTakedownRegistry(JSON.stringify(notice))
  assert.equal(reg.notices.length, 1)
  // duplicate entryIds collapse to the first
  const dup = parseTakedownRegistry({ notices: [reg.notices[0], { ...reg.notices[0], ref: 'R-2' }] })
  assert.equal(dup.notices.length, 1)
  assert.equal(dup.notices[0].ref, 'R-1')
})

test('merge: latest catalog update wins per entry', () => {
  const base = parseTakedownRegistry(notice)
  const incoming = { notices: [{ entryId: 'beat-1', reason: 'recall', ref: 'R-9', issuedAt: '2026-02-01T00:00:00Z' }] }
  const merged = mergeTakedownRegistry(base, incoming)
  assert.equal(merged.notices.length, 1)
  assert.equal(merged.notices[0].ref, 'R-9')
})

test('takedown blocks install even with an approved license; future notices wait', () => {
  const reg = parseTakedownRegistry(notice)
  const gated = canServeAfterTakedown(reg, 'beat-1', { now: NOW })
  assert.equal(gated.allowed, false)
  assert.equal(gated.reason, 'takedown-license-revoked')
  // not yet effective -> allowed
  const future = parseTakedownRegistry({ notices: [{ entryId: 'x', issuedAt: '2027-01-01T00:00:00Z' }] })
  assert.equal(canServeAfterTakedown(future, 'x', { now: NOW }).allowed, true)
  // other entries unaffected
  assert.equal(canServeAfterTakedown(reg, 'other', { now: NOW }).allowed, true)
})

test('audit reports installed copies under an active takedown, deletes nothing', () => {
  const reg = parseTakedownRegistry(notice)
  const installed = [
    { entryId: 'beat-1', state: 'installed' },
    { entryId: 'safe-1', state: 'installed' },
    null
  ]
  const affected = takedownAudit(installed, reg, { now: NOW })
  assert.equal(affected.length, 1)
  assert.equal(affected[0].entryId, 'beat-1')
  assert.equal(affected[0].notice.ref, 'R-1')
  // the registry itself is untouched
  assert.equal(installed.length, 3)
})
