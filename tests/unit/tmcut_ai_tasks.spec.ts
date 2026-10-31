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

console.log(`\n=== All ${passed} AI-task-registry checks passed ===`)
