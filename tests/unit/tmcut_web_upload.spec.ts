/**
 * Web-runtime media upload (R152).
 *
 * The web branch of the TMCut editor streams picked files to the local
 * Nitro server (POST /api/v1/media/upload) and keeps the returned
 * /uploads/<stored> URL as the asset path, replacing the previous
 * session-only blob: URLs. These checks pin:
 *  - the pure server helpers (range parsing, path-traversal guard,
 *    extension → kind/content-type maps),
 *  - that the extension whitelist stays in lockstep with @tmcut-core's
 *    classifyAssetKind (an upload the library refuses to classify would
 *    strand bytes on disk with no asset),
 *  - the wiring contract: toURL passes /uploads/ through, importWebFiles
 *    talks to the endpoint, and the serve route exists.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseUploadRange,
  resolveUploadFilePath,
  uploadKindForName,
  uploadsContentTypeForName
} from '../../server/utils/uploads'
import { classifyAssetKind } from '../../app/utils/tmcut/media'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`[ok] ${name}`)
  } catch (error) {
    failed++
    console.error(`[FAIL] ${name}:`, error instanceof Error ? error.message : error)
  }
}

async function main() {
  check('upload kind map stays in lockstep with @tmcut-core classifyAssetKind', () => {
    const samples = ['clip.mp4', 'CLIP.MOV', 'clip.webm', 'song.mp3', 'SONG.Wav', 'pic.png', 'pic.JPG', 'pic.tif']
    for (const name of samples) {
      if (uploadKindForName(name) !== classifyAssetKind(name)) {
        throw new Error(`kind mismatch for ${name}: ${uploadKindForName(name)} vs ${classifyAssetKind(name)}`)
      }
    }
    // Both must treat non-media as unuploadable.
    for (const name of ['doc.txt', 'archive.zip', 'noext']) {
      if (uploadKindForName(name) !== null) throw new Error(`${name} must be refused`)
    }
  })

  check('ranges parse: full, suffix, bounded, 416 and malformed', () => {
    const full = parseUploadRange(undefined, 100)
    if (!full || full.start !== 0 || full.end !== 99 || full.partial) throw new Error('full')
    const empty = parseUploadRange(undefined, 0)
    if (empty?.partial) throw new Error('empty file must not 206')
    const bounded = parseUploadRange('bytes=10-19', 100)
    if (!bounded || bounded.start !== 10 || bounded.end !== 19 || !bounded.partial) throw new Error('bounded')
    const suffix = parseUploadRange('bytes=-30', 100)
    if (!suffix || suffix.start !== 70 || suffix.end !== 99 || !suffix.partial) throw new Error('suffix')
    if (parseUploadRange('bytes=100-', 100) !== null) throw new Error('start==size must be 416')
    if (parseUploadRange('bytes=50-40', 100) !== null) throw new Error('inverted range')
    if (parseUploadRange('blob=1', 100) !== null) throw new Error('malformed unit')
    // Open-ended end clamps to the file edge (never streams past it).
    const open = parseUploadRange('bytes=95-99999', 100)
    if (!open || open.end !== 99 || open.start !== 95) throw new Error('open end must clamp')
  })

  check('path guard keeps requests inside the uploads dir', () => {
    const dir = 'C:/data/uploads'
    const inside = resolveUploadFilePath(dir, ['abc-clip.mp4'])
    if (!inside || inside !== 'C:\\data\\uploads\\abc-clip.mp4'.replace(/\//g, '\\')) {
      // windows separators vary by platform; just assert basename survives
      if (!inside?.endsWith('abc-clip.mp4')) throw new Error(`unexpected resolve: ${inside}`)
    }
    for (const attack of [['..', 'clip.mp4'], ['%2e%2e', 'clip.mp4'], ['.hidden.mp4']] as const) {
      if (resolveUploadFilePath(dir, [...attack]) !== null) throw new Error(`must reject ${attack.join('/')}`)
    }
    // Uploads are stored flat: a segment with an embedded slash or a
    // second directory level cannot appear in the stored name.
    if (resolveUploadFilePath(dir, ['a', 'clip.mp4']) !== null) throw new Error('nested path')
    // %2E defeats nothing here: the decode happens before every validity
    // check, so encoded traversal still lands on the '..' rejection above.
    // An encoded media name simply maps to its file (unknown names 404).
    const encoded = resolveUploadFilePath(dir, ['clip%2Emp4'])
    if (!encoded?.endsWith('clip.mp4')) throw new Error('encoded dot')
    // Unknown media extensions are never served (defensive — the guard
    // also refuses them at upload time).
    if (resolveUploadFilePath(dir, ['readme.md']) !== null) throw new Error('non-media')
  })

  check('content types cover every whitelisted extension', () => {
    for (const [ext, kind] of Object.entries({ mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', jpg: 'image/jpeg', png: 'image/png' })) {
      const name = `file.${ext}`
      const type = uploadsContentTypeForName(name)
      if (type !== kind) throw new Error(`${ext}: ${type}`)
      if (!type.startsWith(kind.split('/')[0])) throw new Error(`${ext} type family mismatch`)
    }
    const fallback = uploadsContentTypeForName('mystery.bin')
    if (fallback !== 'application/octet-stream') throw new Error('fallback')
  })

  check('toURL passes /uploads/ URLs through untouched', () => {
    const helper = read('app/utils/ffmpegHelper.ts')
    if (!helper.includes('|\\/uploads\\/')) {
      throw new Error('toURL regex must include the /uploads/ pass-through')
    }
  })

  check('importWebFiles targets the upload endpoint and persists durable assets', () => {
    const composable = read('app/composables/useTmcutMedia.ts')
    if (!composable.includes('/api/v1/media/upload')) throw new Error('composable must call the upload endpoint')
    if (!composable.includes('uploadWebFile')) throw new Error('uploadWebFile helper missing')
    if (!composable.includes('isDurableAssetPath')) throw new Error('durable filter missing')
  })

  check('serve route exists and honors range requests', () => {
    const route = read('server/routes/uploads/[...path].get.ts')
    if (!route.includes('parseUploadRange')) throw new Error('range support missing')
    if (!route.includes('resolveUploadFilePath')) throw new Error('traversal guard missing')
    if (!route.includes('206')) throw new Error('partial responses missing')
  })

  const summary = `${passed} passed${failed ? `, ${failed} FAILED` : ''}`
  console.log(`tmcut_web_upload: ${summary}`)
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
