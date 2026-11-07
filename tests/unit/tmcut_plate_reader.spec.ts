/**
 * The export's plate leg: one reader, one open per file, the instant core named.
 *
 * §53.6 left `readPlate` as a port with no browser implementation, and the reason
 * was not laziness: `decodeFrame` in [frameDecode.ts](../../app/utils/tmcut/frameDecode.ts)
 * answers a *thumbnail* question — one instant, one PNG, one `Input` opened and
 * thrown away. An export asks the same question thousands of times, in ascending
 * order, for the same handful of files. Re-opening the container per frame would
 * demux from the first keyframe every time, so the leg the exporter needs is a
 * reader that **keeps** the container open and releases it when the export ends.
 *
 * What this spec pins is the part that can be wrong even with no video decoder in
 * the room, because every one of these is a decision the glue cannot see:
 *  - a runtime without WebCodecs says `null`, and never opens a container;
 *  - one location is one open AND one sink, however many frames come out of it —
 *    building a `CanvasSink` per frame is the same per-frame waste in another place;
 *  - the instant goes to the sink **verbatim**: core owns the clock, and a
 *    `Math.round(atSec * 1000) / 1000` here would be a second clock, which is the
 *    bug class §52 and §53 have spent the whole programme closing;
 *  - the sink is built from the track alone, so the plate is the media's own size —
 *    `planEncodePlate` places a source whose geometry it is told truthfully, and a
 *    proxy-sized plate would place correctly and encode a soft file;
 *  - a container that cannot answer (unreadable, no video track) is released, not
 *    kept, and the next frame may try it again;
 *  - the caller's signal is obeyed before the work and is the signal the container
 *    is opened with, so `openMedia`'s release-on-abort applies to the export;
 *  - frames of one location are read one at a time, because every in-flight frame
 *    of one file would otherwise draw into the SAME sink canvas;
 *  - `close()` releases every open container exactly once, and a closed reader
 *    says `null` instead of opening one behind the caller.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_plate_reader.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFrameScheduler, ticksToSec } from 'tmcut-core'
import { createWebCodecsExport } from '../../app/utils/tmcut/webCodecsExport'
import { surfacesAt } from '../../app/utils/tmcut/paintSurfaces'
import { createPlateReader } from '../../app/utils/tmcut/frameDecode'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const A = 'C:/media/a.mp4'
const B = 'C:/media/b.mp4'

/**
 * The mediabunny half, faked: a container that answers two questions and a sink
 * that paints one canvas. The canvas is a single object on purpose — a real
 * `CanvasSink` owns one canvas and draws every instant into it, which is exactly
 * why concurrent reads of one file must be serialized.
 */
function makeFixture(options: { hasDecoder?: boolean } = {}) {
  const canvas = { width: 1920, height: 1080 }
  const answers = { canRead: true, tracks: [{}] as unknown[] }
  const opens: Array<{ src: string | null, signal: AbortSignal, bytes: Blob | null }> = []
  const closes: Array<string | null> = []
  const sinkArgCounts: number[] = []
  const sinkCalls: number[] = []
  const busy = { now: 0, peak: 0 }
  const pending: Array<() => void> = []
  let held = 0

  const open = (readAsk: { src: string | null, bytes?: Blob | null, signal: AbortSignal }) => {
    opens.push({ src: readAsk.src, bytes: readAsk.bytes ?? null, signal: readAsk.signal })
    let closed = false
    return {
      input: {
        async canRead() { return answers.canRead },
        async getVideoTracks() { return answers.tracks }
      },
      close() {
        if (closed) return
        closed = true
        closes.push(readAsk.src)
      }
    }
  }

  const makeSink = (...args: unknown[]) => {
    sinkArgCounts.push(args.length)
    return {
      async getCanvas(atSec: number) {
        sinkCalls.push(atSec)
        busy.now++
        busy.peak = Math.max(busy.peak, busy.now)
        if (held > 0) {
          held--
          await new Promise<void>(resolve => pending.push(resolve))
        }
        busy.now--
        return { canvas }
      }
    }
  }

  /** Make the next `count` sink calls wait for `releaseSinks()`. */
  function holdSinks(count: number) {
    held = count
  }
  const releaseSinks = () => {
    const waiting = pending.splice(0, pending.length)
    for (const done of waiting) done()
  }

  return {
    canvas,
    answers,
    opens,
    closes,
    sinkArgCounts,
    sinkCalls,
    busy,
    holdSinks,
    releaseSinks,
    deps: { open, makeSink, hasDecoder: () => options.hasDecoder !== false }
  }
}

/** Drain timers until `test` holds, so "not yet" is a measurement, not a guess. */
async function until(test: () => boolean, gaveUp: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (test()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error(gaveUp)
}

const liveSignal = () => new AbortController().signal
const abortedSignal = () => {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const TICKS = 120_000
const tk = (sec: number) => Math.round(sec * TICKS)

/** The authored shape the evaluator and the content law read. */
function clip(id: string, startSec: number, durSec: number) {
  return {
    id,
    type: 'video',
    src: `C:/media/${id}.mp4`,
    source: { in: 0, out: tk(durSec) },
    timeline: { start: tk(startSec), duration: tk(durSec) },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    effects: [],
    keyframes: []
  }
}

/**
 * One footage row, clip after clip. `planEncodeContent` still refuses a stacked
 * pair (§53.1), so two FILES in one export come from two clips after each other —
 * which is exactly the walk a per-frame reader would get wrong: the run moves from
 * one container to the next and never returns to the first.
 */
function projectOf(clips: Array<{ id: string, startSec: number, durSec: number }>) {
  return {
    version: 3,
    canvas: {
      width: 640,
      height: 360,
      fps: { numerator: 30, denominator: 1 },
      background: { type: 'color', value: '#101820' }
    },
    markers: [],
    tracks: [{ id: 'row-0', type: 'video', items: clips.map(c => clip(c.id, c.startSec, c.durSec)) }]
  }
}

async function main() {
  console.log('=== [TMCut plate reader] Starting ===\n')
  const decoderPath = join(root, 'app/utils/tmcut/frameDecode.ts')
  assert.ok(existsSync(decoderPath), 'the decode leg is the file this spec is about')

  // 1. The leg lives where the decoder lives. A second module holding `CanvasSink`
  //    would be a second answer about how pixels are made, and the frame-service
  //    census already forbids that; this check is the reader's own half of it.
  await check('the reader is in the decode leg and the glue stays platform-free', () => {
    const source = read('app/utils/tmcut/frameDecode.ts')
    assert.match(source, /export function createPlateReader/,
      'the plate reader is exported from the one file that owns pixels')
    assert.match(source, /new CanvasSink\(/, 'and it builds its sink the way the file already does')
    const glue = read('app/utils/tmcut/webCodecsExport.ts')
    assert.doesNotMatch(glue, /mediabunny|CanvasSink|VideoDecoder/,
      'the glue never touches a decoder; it asks for a plate')
  })

  // 2. A runtime without WebCodecs is not offered a substitute — the same rule
  //    `hasFrameDecoder` already states for thumbnails, restated for the export.
  await check('no decoder means no open and a null plate', async () => {
    const fixture = makeFixture({ hasDecoder: false })
    const reader = createPlateReader(fixture.deps as never)
    const plate = await reader.read({ src: A, atSec: 1.5, signal: liveSignal() })
    assert.equal(plate, null, 'the honest answer is no plate, not an exception')
    assert.equal(fixture.opens.length, 0, 'and no container was opened to find that out')
    reader.close()
  })

  // 3. The whole reason this is a reader and not `decodeFrame`: one file is one
  //    open and one sink, however many frames come out of it. The plate carries no
  //    `release` because there is nothing per-frame to give back — the container is
  //    the reader's and the canvas is the sink's.
  await check('one location is one container and one sink for a run of frames', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    for (const atSec of [0, 0.0333333, 0.0666667, 1.2]) {
      const plate = await reader.read({ src: A, atSec, signal: liveSignal() })
      assert.ok(plate, `the frame at ${atSec}s paints`)
      assert.equal('release' in plate, false,
        'a plate is not an owner: it must not carry a way to close the container')
      assert.equal(fixture.sinkCalls.at(-1), atSec,
        'the sink is asked for the authored instant, not a rounded one')
    }
    assert.equal(fixture.opens.length, 1, `four frames, one open, got ${fixture.opens.length}`)
    assert.equal(fixture.sinkArgCounts.length, 1, 'and one sink for the whole run')
    assert.equal(fixture.closes.length, 0, 'nothing released while the export is still running')
    reader.close()
    assert.equal(fixture.closes.length, 1, 'close gives the container back once')
    reader.close()
    assert.equal(fixture.closes.length, 1, 'and closing twice is not a second release')
  })

  // 4. Two files in a project are two containers and two sinks; both belong to the
  //    reader until the export ends.
  await check('distinct locations get distinct containers and both close', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    await reader.read({ src: A, atSec: 0.5, signal: liveSignal() })
    await reader.read({ src: B, atSec: 0.5, signal: liveSignal() })
    await reader.read({ src: A, atSec: 1.5, signal: liveSignal() })
    assert.deepEqual(fixture.opens.map(item => item.src), [A, B],
      'the second frame of a.mp4 reused its container')
    assert.equal(fixture.sinkArgCounts.length, 2, 'one sink per location, not per frame')
    reader.close()
    assert.deepEqual(fixture.closes, [A, B], 'both containers released, once each')
  })

  // 5. The instant is core's. A reader that rounded it would be a second clock.
  await check('the plate is asked for exactly the instant core named', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    await reader.read({ src: A, atSec: 0.033333333, signal: liveSignal() })
    await reader.read({ src: A, atSec: 1.0041666667, signal: liveSignal() })
    assert.deepEqual(fixture.sinkCalls, [0.033333333, 1.0041666667],
      'the number reaches the sink with no rounding of any kind')
    reader.close()
  })

  // 6. `CanvasSink(track)` with no width option is the native-size answer, and the
  //    plate reports the pixels it actually holds. The option-free call is only
  //    reachable in the default builder, which every fixture here replaces, so that
  //    half is pinned at the source — a mutation adding `{ width: 64 }` there is
  //    invisible to the fakes and perfectly legal to a typechecker.
  await check('the sink is built from the track alone, so the plate is native size', async () => {
    assert.match(read('app/utils/tmcut/frameDecode.ts'), /new CanvasSink\(track as MediaVideoTrack\)\)/,
      'the export sink takes the track and no option, so no proxy width can creep in')
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    const plate = await reader.read({ src: A, atSec: 0, signal: liveSignal() })
    assert.equal(fixture.sinkArgCounts[0], 1,
      `only the track was passed, got ${fixture.sinkArgCounts[0]} arguments`)
    assert.equal(plate?.width, 1920, 'the plate reports the canvas it holds')
    assert.equal(plate?.height, 1080)
    assert.equal(plate?.image, fixture.canvas,
      'and hands back the canvas the sink owns — the glue draws it before the next read')
    reader.close()
  })

  // 7. Every way a container can fail to yield a picture must still give the
  //    container back. A leak per failed frame is how an export dies at frame 900.
  await check('a container that cannot answer is released, not kept', async () => {
    const cannotRead = makeFixture()
    cannotRead.answers.canRead = false
    const readerA = createPlateReader(cannotRead.deps as never)
    assert.equal(await readerA.read({ src: A, atSec: 0, signal: liveSignal() }), null)
    assert.equal(cannotRead.closes.length, 1, 'canRead false still closes')
    await readerA.read({ src: A, atSec: 0.0333, signal: liveSignal() })
    assert.equal(cannotRead.opens.length, 2, 'and the next frame may try the file again')
    readerA.close()

    const noTrack = makeFixture()
    noTrack.answers.tracks = []
    const readerB = createPlateReader(noTrack.deps as never)
    assert.equal(await readerB.read({ src: B, atSec: 0, signal: liveSignal() }), null)
    assert.equal(noTrack.closes.length, 1, 'no video track still closes its input')
    assert.equal(noTrack.sinkArgCounts.length, 0, 'and never builds a sink for nothing')
    readerB.close()

    const noLocation = makeFixture()
    const readerC = createPlateReader(noLocation.deps as never)
    assert.equal(await readerC.read({ src: null, atSec: 0, signal: liveSignal() }), null)
    assert.equal(noLocation.opens.length, 0, 'a clip with no source never opens a container')
    readerC.close()
  })

  // 8. The caller's signal is obeyed twice, and it is the signal the container is
  //    opened with — the wiring `openMedia` needs in order to release on abort.
  await check('the abort signal cancels the read and is the one the container gets', async () => {
    const fixture = makeFixture()
    const controller = new AbortController()
    const reader = createPlateReader(fixture.deps as never)
    assert.equal(await reader.read({ src: A, atSec: 0, signal: abortedSignal() }), null,
      'a signal already fired asks for nothing')
    assert.equal(fixture.opens.length, 0, 'and no container was opened to find out')

    const plate = await reader.read({ src: A, atSec: 1, signal: controller.signal })
    assert.ok(plate, 'the live signal paints')
    assert.equal(fixture.opens.length, 1)
    assert.equal(fixture.opens[0]!.signal, controller.signal,
      'the container was opened with the export signal, not a private one')
    controller.abort()
    assert.equal(await reader.read({ src: A, atSec: 2, signal: controller.signal }), null,
      'and a cancelled export does not quietly read another frame')
    assert.equal(fixture.opens.length, 1, 'no second container after the cancel')
    reader.close()
  })

  // 9. The session paints more than one frame at a time (`planEncodeQueue`), and
  //    every frame of one file draws into that file's ONE sink canvas. Two reads
  //    overlapping is a torn frame, not a slower export.
  await check('frames of one location are read one at a time', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    fixture.holdSinks(1)
    const first = reader.read({ src: A, atSec: 0, signal: liveSignal() })
    await until(() => fixture.sinkCalls.length === 1, 'the first read never reached the sink')
    const second = reader.read({ src: A, atSec: 0.0333, signal: liveSignal() })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.deepEqual(fixture.sinkCalls, [0],
      'the second frame of the same file waits instead of sharing the first canvas')
    fixture.releaseSinks()
    assert.ok(await first, 'the first plate arrives')
    assert.ok(await second, 'and so does the second')
    assert.equal(fixture.busy.peak, 1, `never two reads inside the sink, peak ${fixture.busy.peak}`)
    assert.equal(fixture.opens.length, 1, 'serialized does not mean re-opened')
    reader.close()
  })

  // 10. A closed reader is finished. Re-opening silently would hand the caller a
  //     container nobody can close any more — the export already ran its finally.
  await check('a closed reader says no instead of opening behind the caller', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    await reader.read({ src: A, atSec: 0, signal: liveSignal() })
    reader.close()
    assert.equal(await reader.read({ src: A, atSec: 1, signal: liveSignal() }), null)
    assert.equal(fixture.opens.length, 1, 'close is the end of the reader, not a pause')
  })

  // 11. The port signature is not a hope: the real glue, the real surface law and
  //     the real reader, with only the mediabunny pieces faked. This is the check
  //     that says `readPlate` as §53.6 declared it is `read` as this file has it.
  await check('the real glue walks two files with one container each', async () => {
    const project = projectOf([{ id: 'a', startSec: 0, durSec: 1 }, { id: 'b', startSec: 1, durSec: 1 }])
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    const asked: Array<{ src: string | null, atSec: number }> = []
    const drawn: Array<{ width: number, height: number }> = []
    const sessions: Array<{ totalFrames: number }> = []
    const FPS = Object.freeze({ numerator: 30, denominator: 1 })
    // Two frames inside each clip, so the run opens a.mp4, walks past the cut into
    // b.mp4, and must not re-open the file it already left.
    const painted = [0, 15, 32, 44]
    const authored = [
      { src: A, startTicks: 0 },
      { src: A, startTicks: 0 },
      { src: B, startTicks: tk(1) },
      { src: B, startTicks: tk(1) }
    ]

    const result = await createWebCodecsExport({
      capability: {
        decide: () => Promise.resolve({
          kind: 'ready',
          container: 'mp4',
          errors: [],
          config: { id: 'avc1-640', video: { codec: 'avc1.42001f', width: 640, height: 360, fps: FPS } }
        })
      },
      session: (ask: Record<string, unknown>) => {
        sessions.push(ask as never)
        return {
          async run() {
            for (const index of painted) await (ask.paint as (i: number) => unknown)(index)
            return { videoPackets: painted.length, audioPackets: 0, progress: 1, output: { marker: 'blob' } }
          },
          async cancel() {}
        }
      },
      createCanvas: () => ({
        element: { marker: 'canvas' },
        begin() {},
        draw: (plate: { width: number, height: number }) => {
          drawn.push({ width: plate.width, height: plate.height })
        },
        dispose() {}
      }),
      surfaces: (evaluation: { at?: number }) => surfacesAt(project.tracks, evaluation as never).footage,
      readPlate: (ask: { src: string | null, atSec: number, signal: AbortSignal }) => {
        asked.push({ src: ask.src, atSec: ask.atSec })
        return reader.read({ src: ask.src, atSec: ask.atSec, signal: ask.signal })
      }
    }).run({ project: project as never, signal: liveSignal() })

    assert.equal(result.kind, 'exported', `the export finished: ${result.kind} ${result.message ?? ''}`)
    assert.equal(sessions[0]!.totalFrames, 60, 'the run was given the real frame count')

    // Derived from core's own grid and the authored offsets, without the law or
    // the reader: a clip with speed 1 and source.in 0 sits at
    // `frame.startTicks - clip.timeline.start`, which `ticksToSec` converts.
    const scheduler = createFrameScheduler(project as never, { rate: FPS })
    const expected = painted.map((index, which) => ({
      src: authored[which]!.src,
      atSec: ticksToSec(scheduler.frameAt(index)!.startTicks - authored[which]!.startTicks)
    }))
    assert.deepEqual(asked, expected,
      'every plate is the file and the media position the preview puts on screen')
    assert.deepEqual(drawn, expected.map(() => ({ width: 1920, height: 1080 })),
      'the surface is handed native-size plates, so the encoder is not fed a proxy')
    assert.deepEqual(fixture.opens.map(item => item.src), [A, B],
      'one container per file, all the way through a run that crosses the cut')
    assert.equal(fixture.closes.length, 0, 'and none of it released before the export ends')
    reader.close()
    assert.equal(fixture.closes.length, 2, 'given back once each, at the end')
  })

  // 12. The plate's bytes and the plate's location are two different questions,
  //     and the export has asked only the second one since §53.8. A revision the
  //     client cache holds is the copy the preview played, so it is the copy the
  //     file must be painted from — a project whose upload was reclaimed still
  //     exports its picture instead of refusing every frame.
  await check('the cached copy of a file is what the plate is decoded from', async () => {
    const fixture = makeFixture()
    const blob = new Blob([new Uint8Array(16)])
    const asked: string[] = []
    const reader = createPlateReader({
      ...fixture.deps,
      bytesFor: async (src: string) => {
        asked.push(src)
        return src === A ? blob : null
      }
    } as never)
    await reader.read({ src: A, atSec: 0, signal: liveSignal() })
    await reader.read({ src: A, atSec: 0.5, signal: liveSignal() })
    await reader.read({ src: B, atSec: 0.5, signal: liveSignal() })
    assert.deepEqual(asked, [A, B], 'one cache read per file, never one per frame')
    assert.equal(fixture.opens[0]!.bytes, blob, 'the container was opened from the cached copy')
    assert.equal(fixture.opens[1]!.bytes, null, 'and a file the cache does not hold was not')
    reader.close()
  })

  // 13. The cache is keyed by the AUTHORED path, not by the location the container
  //     opens. A revision names the file the user imported; `media://local?file=…`
  //     is not one, so keying by the resolved URL would ask for a revision that
  //     can never exist and silently fall back to the stream on every file.
  await check('the cache is asked with the authored path, the container with the location', async () => {
    const fixture = makeFixture()
    const asked: string[] = []
    const reader = createPlateReader({
      ...fixture.deps,
      bytesFor: async (src: string) => {
        asked.push(src)
        return null
      }
    } as never)
    await reader.read({
      src: 'media://local?file=C:/media/a.mp4',
      authoredSrc: 'C:/media/a.mp4',
      atSec: 0,
      signal: liveSignal()
    })
    assert.deepEqual(asked, ['C:/media/a.mp4'],
      'the cache saw the path the library names, not the URL the decoder opens')
    assert.equal(fixture.opens[0]!.src, 'media://local?file=C:/media/a.mp4',
      'and the container still opened the resolved location')
    reader.close()
  })

  // 14. A miss is a fallback, not a refusal: the location is still there, and the
  //     two legs must not turn a thin cache into a black export.
  await check('a cache miss falls back to the location, and a throwing read is a miss', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader({
      ...fixture.deps,
      bytesFor: async (src: string) => {
        if (src === A) throw new Error('the storage layer refused this read')
        return null
      }
    } as never)
    assert.ok(await reader.read({ src: A, atSec: 0, signal: liveSignal() }),
      'a storage layer that throws still paints from the location')
    assert.equal(fixture.opens[0]!.bytes, null, 'no bytes were handed to the container')
    assert.equal(fixture.opens[0]!.src, A, 'the location was, and it is the authored file')
    reader.close()
  })

  // 15. A reader with no byte port is still the location reader §53.8 shipped, so
  //     the desktop assembly — which has no client cache — is not forced through
  //     a browser storage API it does not have.
  await check('a reader with no byte port reads the location, as before', async () => {
    const fixture = makeFixture()
    const reader = createPlateReader(fixture.deps as never)
    await reader.read({ src: A, atSec: 0, signal: liveSignal() })
    assert.equal(fixture.opens[0]!.bytes, null)
    assert.equal(fixture.opens[0]!.src, A)
    reader.close()
  })

  console.log(`\n=== All ${passed} plate-reader checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
