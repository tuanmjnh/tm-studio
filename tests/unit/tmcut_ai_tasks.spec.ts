/**
 * R130 — AI task registry spec (docs §194).
 * Pure module tests: plan prompt/parse contract + triage prompt/build/parse.
 * Run: pnpm test:tmcut (or tsx --tsconfig tsconfig.test.json directly).
 */
import assert from 'node:assert/strict'
import {
  planSystemPrompt,
  planUserMessage,
  parsePlanScript,
  buildTriageSpans,
  triageSystemPrompt,
  triageUserMessage,
  parseTriageItems,
  AI_TASK_META,
  type AiTriageSpan
} from '../../app/utils/tmcut/aiTasks'
import { localRowsToCatalog, mergeRelayCatalog, type RelayConnectionLike } from '../../app/utils/tmcut/aiLocalCatalog'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  console.log(`   ${name} PASSED`)
  passed += 1
}

const planCtx = {
  prompt: 'review công nghệ',
  platform: 'tiktok-shorts' as const,
  duration: '60s' as const,
  targetSec: 60,
  language: 'vi' as const
}

check('plan prompt carries language, duration and platform', () => {
  const sp = planSystemPrompt(planCtx)
  assert.ok(sp.includes('Vietnamese'))
  assert.ok(sp.includes('60 seconds'))
  assert.ok(sp.includes('"platform": "tiktok-shorts"'))
  assert.ok(planUserMessage(planCtx).includes('review công nghệ'))
  assert.ok(planSystemPrompt({ ...planCtx, language: 'en' }).includes('English'))
})

check('parsePlanScript normalizes a valid answer', () => {
  const content = JSON.stringify({
    title: 'Review tai nghe',
    synopsis: 'sum',
    scenes: [
      { title: 'Hook', durationSec: 5, voiceover: 'a', onScreenText: 'A' },
      { id: 'x', order: 9, title: 'Body', durationSec: 999, voiceover: 'b', onScreenText: 'B' }
    ]
  })
  const script = parsePlanScript(content, planCtx)
  assert.equal(script.title, 'Review tai nghe')
  assert.equal(script.scenes.length, 2)
  assert.equal(script.scenes[0]!.id, 'scene-1')
  assert.equal(script.scenes[0]!.order, 1)
  // Out-of-range durations clamp to [1, 120]; ids fall back positionally.
  assert.ok(script.scenes[1]!.durationSec <= 120)
  assert.equal(script.scenes[1]!.id, 'x')
  assert.equal(script.platform, 'tiktok-shorts')
  assert.equal(script.targetDurationSec, 60)
})

check('parsePlanScript refuses garbage instead of fabricating', () => {
  assert.throws(() => parsePlanScript('not json', planCtx))
  assert.throws(() => parsePlanScript('{"scenes":[]}', planCtx))
  assert.throws(() => parsePlanScript('{}', planCtx))
  assert.throws(() => parsePlanScript('{"scenes":"nope"}', planCtx))
})

check('parsePlanScript unwraps a fenced or prose-wrapped answer', () => {
  const payload = JSON.stringify({
    title: 'Review tai nghe',
    scenes: [{ title: 'Hook', durationSec: 5, voiceover: 'a', onScreenText: 'A' }]
  })
  // Observed live: Gemini 3.5 Flash answers with a ```json block even when the
  // system prompt forbids fences, so a strict JSON.parse rejected a good script.
  const fenced = parsePlanScript('```json\n' + payload + '\n```', planCtx)
  assert.equal(fenced.title, 'Review tai nghe')
  assert.equal(fenced.scenes.length, 1)
  const bare = parsePlanScript('```\n' + payload + '\n```', planCtx)
  assert.equal(bare.scenes.length, 1)
  const prose = parsePlanScript('Here is your script:\n' + payload + '\nEnjoy!', planCtx)
  assert.equal(prose.scenes.length, 1)
  // A fenced block with no usable scenes still has to fail.
  assert.throws(() => parsePlanScript('```json\n{"scenes":[]}\n```', planCtx))
})

const spans: AiTriageSpan[] = [
  { start: 0, end: 4, text: 'mở đầu hay' },
  { start: 4, end: 9, text: 'ừm ờ linh tinh' },
  { start: 9, end: 15, text: 'ý chính quan trọng' }
]

check('buildTriageSpans keeps short transcripts verbatim', () => {
  assert.deepEqual(buildTriageSpans(spans), spans)
  assert.deepEqual(buildTriageSpans([{ start: 5, end: 1 }]), [])
})

check('buildTriageSpans caps long transcripts (head kept, budget-bounded)', () => {
  const big: AiTriageSpan[] = Array.from({ length: 4000 }, (_, i) => ({
    start: i,
    end: i + 1,
    text: `line ${i} ${'x'.repeat(30)}`
  }))
  const capped = buildTriageSpans(big)
  assert.ok(capped.length < big.length)
  assert.ok(capped.length > 10)
  // The kept spans come from the ORIGINAL list in original order.
  const firstIdx = big.findIndex(s => s.start === capped[0]!.start)
  assert.equal(firstIdx, 0)
})

check('triage prompt is honest about what it rates', () => {
  const sys = triageSystemPrompt()
  assert.ok(sys.includes('{"items":[{"i":0,"interest":0.8},...]}'))
  const msg = triageUserMessage(spans, false)
  assert.ok(msg.includes('[0] 0.0-4.0 "mở đầu hay"'))
  assert.ok(!msg.includes('Only part'))
  assert.ok(triageUserMessage(spans, true).includes('rate only the spans above'))
})

check('parseTriageItems resolves index form and clamps interest', () => {
  const items = parseTriageItems(
    JSON.stringify({ items: [{ i: 0, interest: 0.9 }, { i: 2, interest: 1.7 }, { i: 9, interest: 0.5 }] }),
    spans,
    15
  )
  // i=9 is out of range → dropped; 1.7 clamps to 1.
  assert.deepEqual(items, [
    { start: 0, end: 4, interest: 0.9 },
    { start: 9, end: 15, interest: 1 }
  ])
})

check('parseTriageItems accepts bare arrays and direct spans, rejects junk', () => {
  const ok = parseTriageItems(
    JSON.stringify([
      { start: 1, end: 3, interest: 0.4 },
      { start: 11, end: 40, interest: 0.2 }, // end beyond duration → clamped
      { start: 5, end: 4, interest: 0.5 }, // inverted → dropped
      { interest: 0.5 }, // no geometry → dropped
      'nope', // not an object → dropped
      { i: 1, interest: 'x' } // NaN interest → dropped
    ]),
    spans,
    15
  )
  assert.deepEqual(ok, [
    { start: 1, end: 3, interest: 0.4 },
    { start: 11, end: 15, interest: 0.2 }
  ])
  assert.deepEqual(parseTriageItems('broken {', spans, 15), [])
  assert.deepEqual(parseTriageItems('{"items":"x"}', spans, 15), [])
  // Same fence tolerance as the plan parser: a wrapped answer is still an answer.
  const fenced = parseTriageItems('```json\n{"items":[{"i":2,"interest":0.7}]}\n```', spans, 15)
  assert.deepEqual(fenced, [{ start: 9, end: 15, interest: 0.7 }])
})

check('parseTriageItems de-duplicates overlapping reports', () => {
  const ok = parseTriageItems(
    JSON.stringify({ items: [{ i: 0, interest: 0.3 }, { i: 0, interest: 0.8 }] }),
    spans,
    15
  )
  assert.equal(ok.length, 1)
  assert.equal(ok[0]!.interest, 0.8) // max wins, never averaged away
})

check('registry metadata matches the gateway task ids', () => {
  assert.deepEqual(Object.keys(AI_TASK_META).sort(), ['plan', 'transcribe', 'triage'])
  assert.equal(AI_TASK_META.triage.jsonMode, true)
  assert.equal(AI_TASK_META.transcribe.jsonMode, false)
  for (const meta of Object.values(AI_TASK_META)) {
    assert.ok(meta.labelKey.startsWith('tmcut.'))
    assert.ok(meta.icon.startsWith('i-lucide-'))
  }
})

// =============================================================================
//  Task 17 — app-local connection catalogue (app/utils/tmcut/aiLocalCatalog)
// =============================================================================

const labRow = {
  connectionId: 'lab',
  providerKey: 'freemodel',
  baseUrl: 'http://127.0.0.1:31415/v1',
  hasKey: true,
  enabled: true,
  models: [
    { modelId: 'auto', enabled: true },
    { modelId: 'smart', enabled: true, isPrimary: true },
    { modelId: 'off', enabled: false }
  ]
}

function hubConn(over: Partial<RelayConnectionLike> = {}): RelayConnectionLike {
  return {
    connectionId: 'hub-1',
    provider: 'google_ai',
    name: 'Hub Google',
    adapterType: 'openai-compatible',
    origin: 'own',
    hasKey: true,
    model: 'gemini-x',
    models: [{ modelId: 'gemini-x', displayName: 'Gemini X' }],
    ...over
  }
}

check('local rows become catalogue connections defaulting to the primary model', () => {
  const catalog = localRowsToCatalog([labRow, { ...labRow, connectionId: 'off-conn', enabled: false }, { ...labRow, connectionId: 'empty', models: [{ modelId: 'off-only', enabled: false }] }])
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0]!.connectionId, 'lab')
  assert.equal(catalog[0]!.model, 'smart')
  assert.deepEqual(catalog[0]!.models.map(model => model.modelId), ['auto', 'smart'])
})

check('merging keeps app rows first and preserves their models', () => {
  const merged = mergeRelayCatalog([hubConn()], localRowsToCatalog([labRow]))
  assert.deepEqual(merged.map(conn => conn.connectionId), ['app:lab', 'hub-1'])
  assert.equal(merged[0]!.models.length, 2)
  assert.equal(merged[0]!.models.find(model => model.isPrimary)?.modelId, 'smart')
  assert.equal(merged[0]!.origin, 'own')
  assert.equal(merged[0]!.hasKey, true)
  assert.equal(merged[0]!.model, 'smart')
})

check('an identical provider and model keeps the app row and hides the hub twin', () => {
  const hub = hubConn({ provider: 'freemodel', models: [{ modelId: 'auto', displayName: 'Auto' }, { modelId: 'hub-only', displayName: 'Hub Only' }] })
  const merged = mergeRelayCatalog([hub], localRowsToCatalog([labRow]))
  assert.deepEqual(merged[0]!.models.map(model => model.modelId), ['auto', 'smart'])
  assert.deepEqual(merged[1]!.models.map(model => model.modelId), ['hub-only'])
})

console.log(`\n=== All ${passed} AI-task-registry checks passed ===`)
