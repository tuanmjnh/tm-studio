/**
 * The rendered file's other half: where it goes, and what can open it.
 *
 * Measured on the desktop shell 2026-11-13 (`/tmcut/editor?project=default`,
 * CDP :9222, Electron 44.10 / Chromium 152): the export reached "Export
 * Completed!" and then nothing the dialog offered worked.
 *  - the preview button opened the modal on a `blob:` URL, and the modal
 *    classified it as neither video nor audio, because it classifies by file
 *    extension and a `blob:` URL has none — so Play showed "unsupported
 *    preview format";
 *  - the Download button used the browser lane (`<a download>` on a `blob:`),
 *    and in this shell that download BEGINS and then reports `state:
 *    "canceled"` with 0 bytes received and no file on disk — reproduced with a
 *    synthetic click and with a trusted input event;
 *  - there was no render folder to open, because the encoder hands back a
 *    `Blob` in memory and a `Blob` has no path to reveal.
 *
 * The fix is one mechanism, not three: on the desktop host the rendered bytes
 * are written to disk by the main process, which answers with the real path.
 * That path is what the preview is handed (the modal then sees `.mp4` and the
 * `media://` transport the rest of the editor already plays), what "Show in
 * folder" reveals, and what "Save as…" can copy to wherever the user picks.
 * The web host keeps the browser lane, because it has no main process to ask.
 *
 * These are source contracts, the same shape as tmcut_export_modal_gate: the
 * behaviour lives in a Vue component the node runner cannot mount, and every
 * assertion below fails on a silent regression in the template.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_result.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const modal = read('app/components/tmcut/TmcutExportModal.vue')
const preview = read('app/components/tools/VideoPreviewModal.vue')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

console.log('=== [TMCut export result] Starting ===\n')

check('the desktop export writes its bytes to disk and keeps the path', () => {
  assert.match(modal, /saveRender/, 'the dialog must ask the main process to write the rendered file')
  assert.match(modal, /webResultPath/, 'and it must keep the path that came back')
  const body = modal.match(/async function runWebExport\(\)[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(body, 'runWebExport is gone')
  assert.ok(
    body.indexOf('createObjectURL') < body.indexOf('saveRender'),
    'the blob is still made first, so a host without the bridge keeps a playable URL'
  )
})

check('the destination names the file on disk, not the browser lane', () => {
  assert.match(modal, /webResultPath/, 'the destination row reads the real path on desktop')
  assert.match(modal, /tmcut\.export\.desktopDestination/, 'desktop says what it actually does')
  assert.match(modal, /tmcut\.export\.webDestination/, 'and the web host keeps its own sentence')
})

check('"show in folder" reveals the written file', () => {
  assert.match(modal, /showItemInFolder/, 'the desktop host has the reveal primitive already')
  assert.match(modal, /showItemInFolder\?\.\(webResultPath/, 'and it is handed the path that was written, not the blob URL')
})

check('"save as" goes through the native dialog lane', () => {
  assert.match(modal, /saveAs/, 'a rendered file can still be copied to where the user wants it')
  assert.match(modal, /saveRenderToDisk\(.*,\s*true\)/, 'the copy is the same write with the dialog flag')
})

check('the web host keeps the browser download lane', () => {
  const body = modal.match(/function downloadWebResult\(\)[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(body, 'downloadWebResult is gone')
  assert.match(body, /link\.download/, 'the web host has no main process; the anchor lane is its only writer')
  assert.match(modal, /if \(isDesktop\.value\) return await saveRenderAs\(\)/, 'and the desktop path is decided before that lane is used')
})

check('the preview is handed a file it can actually play', () => {
  assert.match(modal, /:file-path="[^"]*webResultPath/, 'on desktop the preview gets the file on disk')
  assert.match(modal, /webResultPath \|\| webResultUrl/, 'and the blob stays the fallback for the web host')
  assert.match(modal, /kind="video"/, 'the export names what it made, instead of leaving the modal to guess from a blob: URL')
})

check('the preview modal classifies by a stated kind, not by file extension alone', () => {
  // The web export's result is a `blob:` URL: extension matching alone answers
  // "neither video nor audio", which is the bug measured on the desktop and
  // latent on the web host. A caller that knows what it produced must be able
  // to say so; the extension stays as the fallback for every other caller.
  assert.match(preview, /kind\?:/, 'the modal takes an optional kind')
  const isVideo = preview.match(/const isVideo = computed\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.ok(isVideo, 'the preview classification is gone')
  assert.match(isVideo, /props\.kind === 'video'/, 'a stated video kind wins over an extension a blob: URL does not have')
  const isAudio = preview.match(/const isAudio = computed\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.ok(isAudio, 'the audio classification is gone')
  assert.match(isAudio, /props\.kind === 'audio'/, 'and the same for audio')
})

console.log(`\n=== All ${passed} export-result checks passed ===`)
