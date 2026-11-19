/**
 * CIT Voice Studio voice cloning.
 *
 * The pinned CIT source (6fc8d149) serves cloning at
 *  * GET  /api/voices/consent  -> { rights_statement, terms_version }
 *  * POST /api/voices/custom   -> multipart `name`, `ref_audio`, `denoise`,
 *                                `input_source`, plus `rights_confirmed=true`
 *                                and `rights_version` matching the served
 *                                terms; 409 on a name collision, 400 when the
 *                                sample is rejected (3–15.5 s)
 *  * DELETE /api/voices/custom/{name} -> custom voices only
 *
 * Pinned here:
 *  * the delete path is built from a validated name, encoded, never interpolated;
 *  * the IPC sync echoes the engine's own consent version, and refuses to
 *    upload without it;
 *  * only a cloned entry of the same name counts as `alreadyPresent` on 409;
 *  * deleting drops the local registry first and only then best-effort deletes
 *    the engine copy;
 *  * the renderer, preload and shared types expose exactly those calls.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const require = createRequire(import.meta.url)
const electronVoice = require('../../electron/tools/tmcut-voice.cjs')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

const controller = read('electron/tools/tmcut.controller.cjs')
const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
const preload = read('electron/preload.cjs')
const types = read('shared/types/electron.ts')

check('the delete path validates the voice name before encoding it', () => {
  assert.equal(electronVoice.citCustomVoicePath('tmcut_0123456789abcdef'), '/api/voices/custom/tmcut_0123456789abcdef')
  assert.equal(electronVoice.citCustomVoicePath('  Giọng Mới  '), `/api/voices/custom/${encodeURIComponent('Giọng Mới')}`)
  for (const bad of ['', ' '.repeat(2), '../admin', 'a/b', '-lead', 'x'.repeat(65), 'name?x=1']) {
    assert.throws(() => electronVoice.citCustomVoicePath(bad), /Invalid custom voice name/, `accepted ${JSON.stringify(bad)}`)
  }
})

check('CIT enrollment echoes the consent version it was given', () => {
  const sync = controller.slice(controller.indexOf(':syncManagedVoice'))
  const block = sync.slice(0, 4000)
  assert.match(block, /spec\.routes\.consent/, 'the sync never reads the engine consent')
  assert.match(block, /terms_version/, 'the engine consent version is ignored')
  assert.match(block, /args\.rightsVersion/, 'the renderer-provided consent version is ignored')
  assert.match(block, /Confirm the \$\{spec\.label\} voice-cloning consent first/, 'uploading without consent is not refused')
  assert.match(block, /form\.append\('rights_confirmed', 'true'\)/, 'rights_confirmed is not sent')
  assert.match(block, /form\.append\('rights_version', termsVersion\)/, 'rights_version is not sent')
})

check('CIT enrollment uses its own multipart shape', () => {
  const sync = controller.slice(controller.indexOf(':syncManagedVoice'))
  const block = sync.slice(0, 4000)
  assert.match(block, /spec\.routes\.enroll/, 'the enrollment route is hard-coded')
  assert.match(block, /form\.append\('ref_audio'/, 'CIT names the sample ref_audio')
  assert.match(block, /form\.append\('input_source', 'file'\)/, 'CIT needs input_source=file')
  assert.match(block, /form\.append\('denoise', 'true'\)/, 'the sample is never denoised')
})

check('a 409 only means already-present for a cloned entry of that name', () => {
  const sync = controller.slice(controller.indexOf(':syncManagedVoice'))
  const block = sync.slice(0, 4500)
  assert.match(block, /provider !== 'cit' \|\| matching\.isCloned === true/, 'a preset collision would be reported as synced')
  assert.match(block, /parseVoiceEntries\(/, 'the 409 path does not read the voice list')
})

check('delete removes the local copy first, then the CIT copy best-effort', () => {
  const del = controller.slice(controller.indexOf(':deleteManagedVoice'))
  const block = del.slice(0, 4000)
  assert.match(block, /String\(args\.id \|\| ''\)/, 'delete no longer takes an object argument')
  assert.match(block, /writeJsonAtomic\(/, 'the registry entry is not removed')
  const registryIndex = block.indexOf('writeJsonAtomic(')
  const remoteIndex = block.indexOf('citCustomVoicePath(')
  assert.ok(registryIndex >= 0 && remoteIndex > registryIndex, 'the engine copy is touched before the local delete')
  assert.match(block, /method: 'DELETE'/, 'the engine copy is never deleted')
  assert.match(block, /remote = 'offline'/, 'an offline engine would turn a local delete into an error')
  assert.match(block, /remote = [^\n]*'deleted'/, 'a successful engine delete is not reported')
})

check('the consent lookup is a loopback IPC handler', () => {
  const consent = controller.slice(controller.indexOf(':voiceConsent'))
  const block = consent.slice(0, 1200)
  assert.match(block, /normalizeTtsProvider\(args\.provider\)/, 'the consent handler takes an unvalidated provider')
  assert.match(block, /normalizeTtsBaseUrl\(args\.baseUrl, provider\)/, 'the consent handler skips the loopback boundary')
  assert.match(block, /spec\.routes\.consent/, 'the consent route is hard-coded')
  assert.match(block, /terms_version/, 'the consent version is not returned')
})

check('preload and shared types expose the consent call', () => {
  assert.match(preload, /'voiceConsent'/, 'preload never bridges voiceConsent')
  assert.match(types, /voiceConsent\(args\?: \{ provider\?: 'vieneu' \| 'cit', baseUrl\?: string \}/, 'the tmcut type lacks voiceConsent')
  assert.match(types, /deleteManagedVoice\(args: \{ id: string, provider\?: 'vieneu' \| 'cit', baseUrl\?: string \}\)/, 'deleteManagedVoice still takes a bare id')
  assert.match(types, /syncManagedVoice\(args: \{ id: string, provider\?: 'vieneu' \| 'cit', baseUrl\?: string, rightsVersion\?: string \}\)/, 'syncManagedVoice has no provider/consent fields')
})

check('the panel clones on both engines, with a CIT consent gate', () => {
  assert.match(body, /v-if="isDesktop"\s+class="space-y-2"[\s\S]{0,400}tmcut\.voice\.cloning/, 'the cloning block is not desktop-wide')
  assert.match(body, /<UCheckbox v-model="consentConfirmed"/, 'CIT has no consent checkbox')
  assert.match(body, /provider === 'cit' && !consentConfirmed/, 'Save reference is not gated on consent')
  assert.match(body, /citConsent\?\.rightsStatement/, 'the engine consent statement is never shown')
})

check('CIT clones are enrolled on add and addressed by provider everywhere', () => {
  assert.match(body, /provider: 'cit',\s*\n\s*baseUrl: baseUrl\.value,\s*\n\s*rightsVersion: citConsent\.value\?\.termsVersion/, 'addVoice does not enroll into CIT')
  assert.match(body, /provider: provider\.value,\s*\n\s*baseUrl: baseUrl\.value,\s*\n\s*rightsVersion: citConsent\.value\?\.termsVersion/, 'syncVoice drops the provider or consent')
  assert.match(body, /deleteManagedVoice\(\{ id: chosenLocal\.value\.id, provider: provider\.value, baseUrl: baseUrl\.value \}\)/, 'deleteVoice still sends a bare id')
  assert.match(body, /chosenLocal\.value && provider\.value === 'vieneu'/, 'CIT would re-sync on every synthesis')
  assert.match(body, /managedVoices\.value\.length > 0/, 'the managed library is still VieNeu-only')
})

check('both locales explain the consent and CIT persistence', () => {
  for (const locale of ['en', 'vi']) {
    const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.voice
    for (const key of ['consent', 'consentRequired', 'consentUnavailable', 'cloneHintCit', 'citPersistenceNote', 'deleteRemoteFailed', 'addedAndSynced']) {
      assert.equal(typeof copy?.[key], 'string', `${locale} is missing tmcut.voice.${key}`)
    }
    assert.doesNotMatch(copy.citHint, /stays a VieNeu-TTS feature|tính năng của VieNeu-TTS/, `${locale} citHint still says CIT cannot clone`)
  }
})

console.log(`tmcut_cit_cloning: ${passed} passed`)
