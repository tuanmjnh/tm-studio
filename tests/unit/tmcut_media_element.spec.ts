/**
 * A throwaway media element gives its decoder back (Zero-FFmpeg slice F5).
 *
 * D slice put the decode paths under Mediabunny, whose `openMedia` already owns
 * one release law: "Mediabunny keeps fetching ranges until disposed" — so a
 * cancelled read calls `input.dispose()`
 * (app/utils/tmcut/frameDecode.ts:69-91). The DOM branch never got the same
 * law. Two sites still open a file in a disposable element and then walk away:
 * `probeWebMetadata` (app/utils/tmcut/webProbe.ts) and `captureVideoThumb`
 * (app/composables/useTmcutMedia.ts). Each keeps `src` pointed at the file, so
 * the element's reader stays attached to that blob or `/uploads/` URL after the
 * answer is already in hand; each keeps its `on*` handlers; and each leaves a
 * 15-second watchdog running *after* the promise settled. Importing a batch of
 * forty files therefore leaves forty decoders and forty timers behind, and the
 * same happens on every relink.
 *
 * The law these checks demand: the element and its watchdog die together, at
 * the moment the read settles — not when the browser feels like collecting it.
 * One module owns that moment, so a third site cannot invent a second answer.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_media_element.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const HELPER = 'app/utils/tmcut/mediaElement.ts'
const MEDIA = 'app/composables/useTmcutMedia.ts'

let passed = 0
let failed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`   ${label} PASSED`)
  } catch (error) {
    failed++
    console.log(`   ${label} FAILED: ${(error as Error).message}`)
  }
}

type Answer = 'metadata' | 'data-then-seeked' | 'error' | 'never'

interface FakeMedia extends Record<string, unknown> {
  preload: string
  muted: boolean
  paused: boolean
  currentTime: number
  duration: number
  videoWidth: number
  videoHeight: number
  srcObject: unknown
  attrs: Record<string, string>
  loadCalls: number
  pauseCalls: number
  removeAttribute: (name: string) => void
  load: () => void
  pause: () => void
}

/**
 * An element that behaves like the browser: assigning `src` schedules the
 * answer on a later tick, `data-then-seeked` only answers the seek it was
 * asked for, and `never` stands in for a file the element cannot read.
 */
function makeFake(answer: Answer, facts: Record<string, number> = {}): FakeMedia {
  const el = {
    preload: '',
    muted: false,
    paused: true,
    currentTime: 0,
    duration: 8,
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: undefined,
    attrs: {} as Record<string, string>,
    loadCalls: 0,
    pauseCalls: 0
  } as FakeMedia
  Object.assign(el, facts)
  el.removeAttribute = () => {
    el.attrs.src = ''
  }
  el.load = () => {
    el.loadCalls++
  }
  el.pause = () => {
    el.pauseCalls++
    el.paused = true
  }
  const fire = (handler: string) => {
    const fn = el[handler] as ((this: FakeMedia) => void) | null | undefined
    if (typeof fn === 'function') fn.call(el)
  }
  let srcValue = ''
  Object.defineProperty(el, 'src', {
    configurable: true,
    get: () => srcValue,
    set: (v: string) => {
      srcValue = v
      el.attrs.src = v
      setTimeout(() => {
        if (answer === 'error') fire('onerror')
        if (answer === 'metadata') fire('onloadedmetadata')
        if (answer === 'data-then-seeked') fire('onloadeddata')
      }, 0)
    }
  })
  let time = 0
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (v: number) => {
      time = v
      if (answer === 'data-then-seeked') setTimeout(() => fire('onseeked'), 0)
    }
  })
  return el
}

function assertReleased(el: FakeMedia, label: string) {
  assert.equal(el.attrs.src, '', `${label}: the src attribute must be dropped, not left pointing at the file`)
  assert.equal(el.srcObject, null, `${label}: srcObject must be released`)
  assert.equal(el.pauseCalls, 1, `${label}: the element must be paused once`)
  assert.equal(el.loadCalls, 1, `${label}: load() must run once, to close the reader`)
  for (const handler of ['onloadeddata', 'onloadedmetadata', 'onseeked', 'onerror']) {
    assert.equal(el[handler], null, `${label}: ${handler} must be detached`)
  }
}

/** setTimeout/clearTimeout that record who was scheduled and who was cleared. */
function installTimers() {
  const realSet = globalThis.setTimeout.bind(globalThis)
  const realClear = globalThis.clearTimeout.bind(globalThis)
  const handles = new Map<number, ReturnType<typeof realSet>>()
  const scheduled = new Map<number, number>()
  const cleared: number[] = []
  let seq = 1
  const g = globalThis as Record<string, unknown>
  const previousSet = g.setTimeout
  const previousClear = g.clearTimeout
  g.setTimeout = ((fn: () => void, ms?: number) => {
    const id = seq++
    scheduled.set(id, ms ?? 0)
    handles.set(id, realSet(() => {
      handles.delete(id)
      fn()
    }, ms ?? 0))
    return id as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout
  g.clearTimeout = ((id: unknown) => {
    const key = Number(id)
    const handle = handles.get(key)
    if (handle !== undefined) {
      realClear(handle)
      handles.delete(key)
    }
    if (scheduled.has(key)) cleared.push(key)
  }) as unknown as typeof clearTimeout
  return {
    /** ids whose watchdog was armed for exactly this delay */
    armedFor: (ms: number) => [...scheduled.entries()].filter(([, w]) => w === ms).map(([id]) => id),
    cleared,
    restore() {
      const live = globalThis as Record<string, unknown>
      live.setTimeout = previousSet
      live.clearTimeout = previousClear
    }
  }
}

/** A DOM whose elements are recorded, so release can be measured, not assumed. */
function installDom(answers: Answer[], facts: Record<string, number> = {}) {
  const created: FakeMedia[] = []
  const g = globalThis as Record<string, unknown>
  const previousDocument = g.document
  const previousAudio = g.Audio
  let index = 0
  const next = () => makeFake(answers[Math.min(index++, answers.length - 1)], facts)
  g.document = {
    createElement: () => {
      const el = next()
      created.push(el)
      return el
    }
  }
  g.Audio = function () {
    const el = next()
    created.push(el)
    return el
  } as unknown as typeof Audio
  return {
    created,
    restore() {
      const live = globalThis as Record<string, unknown>
      live.document = previousDocument
      live.Audio = previousAudio
    }
  }
}

type WithThrowaway = <T>(
  kind: 'video' | 'audio',
  setup: (el: FakeMedia, settle: (value: T | null) => void) => void,
  timeoutMs?: number
) => Promise<T | null>

async function main() {
  console.log('=== [TMCut media element lifecycle] Starting ===\n')

  const helperExists = await import('../../app/utils/tmcut/mediaElement').then(() => true, () => false)
  await check('a release law exists outside the sites that need it', () => {
    assert.ok(helperExists, `${HELPER} must own the release law both sites share`)
  })

  const loadHelper = async () => {
    const mod = await import('../../app/utils/tmcut/mediaElement') as unknown as { withThrowawayMedia: WithThrowaway }
    return mod.withThrowawayMedia
  }

  // 1. The bug: an element that answered is left holding its file.
  await check('an element that answers gives its decoder back', async () => {
    const dom = installDom(['metadata'])
    try {
      const withThrowawayMedia = await loadHelper()
      const value = await withThrowawayMedia<string>('video', (el, settle) => {
        el.onloadedmetadata = () => settle('ok')
        el.src = '/uploads/a.mp4'
      }, 50)
      assert.equal(value, 'ok', 'the answer must reach the caller')
      assert.equal(dom.created.length, 1, 'one element per read')
      assertReleased(dom.created[0]!, 'after a successful answer')
    } finally {
      dom.restore()
    }
  })

  // 2. The other half of the bug: a watchdog that outlives the promise it guards.
  await check('the watchdog dies with the read it guards', async () => {
    const dom = installDom(['metadata'])
    const timers = installTimers()
    try {
      const withThrowawayMedia = await loadHelper()
      const value = await withThrowawayMedia<string>('video', (el, settle) => {
        el.onloadedmetadata = () => settle('ok')
        el.src = '/uploads/a.mp4'
      }, 15000)
      assert.equal(value, 'ok')
      const armed = timers.armedFor(15000)
      assert.ok(armed.length > 0, 'the read armed a watchdog')
      assert.deepEqual(timers.cleared.sort(), armed.sort(),
        'every watchdog this read armed must be cleared the moment it settles')
      assertReleased(dom.created[0]!, 'after an early answer')
    } finally {
      timers.restore()
      dom.restore()
    }
  })

  // 3. A file that never answers must not keep the element either.
  await check('a read that times out releases too', async () => {
    const dom = installDom(['never'])
    try {
      const withThrowawayMedia = await loadHelper()
      const value = await withThrowawayMedia<string>('video', (el, settle) => {
        el.onloadedmetadata = () => settle('ok')
        el.src = '/uploads/broken.avi'
      }, 10)
      assert.equal(value, null, 'a timeout is a null answer, not a hang')
      assertReleased(dom.created[0]!, 'after the watchdog fired')
    } finally {
      dom.restore()
    }
  })

  // 4. The shape captureVideoThumb uses: two handlers, one settle.
  await check('a settle fires once, and only the settle releases', async () => {
    const dom = installDom(['data-then-seeked'])
    try {
      const withThrowawayMedia = await loadHelper()
      const value = await withThrowawayMedia<string>('video', (el, settle) => {
        el.onloadeddata = () => {
          el.currentTime = 0.5
          settle('early')
        }
        el.onseeked = () => settle('late')
        el.onerror = () => settle(null)
        el.src = '/uploads/b.mp4'
      }, 50)
      assert.equal(value, 'early', 'the first settle wins')
      const el = dom.created[0]!
      assert.equal(el.loadCalls, 1, 'one release, however many handlers answered')
      assert.ok(el.currentTime > 0, 'the seek the caller asked for happened before the answer')
    } finally {
      dom.restore()
    }
  })

  // 5. The audio branch (new Audio) is the same element with a different face.
  await check('the audio branch releases the element it built', async () => {
    const dom = installDom(['metadata'], { duration: 30, videoWidth: 0, videoHeight: 0 })
    try {
      const withThrowawayMedia = await loadHelper()
      const meta = await withThrowawayMedia<number>('audio', (el, settle) => {
        el.onloadedmetadata = () => settle(el.duration)
        el.src = '/uploads/voice.mp3'
      }, 50)
      assert.equal(meta, 30, 'an audio element reports its duration')
      assertReleased(dom.created[0]!, 'after an audio answer')
    } finally {
      dom.restore()
    }
  })

  // 6. No DOM (SSR) must still answer null, and must not touch a release.
  await check('without a DOM the read answers null and builds nothing', async () => {
    const dom = installDom(['metadata'])
    const g = globalThis as Record<string, unknown>
    g.document = undefined
    g.Audio = undefined
    try {
      const withThrowawayMedia = await loadHelper()
      let setupRan = false
      const value = await withThrowawayMedia<string>('video', (el, settle) => {
        setupRan = true
        el.src = '/uploads/a.mp4'
        settle('ok')
      }, 50)
      assert.equal(value, null, 'no DOM, no answer')
      assert.equal(setupRan, false, 'setup must not run against a missing document')
      assert.equal(dom.created.length, 0, 'not one element was built')
    } finally {
      dom.restore()
    }
  })

  // 7. The real consumer: the thumbnail capture is a caller of the law, not an
  //    owner. The web metadata probe that used to be the second caller went
  //    with the ffprobe leg (zero-FFmpeg slice I) — a demuxer answers both
  //    hosts now, so there is exactly one DOM reader left to police.
  await check('the thumbnail capture is the only DOM reader the law has to serve', () => {
    const media = read(MEDIA)
    assert.match(media, /withThrowawayMedia[<(]/, 'the thumb capture reads through the shared release law')
    assert.doesNotMatch(media, /document\.createElement\('video'\)/,
      'the thumb capture builds no element of its own')
    assert.doesNotMatch(media, /setTimeout\(\(\) => finish\(null\)/,
      'the thumb capture owns no watchdog of its own')
    assert.match(read(HELPER), /removeAttribute\('src'\)/,
      'the law drops the attribute, not just the property, so the reader lets go')
  })

  console.log(`\n=== [TMCut media element lifecycle] ${passed}/${passed + failed} checks passed ===`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
