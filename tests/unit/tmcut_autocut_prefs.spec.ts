/**
 * R136 specs — AutoCut wizard prefs (docs §200).
 * Pure util (app/utils/tmcut/autocutPrefs.ts), plain Node, like the
 * other pure specs. Also pins the CONTRACT against both consumers:
 * autocut.vue (key + import names + no-hard-default drift) and core
 * scoreSegments (the 0.5 ceiling must stay shared across all three).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreSegments } from '@tmcut-core'
import {
  AUTOCUT_PREFS_KEY,
  AUTOCUT_PREFS_DEFAULT,
  AUTOCUT_AI_WEIGHT_DEFAULT,
  AUTOCUT_AI_WEIGHT_MAX,
  AUTOCUT_PROFILES,
  parseAutocutPrefs,
  serializeAutocutPrefs,
  splitKeywords,
  joinKeywords
} from '../../app/utils/tmcut/autocutPrefs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('TMCut AutoCut prefs — sanitizer (R136)', () => {
  it('null/empty/garbage all fall back to identical defaults', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"str"', '42']) {
      assert.deepEqual(parseAutocutPrefs(raw as never), AUTOCUT_PREFS_DEFAULT, `raw=${raw}`)
    }
    assert.deepEqual(parseAutocutPrefs('{}'), AUTOCUT_PREFS_DEFAULT)
  })

  it('round-trips a full valid prefs object exactly', () => {
    const prefs = {
      profile: 'cinematic-vlog' as const,
      filterFillerWords: false,
      aiAnalysis: true,
      aiWeight: 0.4,
      keywordsText: 'bí quyết, quan trọng'
    }
    assert.deepEqual(parseAutocutPrefs(serializeAutocutPrefs(prefs)), prefs)
  })

  it('sanitizes each field independently — one corrupt field never discards the rest', () => {
    const parsed = parseAutocutPrefs(JSON.stringify({
      profile: 'evil-profile',
      filterFillerWords: 'yes',
      aiAnalysis: 'on',
      aiWeight: 99,
      keywordsText: { nope: true }
    }))
    assert.deepEqual(parsed, {
      profile: AUTOCUT_PREFS_DEFAULT.profile,
      filterFillerWords: true, // truthy-string is NOT a boolean → default
      aiAnalysis: false,
      aiWeight: AUTOCUT_AI_WEIGHT_MAX, // 99 clamped to the shared ceiling
      keywordsText: ''
    })
  })

  it('clamps negative weight to 0 and keeps valid steps', () => {
    assert.equal(parseAutocutPrefs('{"aiWeight":-3}').aiWeight, 0)
    assert.equal(parseAutocutPrefs('{"aiWeight":0.35}').aiWeight, 0.35)
    // "0.35" as a JSON string number coerces (input[type=text] heritage)
    assert.equal(parseAutocutPrefs('{"aiWeight":"0.1"}').aiWeight, 0.1)
    assert.equal(parseAutocutPrefs('{"aiWeight":"abc"}').aiWeight, AUTOCUT_AI_WEIGHT_DEFAULT)
  })

  it('serialize always emits sanitizer-clean JSON', () => {
    const dirty = serializeAutocutPrefs({
      profile: 'nope' as never,
      filterFillerWords: 1 as never,
      aiAnalysis: true,
      aiWeight: 7,
      keywordsText: 'ok'
    })
    assert.deepEqual(parseAutocutPrefs(dirty), {
      ...AUTOCUT_PREFS_DEFAULT,
      aiAnalysis: true,
      aiWeight: AUTOCUT_AI_WEIGHT_MAX,
      keywordsText: 'ok'
    })
  })
})

describe('TMCut AutoCut prefs — cross-file contracts (R136)', () => {
  it('weight ceiling equals the core scoreSegments ceiling (0.5, no drift)', () => {
    assert.equal(AUTOCUT_AI_WEIGHT_MAX, 0.5)
    assert.equal(AUTOCUT_AI_WEIGHT_DEFAULT, 0.25)
    // Behavioural half: a stored 0.5 still cannot out-pull core —
    // weight 0.5 scores strictly below pure-AI (1.0) on identical input.
    const input = {
      assetId: 'asset_prefs_ceiling',
      profile: 'viral-shorts',
      scenes: [{ start: 0, end: 8 }],
      silences: [],
      transcript: [{ start: 0, end: 8, text: 'Đăng ký kênh để nhận thông báo mới' }],
      aiScores: [{ start: 0, end: 8, interest: 1 }],
      aiWeight: AUTOCUT_AI_WEIGHT_MAX
    } as never
    const edl = scoreSegments(input)
    assert.ok(edl.segments[0].score < 1)
  })

  it('profile set matches what autocut.vue renders (no ghost profiles)', () => {
    const page = readFileSync(join(ROOT, 'app/pages/tmcut/autocut.vue'), 'utf8')
    for (const id of AUTOCUT_PROFILES) {
      assert.ok(page.includes(`id: '${id}'`), `page lost profile card ${id}`)
    }
    // And the watcher really persists under the shared key.
    assert.ok(page.includes('AUTOCUT_PREFS_KEY'), 'page stopped using the prefs key')
    assert.ok(page.includes('serializeAutocutPrefs'), 'page stopped serializing prefs')
    assert.ok(page.includes('parseAutocutPrefs'), 'page stopped parsing prefs')
    // The stored key is a contract with the browser profile: pin the
    // exact value (renaming it silently orphans existing users' prefs).
    assert.equal(AUTOCUT_PREFS_KEY, 'tmcut_autocut_prefs_v1')
  })
})

describe('TMCut AutoCut keyword chips — token helpers (R137)', () => {
  it('splits, trims and drops empty tokens', () => {
    assert.deepEqual(splitKeywords(' hook , summary ,, conclusion '), ['hook', 'summary', 'conclusion'])
    assert.deepEqual(splitKeywords(''), [])
    assert.deepEqual(splitKeywords(' , , '), [])
  })

  it('dedups case-insensitively, keeping the FIRST spelling', () => {
    assert.deepEqual(splitKeywords('Hook, hook, hooks'), ['Hook', 'hooks'])
  })

  it('join is the canonical inverse (single separator, deduped)', () => {
    assert.equal(joinKeywords(['hook', 'summary']), 'hook, summary')
    assert.equal(joinKeywords(['a', 'A', 'a']), 'a')
    // Round-trip through the persisted comma string is stable.
    const once = joinKeywords(['a', 'b', 'b'])
    assert.deepEqual(splitKeywords(once), ['a', 'b'])
  })
})
