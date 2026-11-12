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

/**
 * The guard under test is `path.isAbsolute`, so every fixture has to be
 * absolute on the platform running this spec. `D:\…` is absolute on win32 and
 * relative on POSIX, which made the original fixtures pass on the author's
 * machine and fail on a Linux runner — same code, same law, different drive.
 */
const IS_WIN = process.platform === 'win32'
/** An absolute directory on any platform, with spaces and a drive/root. */
const ABS_DIR = path.join(path.parse(process.cwd()).root, 'Movies')
const ABS_MP4 = path.join(ABS_DIR, 'clip 4k.mp4')

async function main() {
  await check('a plain absolute import path passes (the import bug)', async () => {
    const got = isUserMediaPath(ABS_MP4)
    if (got === null || got === undefined) {
      throw new Error(`a plain absolute import path must NOT be rejected: ${ABS_MP4}`)
    }
    if (got !== path.resolve(ABS_MP4)) throw new Error(`must canonicalize, got ${got}`)
  })

  if (IS_WIN) {
    await check('a Windows drive path passes and canonicalizes', async () => {
      const p = 'D:\\Movies\\clip 4k.mp4'
      const got = isUserMediaPath(p)
      if (got === null || got === undefined) throw new Error('a plain absolute import path must NOT be rejected')
      if (got !== path.resolve(p)) throw new Error(`must canonicalize, got ${got}`)
    })
  }

  await check('forward-slash absolute paths (normalizeMediaPath) pass', async () => {
    const forward = ABS_MP4.replace(/\\/g, '/')
    const got = isUserMediaPath(forward)
    if (got === null) throw new Error('normalized (forward-slash) paths must pass')
    if (got !== path.resolve(forward)) throw new Error('must canonicalize')
  })

  if (IS_WIN) {
    await check('UNC paths pass (network drives are valid media homes)', async () => {
      const got = isUserMediaPath('\\\\nas01\\media\\drone.mov')
      if (got === null) throw new Error('UNC absolute paths must pass')
    })
  }

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
    const got = isUserMediaPath(`  ${ABS_MP4}  `)
    if (got !== path.resolve(ABS_MP4)) throw new Error(`expected trimmed resolve, got ${got}`)
  })

  console.log(`\n=== All ${passed} user-media path guard checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
