/**
 * Voice Studio take history.
 *
 * After a take is generated the file already sits in the media library, but the
 * standalone /tmcut/voice page has no media panel: the panel must keep a short
 * history so the user can replay a take and reveal it on disk.
 *
 * Pinned here:
 *  * every generated take is recorded once, newest first, capped at MAX_TAKES,
 *    and persisted to localStorage (no server call);
 *  * replay goes through the shared audio preview modal, not a new player;
 *  * the folder button is desktop-only and hidden for web /uploads paths;
 *  * both locales name every new string.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')

check('a generated take is recorded once, newest first and capped', () => {
  assert.match(body, /const MAX_TAKES = 20/, 'the history has no upper bound')
  assert.match(body, /recordTake\(path, engine\)/, 'importAndPlace never records the take')
  assert.match(
    body,
    /voiceTakes\.value = \[take, \.\.\.voiceTakes\.value\.filter\(item => item\.path !== path\)\]\.slice\(0, MAX_TAKES\)/,
    'regenerating the same file must move it to the top, not duplicate it'
  )
  assert.match(body, /const lastTake = computed\(\(\) => voiceTakes\.value\[0\] \|\| null\)/, 'the strip is not the newest take')
})

check('history is read from and written to localStorage, guarded for SSR', () => {
  assert.match(body, /const TAKES_KEY = 'tmcut_voice_takes'/, 'the history storage key is missing')
  assert.match(body, /localStorage\.getItem\(TAKES_KEY\)/, 'the history is never read back')
  assert.match(body, /localStorage\.setItem\(TAKES_KEY, JSON\.stringify/, 'the history is never persisted')
  assert.match(body, /function readTakes\(\) \{\s*if \(typeof window === 'undefined'\) return/, 'readTakes runs on the server')
  assert.match(body, /readTakes\(\)/, 'onMounted never restores the history')
})

check('replay uses the shared audio modal', () => {
  assert.match(body, /function openTakePreview\(path: string\)/, 'no single entry point for replay')
  assert.match(body, /<LazyToolsVideoPreviewModal/, 'the preview modal is not lazy-loaded')
  assert.match(body, /kind="audio"/, 'the preview does not know it is audio')
  assert.match(body, /:file-path="previewPath"/, 'the preview is not driven by the chosen take')
})

check('the folder button is desktop-only and never offered for web uploads', () => {
  assert.match(body, /function canReveal\(path: string\) \{\s*return isDesktop\.value && !path\.startsWith\('\/uploads\/'\)/, 'canReveal lost its desktop or uploads guard')
  assert.match(body, /tmcutHostBridge\(\)\?\.showItemInFolder\?\.\(path\)/, 'the folder button has no host call')
  assert.match(body, /v-if="canReveal\(lastTake\.path\)"/, 'the latest take ignores the guard')
  assert.match(body, /v-if="canReveal\(take\.path\)"/, 'history rows ignore the guard')
})

check('the history is a slideover listing every take with replay and reveal', () => {
  assert.match(body, /v-model:open="takesOpen"/, 'no slideover state for the history')
  assert.match(body, /v-for="take in voiceTakes"/, 'the history never renders its entries')
  assert.match(body, /:key="take\.path"/, 'history rows are not keyed by their file')
  assert.match(body, /@click="clearTakes"/, 'the history cannot be cleared')
  assert.match(body, /v-if="!voiceTakes\.length"/, 'empty history has no message')
})

check('both locales name the new actions', () => {
  for (const locale of ['en', 'vi']) {
    const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.voice
    for (const key of ['listen', 'showInFolder', 'historyTitle', 'historyDesc', 'historyEmpty', 'historyClear']) {
      assert.equal(typeof copy?.[key], 'string', `${locale} is missing tmcut.voice.${key}`)
      assert.ok(!copy[key].includes('@'), `${locale} tmcut.voice.${key} contains @ (intlify linked message)`)
    }
  }
})

console.log(`tmcut_voice_takes: ${passed} passed`)
