/**
 * AI script orchestration (`app/composables/useTmcutAiScript.ts`).
 *
 * `tmcut_ai_script.spec.ts` pins the pure helpers; this spec pins the flow the
 * editor button actually runs:
 *  - no usable gateway → a curated preset re-timed to the duration the user
 *    asked for (a 15s request must not yield a 30s storyboard), no error;
 *  - a working relay → the task-registry prompt, JSON-mode nudge and
 *    reasoning headroom reach the request, and the parsed answer is returned;
 *  - a failing relay → the curated fallback AND the error message (the UI has
 *    to be able to say why it degraded);
 *  - a script becomes a project with one text clip per scene, sequential
 *    offsets, and a canvas matched to the target platform.
 *
 * Run with the store shim so Vue auto-imports and localStorage exist in Node.
 */
import './helpers/tmcut_store_env'
import assert from 'node:assert/strict'
import { secToTicks } from 'tmcut-core'
import { CURATED_SCRIPT_PRESETS, fitScenesToDuration, type TmcutAiScript } from '../../app/utils/tmcut/aiScript'

type FetchOptions = { method?: string, body?: { messages?: Array<{ role: string, content: string }>, model?: string, maxTokens?: number }, timeout?: number }
type FetchCall = { url: string, options: FetchOptions }

const globalScope = globalThis as Record<string, unknown>
let calls: FetchCall[] = []
let chatReply: 'ok' | 'fail' = 'ok'
let catalogAvailable = true

const CATALOG = {
  success: true,
  data: {
    connections: [{
      connectionId: 'c-openai',
      provider: 'openai',
      name: 'openai-main',
      adapterType: 'openai_compatible',
      origin: 'own',
      hasKey: true,
      model: 'gpt-4o-mini',
      models: [{ modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', isPrimary: true }]
    }]
  }
}

const AI_ANSWER = {
  title: 'Review tai nghe không dây',
  synopsis: 'Đánh giá nhanh trong 30 giây.',
  scenes: [
    { title: 'Hook', durationSec: 5, visualPrompt: 'Cận cảnh hộp', voiceover: 'Mở hộp nào', onScreenText: 'MỞ HỘP' },
    { title: 'Chất âm', durationSec: 15, visualPrompt: 'Đeo thử', voiceover: 'Bass rất sâu', onScreenText: 'BASS SÂU' },
    { title: 'Kết', durationSec: 10, visualPrompt: 'Sản phẩm trên kệ', voiceover: 'Đáng mua nhé', onScreenText: '8.5/10' }
  ]
}

globalScope.$fetch = async (url: string, options: FetchOptions = {}) => {
  calls.push({ url: String(url), options })
  if (String(url).includes('/relay/catalog')) {
    if (!catalogAvailable) throw new Error('hub offline')
    return CATALOG
  }
  if (String(url).includes('/relay/chat')) {
    if (chatReply === 'fail') throw new Error('provider timed out')
    return {
      success: true,
      data: {
        ok: true,
        content: JSON.stringify(AI_ANSWER),
        provider: 'openai',
        model: options.body?.model || '',
        usage: null
      }
    }
  }
  throw new Error(`unexpected fetch ${url}`)
}

let passed = 0

async function check(name: string, fn: () => void | Promise<void>) {
  calls = []
  await fn()
  passed++
  console.log(`  ${name} PASSED`)
}

const yogaScript: TmcutAiScript = {
  title: 'Morning Yoga',
  synopsis: 'Bài tập 20 giây.',
  platform: 'youtube-explainer',
  targetDurationSec: 20,
  createdAt: '2026-10-12T00:00:00.000Z',
  scenes: [
    { id: 'a', order: 1, title: 'Hook', durationSec: 5, visualPrompt: 'v1', voiceover: 'v', onScreenText: 'BẮT ĐẦU' },
    { id: 'b', order: 2, title: 'Thân', durationSec: 10, visualPrompt: 'v2', voiceover: 'v', onScreenText: 'GIỮ NHỊP' },
    { id: 'c', order: 3, title: 'Kết', durationSec: 5, visualPrompt: 'v3', voiceover: 'v', onScreenText: 'NGHỈ NGƠI' }
  ]
}

async function main() {
  console.log('=== [TMCut AI script flow] Starting tests ===\n')

  await check('fitScenesToDuration hits the requested total without mutating the preset', () => {
    const source = CURATED_SCRIPT_PRESETS[0]!.scenes
    const before = source.map(scene => scene.durationSec)
    const fitted = fitScenesToDuration(source, 15)
    assert.equal(fitted.reduce((acc, scene) => acc + scene.durationSec, 0), 15)
    assert.deepEqual(source.map(scene => scene.durationSec), before, 'the preset must stay untouched')
    assert.ok(fitted.every(scene => scene.durationSec >= 1), 'no scene may collapse to zero')
    assert.equal(fitted.length, source.length)
    // Already on target → durations are preserved as-is.
    const sixty = fitScenesToDuration(CURATED_SCRIPT_PRESETS[1]!.scenes, 60)
    assert.deepEqual(sixty.map(scene => scene.durationSec), CURATED_SCRIPT_PRESETS[1]!.scenes.map(scene => scene.durationSec))
    assert.deepEqual(fitScenesToDuration([], 30), [])
  })

  const { useTmcutAiScript } = await import('../../app/composables/useTmcutAiScript')
  const api = useTmcutAiScript()

  await check('no usable gateway → curated preset, re-timed, and no error', async () => {
    catalogAvailable = false
    const script = await api.generateScript({
      prompt: 'mẹo code sạch',
      platform: 'tiktok-shorts',
      duration: '15s'
    })
    assert.equal(script.title, 'Kịch bản: mẹo code sạch')
    assert.equal(script.platform, 'tiktok-shorts')
    assert.equal(script.targetDurationSec, 15)
    assert.equal(script.scenes.reduce((acc, scene) => acc + scene.durationSec, 0), 15)
    assert.equal(api.error.value, null)
    // `ref` wraps plain objects in a reactive proxy, so compare content.
    assert.equal(api.generatedScript.value?.title, script.title)
    assert.equal(api.generating.value, false)
    assert.equal(calls.some(call => call.url.includes('/relay/chat')), false, 'no key → no chat call')
    catalogAvailable = true
  })

  await check('a working relay gets the registry prompt, JSON nudge and reasoning headroom', async () => {
    chatReply = 'ok'
    const script = await api.generateScript({
      prompt: 'review tai nghe',
      platform: 'tiktok-shorts',
      duration: '30s'
    })
    assert.equal(script.title, AI_ANSWER.title)
    assert.equal(script.scenes.length, 3)
    assert.equal(script.targetDurationSec, 30)
    assert.equal(api.error.value, null)

    const chat = calls.find(call => call.url.includes('/relay/chat'))
    assert.ok(chat, 'no chat call recorded')
    const body = chat.options.body as NonNullable<FetchOptions['body']>
    assert.equal(body.model, 'gpt-4o-mini')
    assert.equal(body.maxTokens, 2048)
    assert.ok(body.messages!.some(m => m.role === 'system' && m.content.includes('valid raw JSON')), 'jsonMode nudge missing')
    assert.ok(body.messages!.some(m => m.content.includes('"platform": "tiktok-shorts"')), 'task prompt missing platform')
    assert.ok(body.messages!.some(m => m.content.includes('review tai nghe')), 'user prompt missing')
  })

  await check('a failing relay degrades to the curated preset and reports why', async () => {
    chatReply = 'fail'
    const script = await api.generateScript({
      prompt: 'review tai nghe',
      platform: 'tiktok-shorts',
      duration: '30s'
    })
    assert.equal(script.title, 'Kịch bản: review tai nghe')
    assert.equal(script.scenes.reduce((acc, scene) => acc + scene.durationSec, 0), 30)
    assert.equal(api.error.value, 'provider timed out')
    assert.equal(api.hasAiKey.value, true)
    chatReply = 'ok'
  })

  await check('a script becomes a 9:16 project with one text clip per scene', async () => {
    const project = api.createProjectFromScript(yogaScript)
    assert.equal(project.name, 'Morning Yoga')
    assert.equal(project.canvas.width, 1920)
    assert.equal(project.canvas.height, 1080)

    const textTrack = project.timeline.tracks.find(track => track.type === 'text')!
    assert.equal(textTrack.items!.length, yogaScript.scenes.length)
    assert.deepEqual(
      textTrack.items!.map(item => item.text),
      ['BẮT ĐẦU', 'GIỮ NHỊP', 'NGHỈ NGƠI']
    )
    assert.deepEqual(
      textTrack.items!.map(item => item.offset),
      [0, secToTicks(5), secToTicks(15)].map(Math.round)
    )
    for (const [index, item] of textTrack.items!.entries()) {
      const scene = yogaScript.scenes[index]!
      assert.equal(item.out! - item.in!, secToTicks(scene.durationSec))
    }
    assert.ok(textTrack.items!.every(item => item.fontSize === 44), 'horizontal platform uses the 44px label')
  })

  await check('the same script on TikTok uses the vertical canvas and larger text', async () => {
    const vertical: TmcutAiScript = { ...yogaScript, platform: 'tiktok-shorts' }
    const project = api.createProjectFromScript(vertical)
    assert.equal(project.canvas.width, 1080)
    assert.equal(project.canvas.height, 1920)
    const textTrack = project.timeline.tracks.find(track => track.type === 'text')!
    assert.ok(textTrack.items!.every(item => item.fontSize === 52))
  })

  await check('insertScriptToCurrentTimeline appends clips from the given start offset', async () => {
    api.createProjectFromScript(yogaScript)
    assert.equal(api.insertScriptToCurrentTimeline(yogaScript, 5), yogaScript.scenes.length)

    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const current = useTmcutProject().currentProject.value!
    const textTrack = current.timeline.tracks.find(track => track.type === 'text')!
    // 5s start + the script's own 5/10/5 scene durations → offsets 5, 10, 20.
    const offsets = textTrack.items!.slice(-yogaScript.scenes.length).map(item => item.offset)
    assert.deepEqual(offsets, [secToTicks(5), secToTicks(10), secToTicks(20)].map(Math.round))
  })

  console.log(`\n=== All ${passed} AI-script flow checks passed ===`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
