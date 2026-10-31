/**
 * User-media path guard (R110).
 *
 * Root cause of the "amber unreadable" import bug: the Electron
 * controller gated EVERY media IPC (analyzeAsset, statFiles, thumbnails,
 * waveform, proxy, stabilize, scenes, silence, audio) behind a whitelist
 * of userData + resources only. Real videos imported from anywhere else
 * on disk were rejected with { ok: false, error: 'Invalid path' }
 * BEFORE any stat, so every fresh import turned amber.
 *
 * The guard was replaced with a structural one (isUserMediaPath):
 * non-empty, absolute, parsable — everything on the user's disks passes,
 * relative or unparsable inputs still refuse. These handlers are all
 * read-only probes of a file the user explicitly picked; app-internal
 * files never route through them (they are sanitizeId-keyed).
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// Requiring the controller under plain node is side-effect-free: the
// top-level `require('electron')` destructures to undefined values and
// registerTmcutController() is never called from a test.
const { isUserMediaPath } = require('../../electron/tools/tmcut.controller.cjs') as {
  isUserMediaPath: (p: unknown) => string | null
}

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

async function main() {
  await check('absolute Windows paths anywhere on disk pass (the import bug)', async () => {
    const p = 'D:\\Movies\\clip 4k.mp4'
    const got = isUserMediaPath(p)
    if (got !== null && got !== undefined) {
      if (got !== path.resolve(p)) throw new Error(`must canonicalize, got ${got}`)
    } else {
      throw new Error('a plain absolute import path must NOT be rejected')
    }
  })

  await check('forward-slash store paths (normalizeMediaPath) pass', async () => {
    const got = isUserMediaPath('D:/Movies/clip 4k.mp4')
    if (got === null) throw new Error('normalized (forward-slash) paths must pass')
    if (got !== path.resolve('D:/Movies/clip 4k.mp4')) throw new Error('must canonicalize')
  })

  await check('UNC paths pass (network drives are valid media homes)', async () => {
    const got = isUserMediaPath('\\\\nas01\\media\\drone.mov')
    if (got === null) throw new Error('UNC absolute paths must pass')
  })

  await check('empty, non-string and relative inputs refuse', async () => {
    if (isUserMediaPath('') !== null) throw new Error('empty must refuse')
    if (isUserMediaPath('   ') !== null) throw new Error('blank must refuse')
    if (isUserMediaPath(null) !== null) throw new Error('null must refuse')
    if (isUserMediaPath(undefined) !== null) throw new Error('undefined must refuse')
    if (isUserMediaPath(42) !== null) throw new Error('non-string must refuse')
    if (isUserMediaPath('relative/clip.mp4') !== null) throw new Error('relative must refuse')
    if (isUserMediaPath('clip.mp4') !== null) throw new Error('bare name must refuse')
  })

  await check('trimming: padded absolute paths resolve to the clean form', async () => {
    const got = isUserMediaPath(`  ${path.resolve('D:\\Media\\a.mp4')}  `)
    if (got !== path.resolve('D:\\Media\\a.mp4')) throw new Error(`expected trimmed resolve, got ${got}`)
  })

  console.log(`\n=== All ${passed} user-media path guard checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
